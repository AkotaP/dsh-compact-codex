# 实现说明

本文说明 1.2 起的宿主接入方式。安装与默认配置见 [README](<../README.md>)，交接与缓存行为见[工作原理](<how-it-works.md>)。

## 入口与职责

| 文件 | 职责 |
| --- | --- |
| [plugin.js](<../lib/plugin.js>) | 宿主入口、可动态更新的 volatile 配置与 agent 生命周期 |
| [integration.js](<../lib/integration.js>) | 判定官方实例、包装与恢复方法、释放 agent 作用域 |
| [index.js](<../lib/index.js>) | 生成交接、注册四个工具、提供预算和缓存功能；保留显式引擎导出 |
| [client.js](<../lib/client.js>) | 交接卡片与插件详情配置表单 |
| [cordis.patch.yml](<../cordis.patch.yml>) | 只插入宿主 `compact-codex` 行 |
| [profile.mjs](<../scripts/profile.mjs>) | profile 安装、卸载、路径选择与备份 |

默认包入口是宿主插件，不是压缩引擎类。兼容类 `CodexCompactionEngine` 仍由 `dsh-compact-codex/engine` 导出，旧 `dsh-compact-codex/preset` 入口也保留；显式选择这些入口不等于使用默认接入流程。

## 服务查询与实例边界

宿主优先通过 `agentPresets.serviceFor(agent, "compaction")` 查询 agent 实际使用的服务，必要时回退到 `agent.ctx.get("compaction")`。不直接读取 preset 定义，也不在顶层再挂载一个后端。

`serviceFor()` 可能每次返回不同的 Cordis 代理。插件通过公开的 `Symbol.for("cordis.original")` 取得原始服务实例，以该实例作为记录 Map 的键，并用于比较与接入判定。这样多个 agent 共享服务时不会因代理身份变化而重复包装。

接入条件：

- `Object.getPrototypeOf(engine) === BasicCompactionEngine.prototype`。
- 实例没有自有 `summarize` 属性，且继承的 `summarize` 可调用。
- agent 有可用的上下文与 scope，插件仍启用。

符合条件后包装 `summarize()`；只有在实例没有自有 `compactIfNeeded` 属性、且继承方法可调用时，才包装它提供压前提醒。不用宽泛的 `instanceof` 接管子类，不改官方 prototype，不替换 `ctx.compaction`，也不覆写 preset。

官方 Basic 仍决定自动触发、阈值、保留策略、事务与 `/compact` 流程。默认宿主接入会在符合条件的压力路径中推迟一次步边界（余量不足时不推迟），不能描述成“压力流程完全不变”；旧文档中的“整份搬运 preset”也不适用于此架构。

## 方法恢复与作用域

每个后端实例记录原方法与本插件包装函数，每个 agent 记录配置、后端和独立作用域。`summarize()` 按 owner 查询 agent；未登记或已停用时调用原方法，已登记时生成交接。多个 agent 共用实例时分别记录成员，最后一个成员退出才恢复方法。

辅助功能通过 `createScope(hostCtx, scopeOf(agent.ctx))` 建立作用域，再由 `attachCodexFeatures()` 注册。作用域受宿主插件生命周期管理，同时处于该 agent 的隔离范围。工具和监听器不能只注册在宿主根上下文，否则可能对错误的 agent 生效或在卸载后残留。

agent 释放、后端变化、配置禁用或插件卸载时，移除对应成员并 `dispose()` 其 scope，释放工具、监听器、计时器并取消在飞保活请求。只恢复仍指向本插件包装的属性，避免覆盖其他插件后续的改动。完整卸载先停止接入并恢复方法，再等待已排队工作结束；它不回滚已提交的压缩或已发送请求的费用。

配置与生命周期操作串行排队；每次步边界重新检查服务实例，不能假设 `agent/created` 后后端不再变化。

## 配置契约

宿主 `Config` 只声明一个 volatile `options` 对象，默认值如下：

