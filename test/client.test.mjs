import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const defaults = {
  enabled: true, handoffTokens: 20000, budgetContext: false, preCompactNudge: true,
  keepalive: false, cacheTtlMs: 3600000, keepaliveAfterMs: 3120000,
  minCacheReadTokens: 40000, idleKeepaliveBudget: 3, maxConsecutiveFailures: 2,
  coldSwitch: false, coldMinTokens: 100000, checkEveryMs: 15000
}
const numeric = new Set(['handoffTokens', 'cacheTtlMs', 'keepaliveAfterMs', 'minCacheReadTokens', 'idleKeepaliveBudget', 'maxConsecutiveFailures', 'coldMinTokens', 'checkEveryMs'])
const plain = value => JSON.parse(JSON.stringify(value))

function harness({ snapshot = { status: 'ready', writable: true, value: { options: defaults } }, service = true, language = 'en', failGet = false } = {}) {
  const slots = [], definitions = [], styles = [], effects = [], optional = [], listeners = new Set(), writes = []
  const dictionaries = new Map(), optionalDisposers = new Set()
  let plugin, hookIndex = 0, hooks = [], pendingEffects = [], component, tree, result = true
  const React = {
    createElement(type, props, ...children) { return { type, props: { ...props, children: children.flat(Infinity) } } },
    memo: fn => fn,
    useState(initial) { const i = hookIndex++; if (!(i in hooks)) hooks[i] = typeof initial === 'function' ? initial() : initial; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v }] },
    useRef(initial) { const i = hookIndex++; return hooks[i] ??= { current: initial } },
    useEffect(fn, deps) { const i = hookIndex++; const prev = hooks[i]; if (!prev || deps.some((v, j) => !Object.is(v, prev.deps[j]))) pendingEffects.push(() => { prev?.off?.(); hooks[i] = { deps, off: fn() } }) },
    useSyncExternalStore(subscribe, getSnapshot) { React.useEffect(() => subscribe(() => {}), [subscribe]); return getSnapshot() }
  }
  const form = {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    async set(key, value) { writes.push([key, plain(value)]); const accepted = typeof result === 'function' ? await result() : result; if (accepted) publish({ ...snapshot, value: { options: plain(value) } }); return accepted }
  }
  const forms = { get(id) { assert.equal(id, 'compact-codex'); if (failGet) throw new Error('forms denied'); return form } }
  function publish(value) { snapshot = value; for (const fn of listeners) fn() }
  const document = {
    createElement: () => { const tag = { dataset: {}, textContent: '', remove() { const i = styles.indexOf(tag); if (i >= 0) styles.splice(i, 1) } }; return tag },
    querySelectorAll: () => [...styles], querySelector: () => styles[0] ?? null,
    head: { appendChild(tag) { styles.push(tag) }, querySelectorAll: () => [...styles] }
  }
  vm.runInNewContext(client, { window: { __ModuleLoader__: { load(value) { assert.equal(value.id, 'dsh-compact-codex'); plugin = value.factory(name => { assert.equal(name, 'react'); return React }) } } }, document })
  const ctx = {
    effect(fn) { const off = fn(); if (typeof off === 'function') effects.push(off); return off },
    locale: { register(ns, value) { dictionaries.set(ns, value); return () => dictionaries.delete(ns) }, bind(ns) { return key => dictionaries.get(ns)?.[language]?.[key] ?? key } },
    slots: { inject(name, fn) { return ctx.effect(fn) }, register(options, Component) { const entry = { options, Component }; slots.push(entry); return () => slots.splice(slots.indexOf(entry), 1) } },
    uiConversation: { events: { register(value) { definitions.push(value); return () => definitions.splice(definitions.indexOf(value), 1) } } },
    inject(names, fn) {
      assert.deepEqual(plain(names), ['configForms'])
      const activate = () => {
        const owned = []
        fn({ ...ctx, configForms: forms, effect(fn) { const off = fn(); if (typeof off === 'function') owned.push(off) } })
        const dispose = () => { for (const off of owned.splice(0).reverse()) off(); optionalDisposers.delete(dispose) }
        optionalDisposers.add(dispose); effects.push(dispose)
      }
      optional.push(activate); if (service) activate()
    }
  }
  plugin.apply(ctx)
  function render(view = 'page') { hookIndex = 0; pendingEffects = []; tree = component({ view, t: ctx.locale.bind('compact-codex') }); for (const fn of pendingEffects) fn(); return tree }
  function page() { component = slots.find(v => v.options.name === 'plugins.bundle.config')?.Component; assert.ok(component, 'bundle detail config registered'); return render() }
  function nodes(node = tree) { if (node == null || typeof node !== 'object') return []; return [node, ...node.props.children.flatMap(nodes)] }
  const text = (node = tree) => typeof node === 'string' || typeof node === 'number' ? String(node) : node?.props?.children.map(text).join(' ') ?? ''
  return { plugin, ctx, slots, definitions, styles, writes, dictionaries, form, publish, page, render, nodes, text, setResult(value) { result = value }, enableService() { optional.at(-1)() }, disableService() { for (const off of [...optionalDisposers]) off() }, subscriptionCount: () => listeners.size, dispose() { for (const hook of hooks) hook?.off?.(); for (const fn of effects.reverse()) fn() }, input(name) { return nodes().find(n => n.type === 'input' && n.props.name === name) }, button(action) { return nodes().find(n => n.type === 'button' && n.props['data-action'] === action) } }
}

