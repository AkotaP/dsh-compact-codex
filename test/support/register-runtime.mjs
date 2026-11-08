/** Explicit offline test adapter. Production always uses DSH's runtime peers. */
import { registerHooks } from 'node:module'
const packages = new Map([
 ['@deepseek-ai/schemastery', 'schema.mjs'],
 ['@deepseek-ai/dsh-compaction-basic', 'basic.mjs'],
 ['@deepseek-ai/dsh-llm', 'llm.mjs'],
 ['@deepseek-ai/dsh-util-values', 'values.mjs'],
 ['@deepseek-ai/dsh-scope', 'scope.mjs']
])
registerHooks({ resolve(specifier, context, next) {
 const target = packages.get(specifier)
 return target ? { url: new URL(target, import.meta.url).href, shortCircuit: true } : next(specifier, context)
} })