```json
{
  "enabled": true,
  "handoffTokens": 20000,
  "budgetContext": false,
  "preCompactNudge": true,
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

所有数值必须为安全整数。`handoffTokens` 范围为 1000–64000，是估算交接长度，不是压缩触发阈值，也不是严格输出上限。`cacheTtlMs`、`keepaliveAfterMs`、`checkEveryMs` 下限为 1000，`maxConsecutiveFailures` 下限为 1，其余缓存数值下限为 0。

`keepalive` 与 `coldSwitch` 默认关闭，共用 `cacheTtlMs` 的有效期假设。`checkEveryMs` 只控制保活后台检查，不控制步边界的冷缓存换窗。`keepaliveAfterMs >= cacheTtlMs` 或 `idleKeepaliveBudget: 0` 时不发送保活。保活设 `maxTokens: 1` 限制输出，但输入和缓存仍可能计费，不保证实际命中。

详情页以包名 `dsh-compact-codex` 注册 `plugins.bundle.config`，以行 id `compact-codex` 取得表单，通过 `form.set("options", {...})` 保存整个对象，并保留当前配置中界面不认识的字段。只读、等待、表单缺失和保存异常需显示状态；缺少 `configForms` 不应阻止交接渲染。“撤销未保存修改”恢复已保存值，不是恢复默认值。

宿主从 `apply(ctx, config)` 第二参数读取配置；volatile 字段通过引用取得当前值。更新后释放并重新接入现有 agent。`enabled: false` 恢复原行为，不会取消已提交的压缩事务，也不将被压缩原文重新放回当前模型上下文。

官方 Basic 的阈值和保留参数仍在官方服务上配置。1.1 及更早版本使用的 `preset-config.json` 已移除，不自动迁移；旧引擎字段仅适用于显式配置兼容引擎。1.2 起不提供 preset 同步脚本。

## 依赖解析与安装边界

[包清单](<../package.json>) 声明宿主运行时 peer 依赖。生产加载使用 DSH `0.2.2-rc.1` 起的 peer 解析机制，包括 asar 内依赖；不创建运行时联接，也不下载另一份官方引擎来满足类身份判断。DSH 升级后需复核依赖解析、实际服务查询和 scope API。

安装或卸载脚本要求先完全退出使用目标 profile 的 DSH，并停止其他 profile 编辑或插件管理操作；脚本结束后再启动。dry run 的 `requiresExclusiveProfileAccess: true` 是操作前提，不表示已取得独占访问。

安装先备份并写入依赖声明，执行 pnpm，成功后启用 bundle。安装器以 `wx` 创建自有锁，只防止本安装器并行运行，不阻止 DSH 或编辑器写入。写回前比较原文，但比较与重命名之间仍有竞态，不是原子比较并写入，不能保证拒绝所有并发覆盖。profile 清单或 lockfile 为符号链接或非普通文件时拒绝写入。pnpm 失败时尝试恢复原清单，不保证撤销依赖目录与 lockfile 的全部改动。

`--skip-pnpm` 跳过依赖同步。新安装只写依赖声明、不启用 bundle；已启用的 bundle 不因此禁用。正常卸载先禁用 bundle、移除依赖，再同步依赖，清理失败不重新启用；跳过 pnpm 则仍待清理依赖。路径优先级为：显式 `--profile-dir`；没有显式 `--home` 或 `--profile` 时使用 `DSH_PROFILE_DIR`；其余情况组合 home 与 profile 参数或环境变量。

独占要求只针对脚本写 profile，不限制正常运行、配置更新或宿主内禁用与卸载。`link:` 不是即时生效保证；源码改动需由宿主加载，客户端是否自动更新也需验证。

脚本不编辑 profile patch 的自定义配置，不删除历史日志、账本、诊断文件或备份。GUI 保存的配置可能留下针对 `compact-codex` 的无效 patch 行；旧版手工 preset 覆盖和运行时联接也不自动清理。卸载既不保证零残留，也不撤销已提交的压缩历史。

## turn 内换窗与压力路径

`new_context` 只登记请求，不在工具 handler 内调用 `compactNow()` 抢占当前 turn。后续 `agent/pre-step` 先调用 `next()`；步骤被拒时保留请求，取消时停止处理。

处理前比较登记时的最后压缩编号，避免下游已压缩后再次压缩；同时复查账本条件与 signal。区间跳过系统头，结尾取当前模型可见历史末项，再调用 `compactRegion(..., agent, signal)`。区间选择不能绕过官方工具配对与事务校验。

`preCompactNudge` 通过默认实例的 `compactIfNeeded()` 包装实现，不是仅存在于兼容引擎的行为。只对 `pressure` 判定，且需取得有效模型容量、用量和阈值；账本为空或检查未通过、且推迟一步后仍有余量时，每窗口最多推迟一次，并在下游允许的步骤中注入记账提醒；余量不足时不推迟，压缩照常执行且产物仍是交接信息，不退回原生摘要。之后不再因该提醒推迟，溢出路径不推迟，也不保证模型按提醒记账。`budgetContext` 只控制数字诊断，不能代替这项开关。

主动换窗的账本检查不会持续阻止官方压力压缩。冷缓存换窗也检查账本，且仅在下游未压缩、步骤允许执行、缓存观测可用、估计过期及上下文达标时触发。

## 验证与诊断

`npm test` 通过[测试注册器](<../test/support/register-runtime.mjs>)将运行时导入映射到离线 stub。stub 验证协议和分支，不证明真实 DSH 对象、profile 重组、浏览器槽位或 provider 计费行为正确。测试不应依赖安装脚本创建运行时联接。

账本锚点校验按会话当前工作目录（优先宿主的工作目录服务，取不到时用会话头里的创建目录）解析 `anchors.path` 的相对路径，绝对路径原样使用；只有会话头没有工作目录时才以宿主进程工作目录为基准。`match` 需在文件中唯一出现。成功工具结果编号只是账本完成状态的校验条件，不自动证明任务整体完成。

发布前需分别记录离线测试、真实宿主隔离 smoke、获准后的实际 profile 安装、浏览器配置保存和交接渲染验收。文档修改或已有截图不表示当前 GUI 已验证；未执行的检查不能标为通过。

排查压缩失败需查看 `compaction/end` 的错误信息，不能只依据 `/compact` 的通用摘要失败文案。没有工具注册失败日志也不能证明功能可用，应检查实际注册和调用结果。交接有预算与裁剪，账本依赖记录质量和存储；插件自身不删除日志，但历史回查仍依赖宿主保留原事件且能读取，不能保证信息无损或永久可查。