const event = (text, source = 'compact-checkpoint') => ({ type: 'user/message', seq: 12, data: { source: { kind: source }, content: [{ type: 'text', text }] } })
const handoff = 'Earlier context.\n<compacted-summary>\n# 上下文交接\n## 最近的用户请求\n- [#11] finish work\n</compacted-summary>'

test('only plugin checkpoints claim the chat event; generic/user/spoofed checkpoints remain untouched', () => {
  const h = harness(), definition = h.definitions[0]
  assert.ok(definition.match(event(handoff)))
  assert.equal(definition.match(event(handoff)).exclusive, true)
  for (const e of [event(handoff, 'user'), event('<compacted-summary>generic summary</compacted-summary>'), event('# 上下文交接 suffix'), event('quoted: # 上下文交接'), { type: 'user/message' }, { type: 'assistant/message', data: event(handoff).data }]) assert.equal(definition.match(e), null)
  const state = definition.start({}, { event: event(handoff) })
  assert.equal(state.text.startsWith('# 上下文交接'), true)
  assert.equal(state.text.includes('compacted-summary'), false)
  const node = definition.buildViewNode({ state, key: 'k', id: '12' })
  assert.equal(node.kind, 'compact-codex-handoff')
  assert.equal(node.data.summary, '[#11] finish work')
  h.dispose()
})

test('styles refresh per apply, remain scoped, and all registrations dispose', () => {
  const h = harness()
  assert.equal(h.styles.length, 1)
  assert.doesNotMatch(h.styles[0].textContent, /compactionRow|display:none!important/)
  const old = h.styles[0]
  h.plugin.apply(h.ctx)
  assert.equal(h.styles.length, 1)
  assert.notEqual(h.styles[0], old)
  h.dispose()
  assert.equal(h.styles.length, 0)
  assert.equal(h.definitions.length, 0)
  assert.equal(h.slots.length, 0)
})

test('bundle detail slot uses package key, optional configForms, and bilingual locale', () => {
  const h = harness()
  assert.ok(!h.plugin.inject.includes('configForms'))
  const entry = h.slots.find(v => v.options.name === 'plugins.bundle.config')
  assert.equal(entry?.options.key, 'dsh-compact-codex')
  assert.equal(entry?.options.locale, 'compact-codex')
  assert.ok(!h.slots.some(v => v.options.name === 'settings.section'))
  assert.deepEqual(Object.keys(h.dictionaries.get('compact-codex').en).sort(), Object.keys(h.dictionaries.get('compact-codex').zh).sort())
  h.page()
  for (const [key, value] of Object.entries(defaults)) assert.equal(h.input(key).props[numeric.has(key) ? 'value' : 'checked'], value)
  h.dispose()
})

