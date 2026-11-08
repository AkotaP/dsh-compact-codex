/** Host entry: no preset snapshots, prototype edits, or on-disk runtime links. */
import z from '@deepseek-ai/schemastery'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { attachCodexFeatures, resetSummary, buildHandoffOptions } from './index.js'
import { createIntegration, DEFAULT_OPTIONS, resolveOptions, serviceIdentity } from './integration.js'

export const name = 'compact-codex'
export const inject = ['agents', 'llm', 'tokenMeter', 'sessions', 'tools']
export const Config = z.object({
 options: z.object({
  enabled: z.boolean().default(true),
  handoffTokens: z.number().step(1).min(1000).max(64000).default(20000),
  budgetContext: z.boolean().default(false),
  keepalive: z.boolean().default(false),
  cacheTtlMs: z.number().step(1).min(1000).default(3600000),
  keepaliveAfterMs: z.number().step(1).min(1000).default(3120000),
  minCacheReadTokens: z.number().step(1).min(0).default(40000),
  idleKeepaliveBudget: z.number().step(1).min(0).default(3),
  maxConsecutiveFailures: z.number().step(1).min(1).default(2),
  coldSwitch: z.boolean().default(false),
  coldMinTokens: z.number().step(1).min(0).default(100000),
  checkEveryMs: z.number().step(1).min(1000).default(15000)
 }).default({ ...DEFAULT_OPTIONS }).volatile()
})

export async function apply(ctx, config = {}) {
 const log = error => ctx.logger.warn('compact-codex: ' + String(error))
 const integration = createIntegration({ BasicCompactionEngine, createScope, scopeOf,
  attachFeatures: attachCodexFeatures, summarize: resetSummary, handoffOptions: buildHandoffOptions, log })
 let active = true
 let queue = Promise.resolve()
 let lastOptions = resolveOptions(config.options)
 const findEngine = agent => {
  // The public retained-composition API crosses a preset's isolated group.
  const presets = ctx.get('agentPresets')
  return serviceIdentity(presets?.serviceFor(agent, 'compaction') ?? agent.ctx.get('compaction'))
 }
 const reconcile = async (agent, options = lastOptions) => {
  if (!active) return
  const engine = findEngine(agent)
  if (integration.has(agent) && integration.engineFor(agent) !== engine) await integration.detach(agent)
  if (!options.enabled) { await integration.detach(agent); return }
  if (!integration.has(agent)) integration.attach(ctx, agent, engine, options)
 }
 const enqueue = operation => {
  const task = queue.then(operation)
  queue = task.catch(log)
  return task
 }
 ctx.effect(() => async () => {
  active = false
  // Restore default behavior immediately, then drain already scheduled work.
  await integration.dispose()
  await queue
 }, 'compact-codex: reversible compaction adapter')
 ctx.on('agent/created', ({ agent }) => enqueue(() => reconcile(agent)))
 ctx.on('agent/disposed', ({ agent }) => enqueue(() => integration.detach(agent)))
 ctx.on('agent/pre-step', async ({ agent }, next) => {
  await enqueue(() => reconcile(agent))
  return next()
 }, { prepend: true })
 ctx.on('loader/volatile-update', () => enqueue(async () => {
  if (!active) return
  const options = resolveOptions(config.options)
  if (JSON.stringify(options) === JSON.stringify(lastOptions)) return
  lastOptions = options
  for (const agent of ctx.agents.list()) {
   await integration.detach(agent)
   if (active) await reconcile(agent, options)
  }
 }))
 for (const agent of ctx.agents.list()) await reconcile(agent)
}
