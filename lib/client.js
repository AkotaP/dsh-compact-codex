/**
 * dsh-compact-codex 的浏览器半侧。
 *
 * 仅装饰本插件产出的压缩交接消息，并在 bundle 详情页提供配置。
 *
 * 接法：
 *   1. `ctx.uiConversation.events.register()` 注册事件定义，`match` 认内容以
 *      `# 上下文交接` 开头且 source 为 compact-checkpoint 的消息；
 *   2. 把视图注册进 `conversation.chat.node` 这个 keyed slot，key 是 `buildViewNode()`
 *      产出的 `kind`，即 renderer key。
 *
 * 两条约束：
 *   - 除 React 基座外不 require 任何 `dsh-client-*` 包。抛错的组件会清空整个 slot 条目。
 *     控件与 Markdown 渲染都在本模块内实现，配色只用 `--dsw-alias-*` 主题 token。
 *   - factory 内不产生副作用；样式注入放在 `apply` 内，由 `ctx.effect` 管理生命周期。
 *
 * 产物是惰性 CJS factory：执行它只注册 factory，模块主体到物化时才跑。
 */

window.__ModuleLoader__.load({
	id: 'dsh-compact-codex',
	factory(require) {
		// 与已在用的第三方插件（dsh-purge、tavernweave-workbench）用同一骨架：
		// module/exports 包装、打 Module 标记、最后 return module.exports。
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const h = React.createElement

		/**
		 * 交接消息的识别标记：基类 `frameSummary` 把摘要包成
		 * `preamble + <compacted-summary> + 摘要 + </compacted-summary>`，
		 * 标签只用于剥离包装；身份识别必须同时校验 source 与独有正文标题。
		 */
		const HANDOFF_MARK = /^# 上下文交接(?:\r?\n|$)/
		/** 基类包裹摘要用的标签，渲染前要剥掉。 */
		const SUMMARY_OPEN = '<compacted-summary>'
		const SUMMARY_CLOSE = '</compacted-summary>'
		/** renderer key：既是事件定义的 kind，也是 slot 注册的 key。 */
		const NODE_KIND = 'compact-codex-handoff'

		const CSS = [
			'.ccc_row{border-left:2px solid var(--dsw-alias-state-business-primary);',
			'background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,var(--dsw-alias-state-business-primary) 12%);',
			'border-radius:var(--dsw-radius-sm);padding:6px 10px;margin:2px 0}',
			'.ccc_head{align-items:center;gap:6px;cursor:pointer;user-select:none;list-style:none;',
			'font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(22px + var(--dsh-content-font-delta-secondary,0px));',
			'color:var(--dsw-alias-label-tertiary);display:flex}',
			'.ccc_head::-webkit-details-marker{display:none}',
			'.ccc_head:hover{color:var(--dsw-alias-label-secondary)}',
			'.ccc_dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}',
			'.ccc_label{font-weight:600;color:var(--dsw-alias-label-primary);flex:none}',
			'.ccc_meta{color:inherit;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:auto}',
			'.ccc_body{margin:6px 0 0;padding:8px 0 0;border-top:1px solid var(--dsw-alias-border-l1);',
			'color:var(--dsw-alias-label-secondary);word-break:break-word;',
			'font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
			'.ccc_h1{font-weight:600;color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size-secondary,13px) + 2px);margin:0 0 4px}',
			'.ccc_h2{font-weight:600;color:var(--dsw-alias-label-primary);margin:10px 0 2px}',
			'.ccc_p{margin:0}',
			'.ccc_gap{height:6px}',
			'.ccc_quote{border-left:2px solid color-mix(in srgb,var(--dsw-alias-label-tertiary) 55%,transparent);padding-left:8px;color:var(--dsw-alias-label-tertiary);margin:1px 0}',
			'.ccc_li{padding-left:14px;text-indent:-14px;margin:0}',
			'.ccc_code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
			'color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,var(--dsw-alias-label-tertiary) 20%);border-radius:3px;padding:0 3px}',
			'.ccc_hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:8px 0}',
			'.ccc_config{display:grid;gap:12px;color:var(--dsw-alias-label-primary)}',
			'.ccc_field{display:grid;gap:4px}',
			'.ccc_opt{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
			'.ccc_desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}',
			'.ccc_card{display:grid;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 92%,var(--dsw-alias-label-tertiary) 8%)}',
			'.ccc_card_title{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
			'.ccc_hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px}',
			'.ccc_actions{display:flex;gap:8px}',
			'.ccc_config input[type=number]{width:140px}',
			'.ccc_config button,.ccc_config input[type=number]{color:inherit;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:5px 9px}',
			'.ccc_config :disabled{opacity:.5;cursor:not-allowed}',
			'.ccc_feedback{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}',
			'.ccc_error{color:var(--dsw-alias-state-error-primary)}',
			'.ccc_success{color:var(--dsw-alias-state-success-primary)}'
		].join('')

		/** 从消息内容块里取出纯文本。 */
		function textOf(content) {
			if (!Array.isArray(content)) return ''
			const parts = []
			for (const block of content) {
				if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
			}
			return parts.join('\n')
		}

		/**
		 * 行内渲染：把 `代码` 与 **粗体** 变成元素，其余保持文本。
		 */
		function inline(text, keyBase) {
			const parts = []
			const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
			let cursor = 0
			let index = 0
			let match = pattern.exec(text)
			while (match !== null) {
				if (match.index > cursor) parts.push(text.slice(cursor, match.index))
				const token = match[0]
				if (token.charCodeAt(0) === 96) parts.push(h('code', { key: `${keyBase}-c${index}`, className: 'ccc_code' }, token.slice(1, -1)))
				else parts.push(h('strong', { key: `${keyBase}-b${index}` }, token.slice(2, -2)))
				index += 1
				cursor = match.index + token.length
				match = pattern.exec(text)
			}
			if (cursor < text.length) parts.push(text.slice(cursor))
			return parts.length === 0 ? '' : parts
		}

		/** 行级渲染：标题、引用、列表、分隔线各归各的样式。 */
		function body(text) {
			return text.split('\n').map((line, index) => {
				const key = `l${index}`
				if (line.startsWith('# ')) return h('div', { key, className: 'ccc_h1' }, inline(line.slice(2), key))
				if (line.startsWith('## ')) return h('div', { key, className: 'ccc_h2' }, inline(line.slice(3), key))
				if (line.startsWith('> ')) return h('div', { key, className: 'ccc_quote' }, inline(line.slice(2), key))
				if (line.startsWith('- ')) return h('div', { key, className: 'ccc_li' }, ['· ', ...inline(line.slice(2), key)])
				if (line.trim() === '---') return h('hr', { key, className: 'ccc_hr' })
				if (line.trim() === '') return h('div', { key, className: 'ccc_gap' })
				return h('div', { key, className: 'ccc_p' }, inline(line, key))
			})
		}

		/**
		 * 从检查点消息里剥出交接信息本体：去掉基类的 preamble 与
		 * `<compacted-summary>` 包裹，只留要渲染的那部分。
		 */
		function handoffBody(raw) {
			const open = raw.indexOf(SUMMARY_OPEN)
			if (open === -1) return raw.trim()
			const from = open + SUMMARY_OPEN.length
			const close = raw.lastIndexOf(SUMMARY_CLOSE)
			return (close === -1 ? raw.slice(from) : raw.slice(from, close)).trim()
		}

		/** 交接卡片的渲染。数据来自 `buildViewNode().data`，组件无状态。 */
		const HandoffView = React.memo(function HandoffView({ node, t }) {
			const text = node?.data?.text ?? ''
			const summary = node?.data?.summary ?? ''
			return h('details', { className: 'ccc_row' }, [
				h('summary', { className: 'ccc_head', key: 'head' }, [
					h('span', { className: 'ccc_dot', key: 'dot', 'aria-hidden': true }),
					h('span', { className: 'ccc_label', key: 'label' }, t('handoff')),
					h('span', { className: 'ccc_meta', key: 'meta' }, summary)
				]),
				h('div', { className: 'ccc_body', key: 'body' }, body(text))
			])
		})

		/** 摘出折叠行右侧要显示的一句话：交接信息里「最近的用户请求」的第一条。 */
		function firstRequestLine(text) {
			const lines = text.split('\n')
			// 两种编号写法都要认：`#123`（行内代码）与 [#123]；编号前可能带列表符号
			// 或空白，所以这里放宽到"行首符号 + 编号"，并把符号剥掉再显示。
			const at = lines.findIndex((line) => /^\s*[-·*]\s*(?:`#\d+`|\[#\d+\])/.test(line))
			if (at !== -1) return lines[at].replace(/^\s*[-·*]\s*/, '')
			// 退路要跳过标题与引用：开场白是 `> …`，落回它会让折叠行显示一句泛泛的
			// 说明，而不是这一条交接到底讲了什么。
			const head = lines.find((line) => {
				const trimmed = line.trim()
				return trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('>')
			})
			return head ?? ''
		}

		/** 交接消息的事件定义；`match` 是唯一把它和普通 user 消息区分开的地方。 */
		const handoffDefinition = {
			kind: NODE_KIND,
			target: 'chat',
			match: (event) => {
				if (event?.type !== 'user/message' || event.data?.source?.kind !== 'compact-checkpoint') return null
				if (!HANDOFF_MARK.test(handoffBody(textOf(event.data?.content)))) return null
				return { id: String(event.seq), role: 'start', exclusive: true }
			},
			start: (_context, match) => ({
				seq: match.event.seq,
				text: handoffBody(textOf(match.event.data?.content))
			}),
			update: (context) => context.state,
			buildViewNode: (context) => {
				if (context.state === undefined) return null
				const text = context.state.text ?? ''
				return {
					key: context.key,
					kind: NODE_KIND,
					id: context.id,
					target: 'chat',
					anchorSeq: context.state.seq - 0.1,
					location: context.start?.location ?? { kind: 'unresolved' },
					visibility: 'visible',
					data: { text, summary: firstRequestLine(text) }
				}
			}
		}


		const NS = 'compact-codex'
		const DEFAULTS = {
			enabled: true, handoffTokens: 20000, budgetContext: false,
			keepalive: false, cacheTtlMs: 3600000, keepaliveAfterMs: 3120000,
			minCacheReadTokens: 40000, idleKeepaliveBudget: 3, maxConsecutiveFailures: 2,
			coldSwitch: false, coldMinTokens: 100000, checkEveryMs: 15000
		}
		const NUMERIC_SPECS = {
			handoffTokens: { min: 1000, max: 64000 },
			cacheTtlMs: { min: 1000 }, keepaliveAfterMs: { min: 1000 },
			minCacheReadTokens: { min: 0 }, idleKeepaliveBudget: { min: 0 },
			maxConsecutiveFailures: { min: 1 }, coldMinTokens: { min: 0 }, checkEveryMs: { min: 1000 }
		}
		const zh = {
			handoff: '上下文交接', summary: 'Codex 风格上下文交接与缓存策略',
			enabled: '启用 Codex 压缩引擎', handoffTokens: '交接信息估算 token 预算',
			budgetContext: '追加上下文预算提示',
			keepalive: '空闲缓存保活', cacheTtlMs: '缓存 TTL 假设（毫秒）',
			keepaliveAfterMs: '空闲多久后开始保活（毫秒）', minCacheReadTokens: '保活前缀下限（token）',
			idleKeepaliveBudget: '每轮空闲最多保活次数', maxConsecutiveFailures: '连续失败上限',
			coldSwitch: '冷缓存自动压缩', coldMinTokens: '冷换窗上下文下限（token）',
			checkEveryMs: '缓存检查周期（毫秒）',
			section_basics: '基础', section_keepalive: '缓存保活（付费）',
			section_cold: '冷缓存换窗', section_diagnostics: '诊断',
			desc_enabled: '关闭后恢复官方压缩行为：不再生成交接信息，也不注册账本与检索工具。',
			desc_handoffTokens: '交接信息的目标预算；超出后按优先级截断，不是硬性上限。',
			desc_budgetContext: '向模型注入 token 预算与缓存冷热读数；关闭时只保留一条不含数字的压缩点提示。',
			desc_keepalive: '空闲时发一个只回 1 token 的请求维持缓存命中；会产生真实请求与费用，默认关闭。',
			desc_cacheTtlMs: 'provider 侧缓存 TTL 的假设值；超过即视为已冷，不再保活。真实值不下发，只能估。',
			desc_keepaliveAfterMs: '空闲多久后开始第一次保活。太早浪费额度，太晚缓存已经过期。',
			desc_minCacheReadTokens: '跟踪到的缓存前缀低于此值时不保活；小前缀保活不划算。',
			desc_idleKeepaliveBudget: '两次真实请求之间最多发几次保活，防止空闲时无限烧额度。',
			desc_maxConsecutiveFailures: '连续保活失败达到此数后停止，不再重试。',
			desc_coldSwitch: '缓存过期后，在下一步之前主动换窗；不调模型，但会改变压缩时机。默认关闭。',
			desc_coldMinTokens: '上下文低于此值时即使缓存已冷也不换窗，避免压掉太短的会话。',
			desc_checkEveryMs: '后台检查缓存状态的周期；越短越灵敏，也越频繁读状态。',
			cacheHint: '两个自动行为默认都关闭，需要时再打开；数值参数只在对应开关开启后生效。',
			save: '保存', reset: '重置编辑', saved: '已保存，配置已由宿主接受。', saving: '正在保存…',
			failed: '配置未保存：宿主拒绝了写入，请检查权限并重试。',
			invalid: '交接信息估算 token 预算必须是 1000–64000 之间的整数。',
			invalidNumber: '数值字段必须是允许范围内的整数。',
			loading: '正在读取配置…', unavailable: '配置服务或插件配置不可用。', readonly: '配置为只读，不能保存。'
		}
		const en = {
			handoff: 'Context handoff', summary: 'Codex-style context handoff and cache policy',
			enabled: 'Enable the Codex compaction engine', handoffTokens: 'Estimated handoff token budget',
			budgetContext: 'Append context budget hints',
			keepalive: 'Keep idle cache alive', cacheTtlMs: 'Assumed cache TTL (ms)',
			keepaliveAfterMs: 'Idle time before keepalive (ms)', minCacheReadTokens: 'Minimum cached prefix (tokens)',
			idleKeepaliveBudget: 'Max keepalives per idle period', maxConsecutiveFailures: 'Consecutive failure limit',
			coldSwitch: 'Compact on a cold cache', coldMinTokens: 'Minimum context for cold-cache switch (tokens)',
			checkEveryMs: 'Cache check interval (ms)',
			section_basics: 'Basics', section_keepalive: 'Cache keepalive (paid)',
			section_cold: 'Cold-cache switching', section_diagnostics: 'Diagnostics',
			desc_enabled: 'Turning this off restores official compaction: no handoff generation and no ledger or history tools.',
			desc_handoffTokens: 'Target budget for the handoff; longer content is truncated by priority, not a hard cap.',
			desc_budgetContext: 'Injects token budget and cache hot/cold readings; when off, only one numeric-free warning at the compaction point remains.',
			desc_keepalive: 'Sends a one-token request while idle to keep the cache hit; real requests and charges apply. Off by default.',
			desc_cacheTtlMs: 'Assumed provider cache TTL; past it the cache counts as cold and keepalive stops. The real TTL is not exposed.',
			desc_keepaliveAfterMs: 'Idle time before the first keepalive. Too early wastes budget; too late and the cache is already gone.',
			desc_minCacheReadTokens: 'No keepalive when the tracked cache prefix is below this size; small prefixes are not worth keeping.',
			desc_idleKeepaliveBudget: 'Maximum keepalives between two real requests, capping idle spend.',
			desc_maxConsecutiveFailures: 'Keepalive stops after this many consecutive failures.',
			desc_coldSwitch: 'Compacts before the next step once the cache expired. Makes no model request, but changes compaction timing. Off by default.',
			desc_coldMinTokens: 'No cold-cache switch when the context is below this size, so short sessions are not compacted.',
			desc_checkEveryMs: 'How often cache state is checked in the background; shorter is more responsive but reads state more often.',
			cacheHint: 'Both automatic behaviors are off by default; turn them on when needed. Numeric options only apply while their behavior is enabled.',
			save: 'Save', reset: 'Reset edits', saved: 'Saved. The Host accepted the configuration.', saving: 'Saving…',
			failed: 'Configuration not saved: the Host refused the write. Check permissions and retry.',
			invalid: 'The estimated handoff token budget must be an integer between 1000 and 64000.',
			invalidNumber: 'Numeric fields must be integers within their allowed ranges.',
			loading: 'Loading configuration…', unavailable: 'Configuration service or plugin configuration unavailable.', readonly: 'Configuration is read-only; saving is disabled.'
		}

		function optionsOf(snapshot) {
			const options = snapshot?.value?.options
			return options && typeof options === 'object' && !Array.isArray(options) ? options : undefined
		}
		function editable(state) {
			return state.form && state.snapshot?.status === 'ready' && state.snapshot.writable === true && optionsOf(state.snapshot) !== undefined
		}
		function draftOf(snapshot) {
			const options = optionsOf(snapshot) ?? {}
			return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, options[key] ?? value]))
		}

		// One plugin-owned source bridges the optional service lifetime into mounted React views.
		// Never cache a service past its ctx.inject scope, nor let a failed form break Chat.
		function configSource() {
			let state = { form: null, snapshot: null, error: '' }
			const listeners = new Set()
			const publish = next => { state = next; for (const fn of listeners) fn() }
			return {
				getSnapshot: () => state,
				subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
				bind(forms) {
					let off
					try {
						const form = forms.get('compact-codex')
						const sync = () => {
							try { publish({ form, snapshot: form.getSnapshot(), error: '' }) }
							catch (error) { publish({ form: null, snapshot: null, error: String(error?.message ?? error) }) }
						}
						off = form.subscribe(sync)
						sync()
					} catch (error) { publish({ form: null, snapshot: null, error: String(error?.message ?? error) }) }
					return () => { off?.(); publish({ form: null, snapshot: null, error: '' }) }
				}
			}
		}

		function configView(source) {
			return function ConfigView({ t, view }) {
				const state = React.useSyncExternalStore(source.subscribe, source.getSnapshot)
				const [draft, setDraft] = React.useState(() => draftOf(state.snapshot))
				const [dirty, setDirty] = React.useState(false)
				const [saving, setSaving] = React.useState(false)
				const [feedback, setFeedback] = React.useState(null)
				const pending = React.useRef(false)
				const alive = React.useRef(true)
				React.useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
				React.useEffect(() => {
					if (!dirty && !pending.current) setDraft(draftOf(state.snapshot))
				}, [state.snapshot, dirty])
				if (view === 'summary') return h('span', null, t('summary'))
				const disabled = !editable(state) || saving
				const change = (key, value) => {
					if (!editable(source.getSnapshot()) || pending.current) return
					setDraft(previous => ({ ...previous, [key]: value })); setDirty(true); setFeedback(null)
				}
				const save = async () => {
					const current = source.getSnapshot()
					if (pending.current || !editable(current)) return
					const numbers = {}
					for (const [key, spec] of Object.entries(NUMERIC_SPECS)) {
						const value = Number(draft[key])
						if (!Number.isSafeInteger(value) || value < spec.min || (spec.max !== undefined && value > spec.max)) {
							setFeedback({ error: true, key: key === 'handoffTokens' ? 'invalid' : 'invalidNumber' }); return
						}
						numbers[key] = value
					}
					pending.current = true; setSaving(true); setFeedback(null)
					try {
						// Preserve options unknown to this UI, including values received since editing began.
						const options = { ...optionsOf(current.snapshot), ...draft, ...numbers }
						const accepted = await current.form.set('options', options)
						if (!alive.current) return
						if (accepted) {
							setDraft(draftOf(source.getSnapshot().snapshot)); setDirty(false)
							setFeedback({ error: false, key: 'saved' })
						} else setFeedback({ error: true, key: 'failed' })
					} catch (error) {
						if (alive.current) setFeedback({ error: true, key: 'failed', detail: String(error?.message ?? error) })
					} finally { pending.current = false; if (alive.current) setSaving(false) }
				}
				const reset = () => {
					if (pending.current) return
					setDraft(draftOf(source.getSnapshot().snapshot)); setDirty(false); setFeedback(null)
				}
				const SECTIONS = [
					{ id: 'basics', title: t('section_basics'), fields: ['enabled', 'handoffTokens'] },
					{ id: 'keepalive', title: t('section_keepalive'), fields: ['keepalive', 'cacheTtlMs', 'keepaliveAfterMs', 'minCacheReadTokens', 'idleKeepaliveBudget', 'maxConsecutiveFailures'] },
					{ id: 'cold', title: t('section_cold'), fields: ['coldSwitch', 'coldMinTokens', 'checkEveryMs'] },
					{ id: 'diagnostics', title: t('section_diagnostics'), fields: ['budgetContext'] }
				]
				const fields = SECTIONS.map(section => h('section', { key: section.id, className: 'ccc_card' }, [
					h('h4', { key: 'title', className: 'ccc_card_title' }, section.title),
					...section.fields.map(key => h('div', { key, className: 'ccc_field' }, [
						h('label', { key: 'opt', className: 'ccc_opt' }, [
							h('input', NUMERIC_SPECS[key]
								? { key: 'input', name: key, type: 'number', min: NUMERIC_SPECS[key].min, max: NUMERIC_SPECS[key].max, step: 1, value: draft[key], disabled, onChange: event => change(key, event.target.value) }
								: { key: 'input', name: key, type: 'checkbox', checked: draft[key], disabled, onChange: event => change(key, event.target.checked) }),
							h('span', { key: 'text' }, t(key))
						]),
						h('p', { key: 'desc', className: 'ccc_desc' }, t('desc_' + key))
					]))
				]))
				let notice = ''
				if (state.snapshot?.status === 'loading') notice = t('loading')
				else if (!state.form || state.snapshot?.status !== 'ready' || !optionsOf(state.snapshot)) notice = t('unavailable')
				else if (!state.snapshot.writable) notice = t('readonly')
				return h('div', { className: 'ccc_config', 'aria-busy': saving }, [
					...fields,
					h('p', { key: 'hint', className: 'ccc_hint' }, t('cacheHint')),
					h('div', { key: 'actions', className: 'ccc_actions' }, [
						h('button', { key: 'save', type: 'button', 'data-action': 'save', disabled, onClick: save }, t(saving ? 'saving' : 'save')),
						h('button', { key: 'reset', type: 'button', 'data-action': 'reset', disabled: saving, onClick: reset }, t('reset'))
					]),
					h('p', { key: 'notice', role: 'status', className: 'ccc_hint' }, [notice, state.error]),
					feedback && h('p', { key: 'feedback', role: feedback.error ? 'alert' : 'status', className: 'ccc_feedback ' + (feedback.error ? 'ccc_error' : 'ccc_success') }, [t(feedback.key), feedback.detail ? ' ' + feedback.detail : ''])
				])
			}
		}

		// Cordis 服务依赖。`uiConversation` 必须在这里声明——apply 里会用
		// `ctx.uiConversation.events.register(...)`，没声明的话它是 undefined，
		// apply 一抛错 fiber 就变成 failed，启动期报 `entry did not activate`。
		// 官方的 dsh-client-ui-goal 同样是靠 inject 拿到它的（见其 client.js 的
		// ["slots","sessions","remote","remote.goals","locale","uiConversation"]）。
		const inject = ['slots', 'uiConversation', 'locale']

		/** 插件激活：注入样式，注册事件定义与 renderer。 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'compact-codex: locale')
			const source = configSource()
			ctx.inject(['configForms'], scope => {
				scope.effect(() => source.bind(scope.configForms), 'compact-codex: optional configuration')
			})
			ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
				name: 'plugins.bundle.config', key: 'dsh-compact-codex', locale: NS
			}, configView(source)))
			// 样式随插件生命周期注入与移除，不让它留在 document.head 里。
			ctx.effect(() => {
				if (typeof document === 'undefined') return () => {}
				const tagId = 'dsh-compact-codex/handoff.css'
				document.head.querySelectorAll(`style[data-plugin-css=${JSON.stringify(tagId)}]`).forEach(tag => tag.remove())
				const tag = document.createElement('style')
				tag.dataset.plugin = 'dsh-compact-codex'
				tag.dataset.pluginCss = tagId
				tag.textContent = CSS
				document.head.appendChild(tag)
				return () => tag.remove()
			}, 'compact-codex: styles')
			ctx.effect(() => ctx.uiConversation.events.register(handoffDefinition), 'compact-codex: checkpoint')
			ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
				name: 'conversation.chat.node',
				key: NODE_KIND,
				locale: NS
			}, HandoffView))
		}

		exports.name = 'dsh-compact-codex'
		exports.inject = inject
		exports.apply = apply
		return module.exports
	}
})
