/** Reversible, per-Agent adaptation of the official Basic compaction hook. */
export const DEFAULT_OPTIONS = Object.freeze({
 enabled: true, handoffTokens: 20000, budgetContext: false,
 // 两个自动行为默认关闭：保活会发真实请求并产生费用，冷换窗会在下一步前主动换窗。
 keepalive: false, cacheTtlMs: 3600000, keepaliveAfterMs: 3120000,
 minCacheReadTokens: 40000, idleKeepaliveBudget: 3, maxConsecutiveFailures: 2,
 coldSwitch: false, coldMinTokens: 100000, checkEveryMs: 15000
})

/** 数值型缓存参数的下限；上限只受安全整数约束。 */
const NUMERIC_OPTIONS = Object.freeze({
 cacheTtlMs: 1000, keepaliveAfterMs: 1000, minCacheReadTokens: 0,
 idleKeepaliveBudget: 0, maxConsecutiveFailures: 1, coldMinTokens: 0, checkEveryMs: 1000
})

export function resolveOptions(value) {
 const raw = typeof value?.get === 'function' ? value.get() : value
 const options = { ...DEFAULT_OPTIONS, ...(raw ?? {}) }
 for (const key of ['enabled', 'keepalive', 'coldSwitch', 'budgetContext']) {
  if (typeof options[key] !== 'boolean') throw new TypeError(key + ' must be a boolean')
 }
 if (!Number.isSafeInteger(options.handoffTokens) || options.handoffTokens < 1000 || options.handoffTokens > 64000) {
  throw new RangeError('handoffTokens must be an integer between 1000 and 64000')
 }
 for (const [key, min] of Object.entries(NUMERIC_OPTIONS)) {
  if (!Number.isSafeInteger(options[key]) || options[key] < min) {
   throw new RangeError(key + ' must be an integer >= ' + min)
  }
 }
 return options
}

/** Unwrap Cordis traceable use-site proxies to their stable service identity. */
export function serviceIdentity(value) {
 const seen = new Set()
 while (value && (typeof value === 'object' || typeof value === 'function') && !seen.has(value)) {
  seen.add(value)
  const original = value[Symbol.for('cordis.original')]
  if (!original || original === value) break
  value = original
 }
 return value
}

/** The defaults, middleware, retention and /compact remain owned by the Host. */
export function createIntegration({ BasicCompactionEngine, createScope, scopeOf, attachFeatures, summarize, handoffOptions, log = () => {} }) {
 const agents = new Map()
 const engines = new Map()
 let active = true

 function restore(record) {
  // Do not clobber a later contribution installed by another plugin.
  if (Object.getOwnPropertyDescriptor(record.engine, 'summarize')?.value !== record.wrapper) return
  if (record.descriptor) Object.defineProperty(record.engine, 'summarize', record.descriptor)
  else delete record.engine.summarize
 }

 async function detach(agent) {
  const state = agents.get(agent)
  if (!state) return
  agents.delete(agent)
  state.record.members.delete(agent)
  if (!state.record.members.size) {
   restore(state.record)
   engines.delete(state.record.engine)
  }
  await state.scope.dispose()
 }

 function attach(ctx, agent, engine, options) {
  engine = serviceIdentity(engine)
  if (!active || !options.enabled || !engine || !agent?.ctx || scopeOf(agent.ctx) === undefined) return false
  // Leave explicitly selected third-party implementations and subclasses alone.
  if (Object.getPrototypeOf(engine) !== BasicCompactionEngine.prototype) return false
  if (agents.has(agent)) return true
  let record = engines.get(engine)
  if (!record) {
   const descriptor = Object.getOwnPropertyDescriptor(engine, 'summarize')
   if (descriptor || typeof engine.summarize !== 'function') return false
   const original = engine.summarize
   record = { engine, descriptor, original, members: new Map(), wrapper: undefined }
   record.wrapper = async function(input, owner, signal) {
    const state = record.members.get(owner)
    if (!active || !state || !state.options.enabled) return Reflect.apply(original, this, [input, owner, signal])
    signal?.throwIfAborted()
    return summarize(engine.config, owner, handoffOptions(state.options))
   }
   Object.defineProperty(engine, 'summarize', { configurable: true, writable: true, value: record.wrapper })
   engines.set(engine, record)
  }
  let scope
  try { scope = createScope(ctx, scopeOf(agent.ctx)) }
  catch (error) {
   if (!record.members.size) { restore(record); engines.delete(engine) }
   throw error
  }
  const state = { agent, scope, record, options }
  record.members.set(agent, state)
  agents.set(agent, state)
  try {
   attachFeatures(scope.ctx, engine, engine.config, options)
  } catch (error) {
   // Roll back synchronously before propagating an activation failure.
   agents.delete(agent)
   record.members.delete(agent)
   if (!record.members.size) { restore(record); engines.delete(engine) }
   void scope.dispose().catch(log)
   throw error
  }
  return true
 }

 async function dispose() {
  if (!active) return
  active = false
  for (const record of engines.values()) { restore(record); record.members.clear() }
  const pending = [...agents.values()].map(state => state.scope.dispose())
  agents.clear()
  engines.clear()
  const results = await Promise.allSettled(pending)
  for (const result of results) if (result.status === 'rejected') log(result.reason)
 }
 return { attach, detach, dispose, has: agent => agents.has(agent), engineFor: agent => agents.get(agent)?.record.engine }
}
