import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createIntegration, resolveOptions, DEFAULT_OPTIONS } from '../lib/integration.js'

class Basic {
 constructor() { this.config = { thresholdRatio: 0.7 } }
 async summarize(input, agent, signal) { return { original: true, input, agent, signal } }
 async compactNow(agent, signal) { return this.summarize('manual', agent, signal) }
 async compactRegion(_start, _end, agent, signal) { return this.summarize('automatic', agent, signal) }
 async compactIfNeeded(agent, trigger, signal) { return { compact: true, agent, trigger, signal } }
}
function fixture(overrides = {}) {
 const scopes = [], attached = []
 const instance = createIntegration({ BasicCompactionEngine: Basic,
  scopeOf: ctx => ctx.key,
  createScope(_ctx, key) { const scope = { ctx: { key }, disposed: 0, async dispose() { this.disposed++ } }; scopes.push(scope); return scope },
  attachFeatures: (...args) => attached.push(args),
  summarize: (config, agent, options) => ({ codex: true, config, agent, options }),
  handoffOptions: options => ({ maxTokens: options.handoffTokens }), ...overrides })
 const agent = { ctx: { key: {} } }
 const engine = new Basic()
 return { instance, scopes, attached, agent, engine }
}
test('defaults never enable paid keepalive or cold switching; volatile ref and input validation', () => {
 assert.equal(DEFAULT_OPTIONS.keepalive, false)
 assert.equal(DEFAULT_OPTIONS.coldSwitch, false)
 assert.equal(DEFAULT_OPTIONS.preCompactNudge, true)
 assert.equal(DEFAULT_OPTIONS.cacheTtlMs, 3600000)
 assert.equal(DEFAULT_OPTIONS.coldMinTokens, 100000)
 assert.deepEqual(resolveOptions(undefined), DEFAULT_OPTIONS)
 assert.equal(resolveOptions({ get: () => ({ handoffTokens: 3000 }) }).handoffTokens, 3000)
 assert.equal(resolveOptions({ coldSwitch: true, coldMinTokens: 5000 }).coldMinTokens, 5000)
 assert.throws(() => resolveOptions({ keepalive: 'true' }), /boolean/)
 assert.throws(() => resolveOptions({ handoffTokens: 0 }), /handoffTokens/)
 assert.throws(() => resolveOptions({ cacheTtlMs: 999 }), /cacheTtlMs/)
 assert.throws(() => resolveOptions({ coldMinTokens: -1 }), /coldMinTokens/)
 assert.throws(() => resolveOptions({ preCompactNudge: 'no' }), /preCompactNudge/)
})
test('manual and automatic paths share a reversible instance-only summary hook', async () => {
 const { instance, scopes, attached, agent, engine } = fixture()
 const prototype = Basic.prototype.summarize, config = engine.config
 assert.equal(instance.attach({}, agent, engine, resolveOptions()), true)
 assert.equal(Basic.prototype.summarize, prototype)
 assert.equal(engine.config, config)
 assert.equal(attached.length, 1)
 assert.equal((await engine.compactNow(agent)).codex, true)
 assert.equal((await engine.compactRegion(1, 2, agent)).codex, true)
 const outsider = { ctx: { key: {} } }
 assert.equal((await engine.compactNow(outsider)).original, true)
 await instance.dispose()
 assert.equal(Object.hasOwn(engine, 'summarize'), false)
 assert.equal(engine.summarize, prototype)
 assert.equal(scopes[0].disposed, 1)
 assert.equal((await engine.compactNow(agent)).original, true)
 assert.equal(instance.attach({}, outsider, engine, resolveOptions()), false)
})
test('shared backend routes only enrolled agents and restores after its final member', async () => {
 const { instance, agent, engine } = fixture()
 const second = { ctx: { key: {} } }
 instance.attach({}, agent, engine, resolveOptions({ handoffTokens: 4000 }))
 instance.attach({}, second, engine, resolveOptions({ handoffTokens: 5000 }))
 assert.equal((await engine.compactNow(agent)).options.maxTokens, 4000)
 assert.equal((await engine.compactNow(second)).options.maxTokens, 5000)
 await instance.detach(agent)
 assert.equal((await engine.compactNow(agent)).original, true)
 assert.equal((await engine.compactNow(second)).codex, true)
 await instance.detach(second)
 assert.equal(Object.hasOwn(engine, 'summarize'), false)
})
test('custom engines, subclasses, unscoped agents and existing decorators are untouched', async () => {
 const { instance, agent } = fixture()
 class Custom extends Basic {}
 for (const engine of [new Custom(), { summarize() {} }, Object.assign(new Basic(), { summarize() {} })]) {
  const before = engine.summarize
  assert.equal(instance.attach({}, agent, engine, resolveOptions()), false)
  assert.equal(engine.summarize, before)
 }
 assert.equal(instance.attach({}, {ctx:{}}, new Basic(), resolveOptions()), false)
 assert.equal(instance.attach({}, agent, new Basic(), resolveOptions({enabled:false})), false)
 await instance.dispose()
})
test('a later decorator is not overwritten by plugin disposal', async () => {
 const { instance, agent, engine } = fixture()
 instance.attach({}, agent, engine, resolveOptions())
 const later = () => 'another-plugin'
 engine.summarize = later
 await instance.dispose()
 assert.equal(engine.summarize, later)
})
test('failed feature activation rolls back hook and scope', async () => {
 const { instance, scopes, agent, engine } = fixture({ attachFeatures() { throw new Error('activation failed') } })
 assert.throws(() => instance.attach({}, agent, engine, resolveOptions()), /activation failed/)
 assert.equal(Object.hasOwn(engine, 'summarize'), false)
 assert.equal(instance.has(agent), false)
 assert.equal(scopes[0].disposed, 1)
 await instance.dispose()
})
test('cancellation stops handoff generation', async () => {
 const { instance, agent, engine } = fixture()
 instance.attach({}, agent, engine, resolveOptions())
 await assert.rejects(engine.compactNow(agent, AbortSignal.abort()), /abort/i)
 await instance.dispose()
})
test('bundle only inserts adapter; runtime imports are declared peers', () => {
 const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
 const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
 assert.match(patch, /id: compact-codex/)
 assert.doesNotMatch(patch, /preset-standard|preset-ptc|preset-minimal|preset-cordis|compaction-basic|dsh-purge/)
 assert.equal(manifest.exports['.'], './lib/plugin.js')
 for (const dep of ['schemastery','dsh-compaction-basic','dsh-llm','dsh-util-values','dsh-scope']) {
  assert.ok(manifest.peerDependencies['@deepseek-ai/' + dep])
 }
 assert.match(manifest.engines.dsh, /0\.2\.2/)
})

