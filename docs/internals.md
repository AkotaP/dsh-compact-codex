# 实现说明

本文对应 1.2 的宿主适配流程。安装命令与默认配置见 [README](<../README.md>)，运行机制见 [工作原理](<how-it-works.md>)。

## 入口与职责

| 文件 | 职责 |
| --- | --- |
| [plugin.js](<../lib/plugin.js>) | 宿主入口、volatile 配置与 agent 生命周期协调 |
| [integration.js](<../lib/integration.js>) | 官方实例判定、可逆方法装饰与 agent scope 释放 |
| [index.js](<../lib/index.js>) | 交接生成、四个工具、预算与缓存辅助功能；保留显式引擎导出 |
| [client.js](<../lib/client.js>) | 交接卡片与插件详情配置表单 |
| [cordis.patch.yml](<../cordis.patch.yml>) | 仅插入宿主 `compact-codex` 行 |
| [profile.mjs](<../scripts/profile.mjs>) | profile 安装、卸载、路径选择与备份 |

默认包入口是宿主插件，不是压缩引擎类。兼容类 `CodexCompactionEngine` 仍由 `dsh-compact-codex/engine` 导出，旧 `dsh-compact-codex/preset` 入口也保留；显式选择这些入口不等于使用默认最小侵入流程。

## 实际后端与实例边界

宿主优先通过 `agentPresets.serviceFor(agent, "compaction")` 查询 agent 已保留的实际服务，必要时回退 `agent.ctx.get("compaction")`。这与直接读取某个 preset 定义不同，也避免在顶层重复挂载另一个后端。

`serviceFor()` 每次查询可能返回新的 Cordis use-site traceProxy，不能直接将返回对象用作稳定身份。接入先通过公开的 `Symbol.for("cordis.original")` 解包，取得稳定的原始服务实例；后端记录 Map 以该 canonical raw 实例为键，实例比较与准入检查也使用此身份，避免共享服务的多个 agent 被重复装饰或每步重新识别失败。

实例准入条件包括：

- `Object.getPrototypeOf(engine) === BasicCompactionEngine.prototype`。
- 未存在实例自身的 `summarize` 属性描述符，继承的方法可调用。
- agent 有可用上下文与 scope，且插件仍启用。

不使用宽泛 `instanceof` 接管自定义子类，不写官方 prototype，不替换 `ctx.compaction` 服务，也不重写任何 preset 声明。官方 Basic 的自动触发、阈值、保留策略、事务和 `/compact` 均保持。旧文档所述“必须整份搬运 preset”不适用于此架构。

## 可逆装饰与作用域

每个后端实例保存原 `summarize` 与本插件包装函数，每个 agent 保存配置、实例记录和独立作用域。包装按 owner 查找成员，未登记或停用时调用原方法；已登记时调用代码交接生成器。多个 agent 共用一个实例时分别追踪成员，不提前移除仍有成员使用的包装。

辅助功能使用：

```js
const scope = createScope(hostCtx, scopeOf(agent.ctx))
attachCodexFeatures(scope.ctx, engine, engine.config, options)
```

作用域既受宿主插件生命周期管理，又落在 agent 的隔离范围中。工具与监听器不能仅在宿主根上下文注册，否则可能对错误的 agent 生效或在卸载后残留。

agent 释放、后端变化、配置禁用或插件卸载时，应移除成员并 `dispose()` 对应 scope。最后一个成员退出才恢复该实例的方法；仅当当前属性仍是本插件包装时恢复，避免覆盖后来由其他插件安装的方法。完整卸载先停止适配并恢复包装，再等待已排队工作结束。scope 清理需要释放监听器、工具注册和计时器，并取消在飞保活请求。

配置或生命周期处理通过队列串行协调，不能仅凭一次 `agent/created` 事件认定后续后端永远不变。步边界会重新核对服务实例。

## 配置契约

宿主 `Config` 仅声明一个 volatile `options` 对象：

```json
{
  "enabled": true,
  "handoffTokens": 20000,
  "budgetContext": false,
  "keepalive": false,
  "cacheTtlMs": 3600000,
  "keepaliveAfterMs": 3120000,
  "minCacheReadTokens": 40000,
  "idleKeepaliveBudget": 3,
  "maxConsecutiveFailures": 2,
  "coldSwitch": false,
  "coldMinTokens": 100000,
  "checkEveryMs": 15000
}
```

