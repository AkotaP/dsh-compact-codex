export const scopeOf = ctx => ctx.scopeKey
export function createScope(ctx, key) {
 if (typeof ctx.createTestScope !== 'function') throw new Error('Test context must supply createTestScope(key)')
 return ctx.createTestScope(key)
}