test('staged edits save the entire options object and show accepted status', async () => {
  const h = harness({ snapshot: { status: 'ready', writable: true, value: { options: { ...defaults, futureOption: 7 } } } })
  h.page()
  h.input('keepalive').props.onChange({ target: { checked: true } }); h.render()
  assert.equal(h.writes.length, 0)
  await h.button('save').props.onClick(); h.render()
  assert.deepEqual(h.writes, [['options', { ...defaults, keepalive: true, futureOption: 7 }]])
  assert.match(h.text(), /Saved/)
  h.dispose()
})

test('rejects invalid token budgets without writes and resets draft from accepted snapshot', async () => {
  const h = harness(); h.page()
  for (const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity']) {
    h.input('handoffTokens').props.onChange({ target: { value } }); h.render()
    await h.button('save').props.onClick(); h.render()
    assert.equal(h.writes.length, 0)
    assert.match(h.text(), /integer between 1000 and 64000/)
  }
  h.button('reset').props.onClick(); h.render()
  assert.equal(h.input('handoffTokens').props.value, 20000)
  h.dispose()
})

test('estimated handoff budgets enforce Host bounds in both locales and accept inclusive edges', async () => {
  for (const language of ['en', 'zh']) {
    const h = harness({ language }); h.page()
    assert.equal(h.input('handoffTokens').props.min, 1000)
    assert.equal(h.input('handoffTokens').props.max, 64000)
    assert.match(h.text(), language === 'en' ? /Estimated handoff token budget/ : /交接信息估算 token 预算/)
    for (const value of ['999', '64001']) {
      h.input('handoffTokens').props.onChange({ target: { value } }); h.render()
      await h.button('save').props.onClick(); h.render()
      assert.equal(h.writes.length, 0)
      assert.match(h.text(), language === 'en' ? /integer between 1000 and 64000/ : /1000–64000 之间的整数/)
    }
    for (const value of ['1000', '64000']) {
      h.input('handoffTokens').props.onChange({ target: { value } }); h.render()
      await h.button('save').props.onClick(); h.render()
      assert.equal(h.writes.at(-1)[1].handoffTokens, Number(value))
    }
    assert.equal(h.writes.length, 2)
    h.dispose()
  }
})

test('refusal and thrown Host errors are visible and preserve the draft', async () => {
  const h = harness(); h.page()
  h.input('enabled').props.onChange({ target: { checked: false } }); h.render()
  h.setResult(false); await h.button('save').props.onClick(); h.render()
  assert.match(h.text(), /not saved/i)
  assert.equal(h.input('enabled').props.checked, false)
  h.setResult(() => { throw new Error('Host says permission denied') }); await h.button('save').props.onClick(); h.render()
  assert.match(h.text(), /Host says permission denied/)
  h.dispose()
})

test('pending save disables edits and deduplicates rapid clicks', async () => {
  const h = harness(); h.page()
  h.input('coldSwitch').props.onChange({ target: { checked: false } }); h.render()
  let settle; h.setResult(() => new Promise(resolve => { settle = resolve }))
  const onClick = h.button('save').props.onClick
  const saving = onClick(); await onClick(); h.render()
  assert.equal(h.writes.length, 1)
  assert.equal(h.button('save').props.disabled, true)
  assert.equal(h.input('enabled').props.disabled, true)
  assert.match(h.text(), /Saving/)
  settle(true); await saving; h.render()
  assert.match(h.text(), /Saved/)
  h.dispose()
})

test('loading, absent and read-only snapshots cannot write, including stale handlers', async () => {
  for (const snapshot of [{ status: 'loading', writable: false }, { status: 'unavailable', writable: true }, { status: 'ready', writable: false, value: { options: defaults } }, { status: 'ready', writable: true, value: {} }]) {
    const h = harness({ snapshot }); h.page()
    assert.equal(h.input('enabled').props.disabled, true)
    await h.button('save').props.onClick()
    assert.equal(h.writes.length, 0)
    h.dispose()
  }
  const h = harness(); h.page()
  const save = h.button('save').props.onClick
  h.publish({ status: 'ready', writable: false, value: { options: defaults } })
  await save(); assert.equal(h.writes.length, 0)
  h.dispose()
})

