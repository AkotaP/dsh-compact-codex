import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __test, attachCodexFeatures, buildHandoffOptions } from '../lib/index.js'
import { initialCacheState, noteRequest, decideKeepalive } from '../lib/cache.js'

const ENTER = { kind: 'enter', messages: [] }
const cacheConfig = { keepalive: true, cacheTtlMs: 1000, keepaliveAfterMs: 500, minCacheReadTokens: 100,
 idleKeepaliveBudget: 3, maxConsecutiveFailures: 2, coldSwitch: false, coldMinTokens: 100, checkEveryMs: 1000 }
const usage = { inputTokens: 10, cacheReadTokens: 200, cacheWriteTokens: 0 }

function homeOf(t) {
 const home = mkdtempSync(join(tmpdir(), 'codex-engine-'))
 const previous = process.env.DSH_HOME
 process.env.DSH_HOME = home
 t.after(() => {
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  rmSync(home, { recursive: true, force: true })
 })
 return home
}

function context(t) {
 const listeners = new Map(), tools = new Map(), disposers = [], timers = []
 t.mock.method(globalThis, 'setInterval', (fn) => { const timer = { fn, active: true, unref() {} }; timers.push(timer); return timer })
 t.mock.method(globalThis, 'clearInterval', (timer) => { timer.active = false })
 const ctx = {
  effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
  on(name, fn, options) {
   const list = listeners.get(name) ?? []
   if (options?.prepend) list.unshift(fn); else list.push(fn)
   listeners.set(name, list)
   return ctx.effect(() => () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) })
  },
  inject(_names, fn) { fn(ctx) },
  tools: { register(tool) { tools.set(tool.name, tool); return ctx.effect(() => () => tools.delete(tool.name)) } },
  tokenMeter: { measure: () => structuredClone({ totalTokens: 220, surfaceDeltaTokens: 0, baseline: { kind: 'usage', usage } }) },
  llm: { async resolveModelInfo() { return {} }, async *stream() { yield { usage } } },
  async step(agent, signal = new AbortController().signal, terminal = async () => ENTER, extra = {}) {
   const list = [...(listeners.get('agent/pre-step') ?? [])]
   const dispatch = (i) => i === list.length ? terminal() : list[i]({ agent, signal, ...extra }, () => dispatch(i + 1))
   return dispatch(0)
  },
  async emit(name, payload) { for (const fn of [...(listeners.get(name) ?? [])]) await fn(payload) },
  dispose() { for (const dispose of disposers.splice(0).reverse()) dispose() },
  toolsMap: tools, timers
 }
 t.after(() => ctx.dispose())
 return ctx
}

function sessionOf(at = Date.now() - 700) {
 const events = []
 const session = {
  id: 'engine-test', seq: 0, surface: { nodes: [] },
  append(type, data = {}, time = at) {
   const event = { seq: ++session.seq, type, data, time }; events.push(event); session.surface.nodes.push(event.seq); return event
  },
  snapshotEvents: () => events,
  eventAt: (seq) => events.find((event) => event.seq === seq),
  requestHeader: () => [...events].reverse().find((event) => event.type === 'request/header')?.data.header,
  deriveMessages: () => [], toolHistory: () => []
 }
 session.append('system/message', { content: [] })
 session.append('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'request' }] })
 session.append('request/header', { header: { config: { provider: 'p', model: 'm' }, tools: [] } })
 session.append('step/start')
 session.append('assistant/message', { usage })
 session.append('step/end')
 return session
}
const agentOf = (session) => ({ session, status: 'running', options: { provider: 'p', model: 'm' } })
const entry = (window, text, seq = 1) => ({ seq, window, ts: Date.now(), task_id: 't' + seq, title: text, text, status: 'blocked', through: 0 })

// Tests use a lifecycle-aware context: on/register already own effects, matching the host.
test('cache explicit zero and absent usage cannot revive a stale prefix', () => {
 const state = initialCacheState()
 noteRequest(state, usage, 100)
 assert.equal(state.cachedPrefixTokens, 200)
 noteRequest(state, { cacheReadTokens: 0, cacheWriteTokens: 0 }, 200)
 assert.equal(state.cachedPrefixTokens, 0)
 assert.equal(state.lastActivityAt, null)
 noteRequest(state, usage, 300)
 noteRequest(state, { inputTokens: 100 }, 400)
 assert.equal(state.lastActivityAt, null)
 assert.equal(state.cachedPrefixTokens, 0)
 state.inFlight = true
 assert.equal(decideKeepalive(state, 500, { enabled: true, maxConsecutiveFailures: 2 }, false).reason, 'busy')
})

test('extras default to no keepalive timer or paid request', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session)
 let calls = 0
 ctx.llm.stream = async function* () { calls++; yield { usage } }
 attachCodexFeatures(ctx, { config: {} }, {}, { coldSwitch: false })
 await ctx.step(agent)
 agent.status = 'idle'
 await ctx.emit('agent/status', { agent, status: 'idle' })
 assert.equal(calls, 0)
 assert.equal(ctx.timers.length, 0)
 assert.equal(buildHandoffOptions().maxTokens, 20000)
 assert.equal(buildHandoffOptions({ handoffTokens: 123 }).maxTokens, 123)
 assert.deepEqual([...ctx.toolsMap.keys()].sort(), ['history', 'ledger_append', 'ledger_read', 'new_context'])
 ctx.dispose()
 assert.equal(ctx.toolsMap.size, 0)
})

