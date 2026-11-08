# Changelog

本文件记录 [AkotaP/dsh-compact-codex](https://github.com/AkotaP/dsh-compact-codex)（fork 自 [niszhum/dsh-compact-codex](https://github.com/niszhum/dsh-compact-codex)）的变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。0.x / 1.x 阶段的接口仍可能调整，以 README 描述的行为为准。

## [1.2.0] - 2026-11-08

最小侵入重写：从“替换压缩服务 + 覆写 preset”改为“只装饰官方实例的 `summarize()`”。

### Added

- 宿主入口 `lib/plugin.js` 与实例适配器 `lib/integration.js`：按 agent 追踪实际使用的 `compaction` 服务，逐实例装饰并可逆恢复。
- 插件详情页配置表单，保存 `options`：`enabled`、`handoffTokens`、`keepalive`、`coldSwitch`、`budgetContext`。
- 交接卡片客户端显示：仅对来源为 `compact-checkpoint` 且含插件交接标题的消息渲染，不隐藏官方压缩行。
- `scripts/profile.mjs` 安装器：备份 profile、写入依赖、同步依赖成功后再启用 bundle；支持 dry run 与 uninstall。
- 插件详情页开放缓存参数：`cacheTtlMs`、`keepaliveAfterMs`、`minCacheReadTokens`、`idleKeepaliveBudget`、`maxConsecutiveFailures`、`coldMinTokens`、`checkEveryMs`。

### Changed

- 只对 prototype 精确等于官方 `BasicCompactionEngine.prototype`、且未设置实例级 `summarize` 的实例生效；自定义后端、子类与已被其他插件装饰的实现保持原行为。
- 不替换 `ctx.compaction`，不重写任何 preset 声明，不写官方 prototype。自动触发、阈值、保留策略、事务与 `/compact` 仍由官方 Basic 后端负责。
- 工具与监听器注册到 agent 独立作用域，随 agent 释放、配置禁用或插件卸载一起清理。
- 配置来源从 `preset-config.json` 迁到宿主 volatile `options`；旧配置不自动迁移。
- `keepalive` 与 `coldSwitch` 默认都关闭：保活会发真实请求并计费，冷换窗会改变压缩时机，均需显式开启。
- `docs/how-it-works.md`、`docs/internals.md` 与 README 按新架构重写。

### Removed

- 移除对 `ctx.compaction` 的全局替换与 preset 快照生成。
- 移除 `sync-presets.mjs` 与 `install.ps1`：本地 link 安装统一走 `scripts/profile.mjs`，不再保留 preset 自检脚本与 PowerShell 包装入口。

### Fixed

- 可逆性：最后一个成员退出才恢复实例方法，且仅当当前属性仍是本插件包装时恢复，避免覆盖后来由其他插件安装的方法。
- 生命周期：配置更新、agent 创建/释放与步骤边界统一排队串行处理，后端实例变化时重新识别与适配。

## [1.1.2] - 2026-11-07

### Changed

- 任务账本改为原子落盘：先写临时文件再 rename，避免写到一半留下半份账本。
- 交接信息中的动作段改为按时间倒序展示。

## [1.1.1] - 2026-11-06

### Fixed

- 交接信息三处失真：账本续行缩进、快照摘要口径、PTC 写路径误判。

## [1.1.0] - 2026-11-06

### Added

- 交接信息补全用户请求轨迹与任务起点：起点保留首个请求原文，轨迹按编号回查。
- 账本新增 `done_when` 验收条件与 `anchors` 定位信息。
- 请求全量索引、PTC 写路径回退与 token 偏差校准。

## [1.0.0] - 2026-10-12

### Added

- 初版：Codex 风格压缩引擎、任务账本（`ledger_append` / `ledger_read`）、历史检索（`history`）、主动换窗（`new_context`）。
- preset patch 生成与配置、交接卡片预览、使用说明与实现文档。