`handoffTokens` 是 1000–64000 的安全整数；其余数值字段按各自下限校验。`keepalive` 与 `coldSwitch` 默认关闭。详情页通过包名 `dsh-compact-codex` 注册 `plugins.bundle.config`，通过行 id `compact-codex` 取得配置表单，使用 `form.set("options", {...})` 保存整个对象。只读、pending、表单缺失和保存异常均需处理；缺少 `configForms` 不得阻止交接渲染。

宿主从 `apply(ctx, config)` 第二参数读取配置，volatile 值按引用读取。收到更新后重新释放并适配现有 agent；`enabled: false` 恢复默认行为，但不会取消已经提交的压缩事务或恢复旧表面。

官方 Basic 的阈值和保留参数继续在官方服务上配置。1.1 及更早版本使用的 `preset-config.json` 已从仓库移除，不自动迁移；旧引擎字段仅适用于显式配置兼容引擎的场景。1.2 起不再提供 preset 同步脚本。

## 依赖解析与安装事务

[包清单](<../package.json>) 声明宿主运行时 peers。生产加载依赖 DSH `0.2.2-rc.1` 的 peer resolver 解析官方包，包括 asar 内依赖；不建立运行时 Junction，也不通过下载另一份官方引擎来满足类身份判断。版本升级后需复核 resolver、保留组合查询和 scope API。

运行安装或卸载脚本前，必须停止使用目标 profile 的 DSH，并确保没有其他 profile 编辑或插件管理操作；脚本结束后再启动 DSH。dry run 的 `requiresExclusiveProfileAccess: true` 是此操作前提的报告，不是已经取得独占访问的证明。

安装先备份并写入依赖，执行 pnpm，成功后才启用 bundle。安装器用 `wx` 创建自有锁，仅防止本安装器的并行操作，不与 DSH 或编辑器共享写锁。写回前的原文比较和后续 rename 之间仍有竞态，只提供 best-effort stale 检查，不是面向不配合写入者的原子 CAS，不能承诺拒绝所有并发覆盖。目标 profile 清单或 lockfile 为符号链接或非普通文件时拒绝写入。pnpm 失败时尝试恢复原清单，但不保证依赖目录与 lockfile 的影响全部回滚。

上述独占访问要求针对脚本写 profile，不限制插件正常运行、配置更新，以及宿主内禁用或卸载时的方法恢复与作用域资源释放。

`--skip-pnpm` 只准备新安装依赖声明，不激活尚未启用的 bundle。卸载则先禁用 bundle、移除依赖，再清理依赖；清理失败不会重新启用。显式 `--profile-dir` 优先，否则尊重 `DSH_PROFILE_DIR`；显式 home/profile 覆盖环境路径组合。

脚本不编辑 profile patch 中的自定义配置，不删除历史日志、账本、诊断文件或备份。GUI 保存的配置可能留下针对 `compact-codex` 的无效 patch 行；旧版本手工写入的 preset 覆盖和运行时联接也不会自动清理。卸载不是零残留承诺，更不是已压缩历史的反向恢复。

## turn 内换窗

`new_context` 工具只登记请求，不能在工具 handler 内调用 `compactNow()` 抢占正在运行的 turn。后续 `agent/pre-step` 必须先 `next()`，步骤被拒时保留请求，取消时停止消费。

消费前比较登记时的最后压缩编号，避免下游自动压缩后再压一次；同时复查账本门槛和 signal。区间跳过系统头，结尾取当前 surface 末项，再调用 `compactRegion(..., agent, signal)`。边界选择不是绕过官方工具配对和事务校验的理由。

官方压力路径不被适配器的账本条件拦截。显式兼容引擎的 `compactIfNeeded()` 覆写不得被误写为默认宿主行为。

## 验证与诊断

运行 `npm test` 使用 [测试注册器](<../test/support/register-runtime.mjs>) 显式把运行时导入映射到离线 stub。stub 验证协议和分支行为，不证明真实 DSH 对象、profile 重组、浏览器槽位或 provider 计费行为正确。测试不得依赖安装脚本生成运行时联接。

发布前应分别记录：离线测试结果、真实宿主隔离 smoke、获准后的实际 profile 安装、浏览器配置保存和交接渲染验收。本次文档更新不代表已在当前 GUI 生效；未实际执行的检查不得标为通过，也不列未经确认的测试数量。

排查压缩失败应查看 `compaction/end` 的错误信息，不能只依据 `/compact` 的兜底摘要失败文案。工具注册失败日志缺席也不能单独证明功能可用，应检查实际注册与调用结果。交接、自动快照和账本均不构成信息无损保证；历史回查还依赖宿主日志保留与可读性。