test('one durable baseline is observed once, never re-timestamped by tool steps', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session)
 __test.registerCacheKeeper(ctx, {}, cacheConfig)
 await ctx.step(agent)
 const state = __test.cacheStateOf(session)
 const at = state.lastActivityAt
 state.idleKeepalives = 2
 state.consecutiveFailures = 1
 session.append('tool/result')
 await ctx.step(agent)
 assert.equal(state.lastActivityAt, at)
 assert.equal(state.idleKeepalives, 2)
 assert.equal(state.consecutiveFailures, 1)
})

test('route changes and shrinking surface invalidate cached prefix without reusing old usage', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session)
 __test.registerCacheKeeper(ctx, {}, cacheConfig)
 await ctx.step(agent)
 assert.equal(__test.cacheStateOf(session).cachedPrefixTokens, 200)
 await ctx.step(agent, undefined, undefined, { modelSelection: { provider: 'p', model: 'other' } })
 assert.equal(__test.cacheStateOf(session).lastActivityAt, null)
 await ctx.step(agent)
 assert.equal(__test.cacheStateOf(session).lastActivityAt, null)
 const newSession = sessionOf(), nextAgent = agentOf(newSession)
 await ctx.step(nextAgent)
 ctx.tokenMeter.measure = () => ({ totalTokens: 100, surfaceDeltaTokens: -120, baseline: { kind: 'usage', usage } })
 await ctx.step(nextAgent)
 assert.equal(__test.cacheStateOf(newSession).lastActivityAt, null)
})

test('timer refuses busy agent and aborts in-flight request on resume and unload', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session)
 const requests = []
 ctx.llm.stream = async function* (request) {
  requests.push(request)
  await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }))
 }
 __test.registerCacheKeeper(ctx, {}, cacheConfig)
 await ctx.step(agent)
 ctx.timers[0].fn()
 assert.equal(requests.length, 0)
 agent.status = 'idle'
 await ctx.emit('agent/status', { agent, status: 'idle' })
 assert.equal(requests.length, 1)
 ctx.timers[0].fn()
 assert.equal(requests.length, 1)
 agent.status = 'running'
 await ctx.emit('agent/status', { agent, status: 'running' })
 assert.equal(requests[0].signal.aborted, true)
 await new Promise(setImmediate)
 agent.status = 'idle'
 await ctx.emit('agent/status', { agent, status: 'idle' })
 assert.equal(requests.length, 2)
 ctx.dispose()
 assert.equal(requests[1].signal.aborted, true)
 assert.equal(ctx.timers[0].active, false)
 await new Promise(setImmediate)
 assert.equal(__test.cacheStateOf(session), undefined)
 ctx.timers[0].fn()
 assert.equal(requests.length, 2)
})

test('cold switch requires confirmed cache, fresh route and cancellable unchanged window', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(Date.now() - 2000), agent = agentOf(session), calls = []
 __test.registerCacheKeeper(ctx, { compactRegion: async (...args) => calls.push(args) }, { ...cacheConfig, keepalive: false, coldSwitch: true })
 const controller = new AbortController()
 await ctx.step(agent, controller.signal)
 assert.equal(calls.length, 1)
 assert.equal(calls[0][3], controller.signal)
 await ctx.step(agent)
 assert.equal(calls.length, 1, 'successful cold switch clears its baseline')
 const other = sessionOf(Date.now() - 2000)
 await ctx.step(agentOf(other), undefined, undefined, { modelSelection: { provider: 'p', model: 'other' } })
 assert.equal(calls.length, 1)
 const cancelled = new AbortController(); cancelled.abort()
 await ctx.step(agentOf(sessionOf(Date.now() - 2000)), cancelled.signal)
 assert.equal(calls.length, 1)
})

test('cold switch ignores estimated and zero-cache samples and downstream compaction', async (t) => {
 homeOf(t)
 const ctx = context(t), calls = []
 __test.registerCacheKeeper(ctx, { compactRegion: async (...args) => calls.push(args) }, { ...cacheConfig, keepalive: false, coldSwitch: true })
 ctx.tokenMeter.measure = () => ({ totalTokens: 220, baseline: { kind: 'estimated' } })
 await ctx.step(agentOf(sessionOf(Date.now() - 2000)))
 assert.equal(calls.length, 0)
 ctx.tokenMeter.measure = () => ({ totalTokens: 220, baseline: { kind: 'usage', usage: { cacheReadTokens: 0, cacheWriteTokens: 0 } } })
 const zero = sessionOf(Date.now() - 2000)
 zero.append('assistant/message', { usage: { cacheReadTokens: 0, cacheWriteTokens: 0 } })
 await ctx.step(agentOf(zero))
 assert.equal(calls.length, 0)
 ctx.tokenMeter.measure = () => ({ totalTokens: 220, baseline: { kind: 'usage', usage } })
 const compacted = sessionOf(Date.now() - 2000)
 await ctx.step(agentOf(compacted), undefined, async () => { compacted.append('compaction/end'); return ENTER })
 assert.equal(calls.length, 0)
})

