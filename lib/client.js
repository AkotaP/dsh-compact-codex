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
			enabled: true, handoffTokens: 20000, budgetContext: false, preCompactNudge: true,
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
			handoff: '上下文交接', summary: 'Codex 风格代码交接、任务账本与缓存设置',
			enabled: '启用代码交接', handoffTokens: '交接信息估算 token 预算',
			budgetContext: '向模型显示上下文用量', preCompactNudge: '换窗前提醒记录进度',
			keepalive: '启用空闲缓存保活（付费）', cacheTtlMs: '估计缓存有效期（毫秒）',
			keepaliveAfterMs: '保活等待时间（毫秒）', minCacheReadTokens: '保活所需的最小缓存量（token）',
			idleKeepaliveBudget: '每次空闲最多保活次数', maxConsecutiveFailures: '连续失败多少次后停止保活',
			coldSwitch: '缓存估计过期后自动换窗', coldMinTokens: '自动换窗所需的最小上下文（token）',
			checkEveryMs: '保活检查间隔（毫秒）',
			section_basics: '基础', section_keepalive: '缓存保活（付费）',
			section_cold: '缓存过期后换窗', section_diagnostics: '诊断',
			desc_enabled: '用程序生成交接信息，代替模型摘要；自动压缩阈值仍由 DSH 管理。关闭后恢复官方行为，并停用本插件的账本、检索和缓存功能，已有交接记录不变。',
			desc_handoffTokens: '控制交接信息的目标长度，不是换窗触发阈值。内容过长时按优先级截断；token 数为估算值，不保证严格小于预算。',
			desc_budgetContext: '向模型提供 token 用量、压缩阈值和缓存状态估算。关闭后仍可能在压缩点或换窗前发送进度提醒。',
			desc_preCompactNudge: '达到自动压缩阈值且进度未及时记录时，推迟一次压缩，让模型先记录进度。同一窗口最多推迟一次；不保证模型会完成记录。',
			desc_keepalive: '空闲时发送额外模型请求，尝试延长缓存有效期。最多输出 1 token，但输入和缓存也可能计费；不保证缓存命中。默认关闭。',
			desc_cacheTtlMs: '从最近一次确认有缓存的请求起估算有效期，供保活和自动换窗共用。到期后停止保活；这不是服务商保证的过期时间。默认 3600000 毫秒（60 分钟）。',
			desc_keepaliveAfterMs: '距上次确认有缓存的请求多久后尝试保活。应短于估计缓存有效期，否则不会保活。默认 3120000 毫秒（52 分钟）。',
			desc_minCacheReadTokens: '已观测到的缓存 token 少于此值时，不发送保活请求。',
			desc_idleKeepaliveBudget: '两次正常模型请求之间最多发送多少次保活请求，限制空闲开销。设为 0 则不发送。',
			desc_maxConsecutiveFailures: '保活连续失败达到此次数后停止；观测到新的正常请求后重新计数。',
			desc_coldSwitch: '曾确认有缓存、估计有效期已过、上下文达到下限且账本检查通过时，在下一步前主动换窗。交接生成不调用模型，但后续请求会重新处理上下文。默认关闭。',
			desc_coldMinTokens: '只限制缓存过期触发的主动换窗，不影响 DSH 原有的自动压缩阈值。',
			desc_checkEveryMs: '启用保活后，后台每隔多久检查一次。自动换窗在模型下一步前检查，不受此间隔控制。默认 15000 毫秒（15 秒）。',
			cacheHint: '缓存保活和过期后自动换窗默认关闭。修改后点击“保存”才生效；“撤销未保存修改”会恢复已保存值，不会恢复出厂默认值。',
			save: '保存', reset: '撤销未保存修改', saved: '已保存，宿主已接受配置。', saving: '正在保存…',
			failed: '未保存：宿主未接受配置，请检查错误信息或配置状态后重试。',
			invalid: '交接信息估算 token 预算必须是 1000–64000 之间的整数。',
			invalidNumber: '数值必须是输入框允许范围内的整数。',
			loading: '正在读取配置…', unavailable: '配置暂不可用，请确认插件和配置服务已启用。', readonly: '配置为只读，不能保存。'
		}
		const en = {
			handoff: 'Context handoff', summary: 'Codex-style code handoff, task ledger and cache settings',
			enabled: 'Enable code-generated handoff', handoffTokens: 'Estimated handoff token budget',
			budgetContext: 'Show context usage to the model', preCompactNudge: 'Remind the model to record progress before compaction',
			keepalive: 'Enable idle cache keepalive (paid)', cacheTtlMs: 'Estimated cache lifetime (ms)',
			keepaliveAfterMs: 'Wait before keepalive (ms)', minCacheReadTokens: 'Minimum cache size for keepalive (tokens)',
			idleKeepaliveBudget: 'Max keepalives per idle period', maxConsecutiveFailures: 'Stop keepalive after consecutive failures',
			coldSwitch: 'Compact when the cache is estimated to expire', coldMinTokens: 'Minimum context for cache-expiry compaction (tokens)',
			checkEveryMs: 'Keepalive check interval (ms)',
			section_basics: 'Basics', section_keepalive: 'Cache keepalive (paid)',
			section_cold: 'Compaction after cache expiry', section_diagnostics: 'Diagnostics',
			desc_enabled: 'Generates a handoff in code instead of a model summary. DSH still controls automatic compaction thresholds. Turning this off restores official behavior and disables this plugin’s ledger, history and cache features; existing handoffs stay unchanged.',
			desc_handoffTokens: 'Target handoff length, not the threshold that triggers compaction. Long content is trimmed by priority. Token counts are estimates, not a strict cap.',
			desc_budgetContext: 'Shows the model token usage, compaction thresholds and estimated cache state. When off, progress reminders may still appear at the compaction threshold or before compaction.',
			desc_preCompactNudge: 'If automatic compaction is due and progress has not been recorded recently, defers compaction once so the model can update the ledger. At most once per window; the model may still skip bookkeeping.',
			desc_keepalive: 'Sends extra model requests while idle to try to extend cache lifetime. Output is capped at 1 token, but input and cache tokens may also be billed. Cache hits are not guaranteed. Off by default.',
			desc_cacheTtlMs: 'Estimated lifetime since the last request with confirmed cache usage, shared by keepalive and cache-expiry compaction. Keepalive stops at expiry. This is not a provider guarantee. Default: 3600000 ms (60 minutes).',
			desc_keepaliveAfterMs: 'Time since the last request with confirmed cache usage before trying keepalive. Must be shorter than the estimated cache lifetime for keepalive to run. Default: 3120000 ms (52 minutes).',
			desc_minCacheReadTokens: 'Skips keepalive when observed cache tokens are below this value.',
			desc_idleKeepaliveBudget: 'Limits keepalive requests between two normal model requests to cap idle spending. Set to 0 to send none.',
			desc_maxConsecutiveFailures: 'Stops keepalive after this many consecutive failures. A newly observed normal request resets the count.',
			desc_coldSwitch: 'Compacts before the next step only if cache usage was confirmed, its estimated lifetime has passed, context meets the minimum and the ledger check passes. Handoff generation makes no model request; subsequent requests process the new context. Off by default.',
			desc_coldMinTokens: 'Applies only to cache-expiry compaction, not DSH’s normal automatic compaction threshold.',
			desc_checkEveryMs: 'Background check interval while keepalive is enabled. Cache-expiry compaction is checked before the next model step, not on this timer. Default: 15000 ms (15 seconds).',
			cacheHint: 'Keepalive and cache-expiry compaction are off by default. Click Save to apply edits. Discard unsaved edits restores saved values, not factory defaults.',
			save: 'Save', reset: 'Discard unsaved edits', saved: 'Saved. The Host accepted the configuration.', saving: 'Saving…',
			failed: 'Configuration not saved: the Host did not accept it. Check the error or configuration state and retry.',
			invalid: 'The estimated handoff token budget must be an integer between 1000 and 64000.',
			invalidNumber: 'Numbers must be integers within the input’s allowed range.',
			loading: 'Loading configuration…', unavailable: 'Configuration unavailable. Check that the plugin and configuration service are enabled.', readonly: 'Configuration is read-only; saving is disabled.'
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
					{ id: 'basics', title: t('section_basics'), fields: ['enabled', 'handoffTokens', 'preCompactNudge'] },
					{ id: 'keepalive', title: t('section_keepalive'), fields: ['keepalive', 'cacheTtlMs', 'keepaliveAfterMs', 'minCacheReadTokens', 'idleKeepaliveBudget', 'maxConsecutiveFailures', 'checkEveryMs'] },
					{ id: 'cold', title: t('section_cold'), fields: ['coldSwitch', 'coldMinTokens'] },
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
