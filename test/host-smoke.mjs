/** Optional, isolated smoke using installed DSH modules. Never installs a profile. */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

export async function runHostSmoke(runtimeRoot) {
 const anchor = pathToFileURL(join(runtimeRoot, 'package.json')).href
 const workspace = new URL('../', import.meta.url).href
 const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.startsWith(workspace) && specifier.startsWith('@deepseek-ai/')) {
   return next(specifier, { ...context, parentURL: anchor })
  }
  return next(specifier, context)
 } })
 let root, adapter, engineFiber, toolFiber, agentScope, secondScope, presetsFiber
 try {
  const load = name => import(pathToFileURL(join(runtimeRoot,'node_modules','@deepseek-ai',name,'lib/index.js')).href)
  const [{ Context, Service }, { BasicCompactionEngine }, { ToolsService }, { createScope, scopeTarget }, plugin] = await Promise.all([
   load('cordis'), load('dsh-compaction-basic'), load('dsh-tools'), load('dsh-scope'), import('../lib/plugin.js')
  ])
  root = new Context()
  root.provide('systemPrompt', { tools() { return () => {} } })
  root.provide('llm', { async *stream() { throw new Error('Smoke must never call a provider') }, async resolveModelInfo() { return {} } })
  root.provide('tokenMeter', { measure() { return { totalTokens: 1000, baseline: { kind:'estimate' } } } })
  root.provide('sessions', {})
  toolFiber = root.plugin(ToolsService)
  await toolFiber
  engineFiber = root.plugin(BasicCompactionEngine, { auto: false })
  await engineFiber
  const engine = root.get('compaction')
  assert.equal(Object.getPrototypeOf(engine), BasicCompactionEngine.prototype)
  const key = {}, otherKey = {}
  agentScope = createScope(root, key)
  const event = { seq:1, time:1, type:'user/message', data:{ source:{kind:'user'}, content:[{type:'text',text:'Inspect the adapter without changing a real session.'}] } }
  const session = { id:'compact-codex-isolated-smoke-no-write', seq:1, surface:{nodes:[1]},
   snapshotEvents:()=>[event], eventAt:seq=>seq===1?event:undefined,
   requestHeader:()=>({config:{provider:'smoke',model:'smoke'}}) }
  const agent = { id:session.id, ctx:agentScope.ctx, session, options:{provider:'smoke',model:'smoke'}, status:'idle' }
  const secondKey = {}
  secondScope = createScope(root, secondKey)
  const second = { ...agent, id: agent.id + '-second', ctx: secondScope.ctx }
  class Presets extends Service {
   constructor(ctx) { super(ctx, 'agentPresets'); this.engine = engine }
   serviceFor() { return this.engine }
  }
  presetsFiber = root.plugin(Presets)
  await presetsFiber
  // A Service returning a traceable service creates a fresh use-site Proxy.
  assert.notEqual(root.get('agentPresets').serviceFor(agent), root.get('agentPresets').serviceFor(agent))
  root.provide('agents', { list:()=>[agent, second] })
  adapter = root.plugin(plugin, { options:{ keepalive:false, coldSwitch:false } })
  await adapter
  assert.equal(adapter.state, 2, 'adapter must activate with the real schema and injections')
  assert.equal(Object.hasOwn(engine,'summarize'), true, 'must decorate the actual retained instance')
  const names = [...root.get('tools').view(key).knownNames].sort()
  assert.deepEqual(names,['history','ledger_append','ledger_read','new_context'])
  assert.deepEqual([...root.get('tools').view(secondKey).knownNames].sort(), names)
  const wrapper = Object.getOwnPropertyDescriptor(engine, 'summarize').value
  await root.waterfall(scopeTarget(agent, key), 'agent/pre-step', { agent, signal: new AbortController().signal }, async () => ({ kind:'enter', messages:[] }))
  assert.equal(Object.getOwnPropertyDescriptor(engine, 'summarize').value, wrapper, 'fresh proxies must not force detach/reattach each step')
  assert.match((await engine.summarize({}, second, new AbortController().signal)).summary[0].text, /# 上下文交接/)
  assert.equal(root.get('tools').view(otherKey).knownNames.size, 0, 'no tool leakage to unrelated agents')
  assert.equal(root.get('tools').view(undefined).knownNames.size, 0, 'no global tool leakage')
  const summary = await engine.summarize({}, agent, new AbortController().signal)
  assert.match(summary.summary[0].text, /# 上下文交接/)
  await adapter.dispose()
  while (adapter.inertia) await adapter.inertia
  assert.equal(Object.hasOwn(engine,'summarize'), false, 'unload must restore the prototype-backed default')
  assert.equal(root.get('tools').view(key).knownNames.size, 0, 'scoped tools must be removed')
  assert.equal(root.get('tools').view(secondKey).knownNames.size, 0, 'shared backend member tools must also be removed')
  return { realRuntime:true, adapterActivated:true, scopedTools:names, handoffGenerated:true, restoredOnUnload:true, providerCalls:0, profileWrites:0 }
 } finally {
  for (const owner of [adapter, agentScope, secondScope, presetsFiber, engineFiber, toolFiber]) {
   if (owner) { await owner.dispose(); while (owner.inertia) await owner.inertia }
  }
  if (root) await root.fiber.dispose()
  hook.deregister()
 }
}