test('ledger gate still checks unlogged tail when this window has no new human request', (t) => {
 homeOf(t)
 const session = sessionOf()
 session.append('compaction/end')
 for (let i = 0; i < 26; i++) session.append('tool/result')
 __test.writeLedger(session, [entry(1, 'old-window')])
 assert.match(__test.ledgerGate(session), /26 个工具结果/)
})

test('ledger_read current excludes archived windows and invalidates window cache on new compaction', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session)
 __test.registerLedgerTools(ctx)
 __test.writeLedger(session, [entry(1, 'old-only'), entry(2, 'new-only', 2)])
 assert.equal(__test.windowOf(session), 1)
 session.append('compaction/end')
 const result = await ctx.toolsMap.get('ledger_read').execute({ view: 'current' }, { agent })
 assert.match(result.detail, /new-only/)
 assert.doesNotMatch(result.detail, /old-only/)
})

test('ledger_append propagates disk errors and never reports a false successful record', async (t) => {
 const home = homeOf(t), ctx = context(t), session = sessionOf()
 const blocker = join(home, 'not-a-directory')
 writeFileSync(blocker, 'blocked')
 process.env.DSH_HOME = blocker
 __test.registerLedgerTools(ctx)
 await assert.rejects(ctx.toolsMap.get('ledger_append').execute({ task_id: 't', title: 'task', status: 'blocked', text: 'record' }, { agent: agentOf(session) }), /账本写入失败/)
 assert.deepEqual(__test.readLedger(session), [])
 assert.deepEqual(readdirSync(home), ['not-a-directory'])
})

test('new_context consumes once, forwards signal, respects reject and skips downstream reset', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session), calls = []
 __test.registerNewContextTool(ctx, { compactRegion: async (...args) => calls.push(args) })
 const tool = ctx.toolsMap.get('new_context'), signal = new AbortController().signal
 await tool.execute({}, { agent, signal })
 await ctx.step(agent, signal, async () => ({ kind: 'reject' }))
 assert.equal(calls.length, 0)
 await ctx.step(agent, signal)
 assert.equal(calls.length, 1)
 assert.equal(calls[0][3], signal)
 await ctx.step(agent, signal)
 assert.equal(calls.length, 1)
 await tool.execute({}, { agent, signal })
 await ctx.step(agent, signal, async () => { session.append('compaction/end'); return ENTER })
 assert.equal(calls.length, 1)
})

test('new_context drops cancelled requests and revalidates ledger before consuming', async (t) => {
 homeOf(t)
 const ctx = context(t), session = sessionOf(), agent = agentOf(session), calls = []
 __test.registerNewContextTool(ctx, { compactRegion: async (...args) => calls.push(args) })
 const tool = ctx.toolsMap.get('new_context'), abort = new AbortController()
 await tool.execute({}, { agent, signal: abort.signal })
 abort.abort()
 await ctx.step(agent)
 assert.equal(calls.length, 0)
 await ctx.step(agent)
 assert.equal(calls.length, 0)
 await tool.execute({}, { agent })
 __test.writeLedger(session, [entry(1, 'stale')])
 for (let i = 0; i < 26; i++) session.append('tool/result')
 await ctx.step(agent)
 assert.equal(calls.length, 0)
})

test('budget callback does not read or inject after disposal during next or model lookup', async (t) => {
 homeOf(t)
 for (const phase of ['next', 'model']) {
  const ctx = context(t), session = sessionOf(), agent = agentOf(session)
  const barrier = Promise.withResolvers(), entered = Promise.withResolvers()
  let headerReads = 0, modelReads = 0, meterReads = 0, infoReads = 0
  const header = session.requestHeader()
  session.requestHeader = () => { headerReads++; return header }
  ctx.tokenMeter.measure = () => { meterReads++; return { totalTokens: 220 } }
  const info = { get context() { infoReads++; return { contextWindow: 200000 } } }
  ctx.llm.resolveModelInfo = async () => {
   modelReads++
   if (phase === 'model') { entered.resolve(); return barrier.promise }
   return info
  }
  __test.registerBudgetContext(ctx, {}, { budgetContext: true, refreshMs: 0 })
  const decision = { kind: 'enter', messages: [] }
  const running = ctx.step(agent, undefined, async () => {
   if (phase === 'next') { entered.resolve(); return barrier.promise }
   return decision
  })
  await entered.promise
  ctx.dispose()
  barrier.resolve(phase === 'next' ? decision : info)
  assert.equal(await running, decision)
  assert.deepEqual(decision.messages, [])
  assert.equal(headerReads, phase === 'next' ? 0 : 1)
  assert.equal(modelReads, phase === 'next' ? 0 : 1)
  assert.equal(meterReads, 0)
  assert.equal(infoReads, 0)
 }
})