test('configuration form groups fields into cards with per-field descriptions', () => {
  const h = harness({ language: 'zh' }); h.page()
  const nodes = h.nodes()
  assert.equal(nodes.filter(n => n.type === 'section' && n.props.className === 'ccc_card').length, 4)
  assert.equal(nodes.filter(n => n.type === 'p' && n.props.className === 'ccc_desc').length, Object.keys(defaults).length)
  assert.match(h.text(), /缓存保活和过期后自动换窗默认关闭/)
  assert.match(h.text(), /基础/)
  assert.match(h.text(), /缓存保活/)
  h.dispose()
  const e = harness({ language: 'en' }); e.page()
  assert.match(e.text(), /Keepalive and cache-expiry compaction are off by default/)
  assert.match(e.text(), /Diagnostics/)
  e.dispose()
})

test('bilingual help distinguishes estimated expiry, paid input and the keepalive timer', () => {
  for (const language of ['zh', 'en']) {
    const h = harness({ language }); h.page()
    const copy = h.dictionaries.get('compact-codex')[language]
    assert.match(copy.desc_keepalive, language === 'zh' ? /输入和缓存也可能计费/ : /input and cache tokens may also be billed/)
    assert.match(copy.desc_cacheTtlMs, language === 'zh' ? /不是服务商保证/ : /not a provider guarantee/)
    assert.match(copy.desc_coldSwitch, language === 'zh' ? /账本检查通过/ : /ledger check passes/)
    assert.match(copy.desc_handoffTokens, language === 'zh' ? /不是换窗触发阈值/ : /not the threshold/)
    assert.match(copy.cacheHint, language === 'zh' ? /不会恢复出厂默认值/ : /not factory defaults/)
    const cards = h.nodes().filter(n => n.type === 'section')
    assert.match(h.text(cards[1]), language === 'zh' ? /保活检查间隔/ : /Keepalive check interval/)
    assert.doesNotMatch(h.text(cards[2]), language === 'zh' ? /保活检查间隔/ : /Keepalive check interval/)
    h.dispose()
  }
})

test('defaults, external subscriptions, service removal and bilingual presentation remain consistent', () => {
  const h = harness({ snapshot: { status: 'ready', writable: true, value: { options: {} } }, language: 'zh' })
  h.page()
  for (const [key, value] of Object.entries(defaults)) assert.equal(h.input(key).props[numeric.has(key) ? 'value' : 'checked'], value)
  assert.match(h.text(), /保存/)
  h.render('summary'); assert.match(h.text(), /Codex/)
  h.render()
  h.publish({ status: 'ready', writable: true, value: { options: { ...defaults, enabled: false, handoffTokens: 30000 } } })
  h.render(); h.render()
  assert.equal(h.input('enabled').props.checked, false)
  assert.equal(h.input('handoffTokens').props.value, 30000)
  assert.equal(h.subscriptionCount(), 1)
  h.disableService(); h.render()
  assert.equal(h.subscriptionCount(), 0)
  assert.equal(h.input('enabled').props.disabled, true)
  assert.match(h.text(), /不可用/)
  assert.ok(h.definitions[0].match(event(handoff)))
  h.dispose()
})

test('each supported option is read from the Host and numeric edits save as numbers', async () => {
  const options = { enabled: false, handoffTokens: 10000, keepalive: true, coldSwitch: false, budgetContext: true }
  const h = harness({ snapshot: { status: 'ready', writable: true, value: { options } } }); h.page()
  for (const [key, value] of Object.entries(options)) assert.equal(h.input(key).props[numeric.has(key) ? 'value' : 'checked'], value)
  h.input('handoffTokens').props.onChange({ target: { value: '25000' } }); h.render()
  await h.button('save').props.onClick(); h.render()
  assert.deepEqual(h.writes, [['options', { ...defaults, ...options, handoffTokens: 25000 }]])
  assert.equal(h.nodes().find(n => n.props.role === 'alert'), undefined)
  h.dispose()
})

test('missing or broken optional service does not break the checkpoint renderer and recovers late', () => {
  for (const options of [{ service: false }, { failGet: true }]) {
    const h = harness(options); h.page()
    assert.equal(h.input('enabled').props.disabled, true)
    assert.ok(h.definitions[0].match(event(handoff)))
    assert.match(h.text(), /unavailable|forms denied/i)
    if (!options.failGet) { h.enableService(); h.render(); h.render(); assert.equal(h.input('enabled').props.disabled, false) }
    h.dispose()
  }
})