test('fresh Cordis use-site proxies share stable engine identity', async () => {
 const { instance, agent, engine } = fixture()
 const proxy = () => new Proxy(engine, { get(target, key, receiver) { return key === Symbol.for('cordis.original') ? target : Reflect.get(target, key, receiver) } })
 const second = { ctx: { key: {} } }
 assert.notEqual(proxy(), proxy())
 assert.equal(instance.attach({}, agent, proxy(), resolveOptions()), true)
 assert.equal(instance.attach({}, second, proxy(), resolveOptions()), true)
 assert.equal(instance.engineFor(agent), engine)
 assert.equal(instance.engineFor(second), engine)
 assert.equal((await engine.compactNow(agent)).codex,true)
 assert.equal((await engine.compactNow(second)).codex,true)
 await instance.detach(agent)
 assert.equal((await engine.compactNow(second)).codex,true)
 await instance.dispose()
 assert.equal(Object.hasOwn(engine,'summarize'),false)
})

test('scope creation failure cannot strand a summary wrapper on the official instance', async () => {
 const {instance,agent,engine}=fixture({createScope(){throw new Error('scope failed')}})
 await assert.rejects(async()=>instance.attach({},agent,engine,resolveOptions()), /scope failed/)
 assert.equal(Object.hasOwn(engine,'summarize'),false)
 assert.equal(instance.has(agent),false)
 await instance.dispose()
})

test('pre-compaction hook defers pressure compaction and stays reversible', async () => {
 const { instance, agent, engine } = fixture()
 const seen = []
 const preCompact = async (owner, target, trigger) => { seen.push([owner, target, trigger]); return trigger === 'pressure' }
 assert.equal(instance.attach({}, agent, engine, resolveOptions(), preCompact), true)
 assert.equal(await engine.compactIfNeeded(agent, 'pressure'), null)
 assert.deepEqual(await engine.compactIfNeeded(agent, 'context-overflow'), { compact: true, agent, trigger: 'context-overflow', signal: undefined })
 assert.equal(seen.length, 2)
 const outsider = { ctx: { key: {} } }
 assert.deepEqual(await engine.compactIfNeeded(outsider, 'pressure'), { compact: true, agent: outsider, trigger: 'pressure', signal: undefined })
 await instance.detach(agent)
 assert.equal(Object.getOwnPropertyDescriptor(engine, 'compactIfNeeded'), undefined)
 assert.deepEqual(await engine.compactIfNeeded(agent, 'pressure'), { compact: true, agent, trigger: 'pressure', signal: undefined })
})
