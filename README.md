# dsh-compact-codex

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[English](<README.en.md>) | 中文

> **Fork 说明**：本仓库 fork 自 [niszhum/dsh-compact-codex](https://github.com/niszhum/dsh-compact-codex)，由 [AkotaP](https://github.com/AkotaP) 维护。从 1.2 起，不再替换压缩服务或覆写 preset，而是在符合条件的官方实例上接入交接生成。上游历史见[上游仓库](https://github.com/niszhum/dsh-compact-codex/commits/main)，本仓库变更见 [CHANGELOG](<CHANGELOG.md>)。

DSH（DeepSeek Harness）插件：在压缩时用程序生成的上下文交接替代模型摘要。交接生成不调用模型，也不删除会话日志；原事件仍可读取时，可按事件编号回查。

## 解决的问题

模型摘要需要额外的模型请求，会增加等待时间和 token 消耗，也可能遗漏命令、报错和路径等细节。

本插件改为读取已有会话事件与任务账本，整理当前请求、进度和历史线索，省去生成摘要的模型请求。交接仍有预算与截断，账本也依赖记录质量和存储可用性，不能保证信息无损；日志保留不等于原文始终在模型当前上下文中。

## 行为

1. **适用范围**：查询每个 agent 实际使用的 `compaction` 服务。只接入 prototype 精确等于官方 `BasicCompactionEngine.prototype`、且没有自有 `summarize` 属性的实例；自定义后端、子类和已有实例级摘要改动保留原行为。
2. **压缩时**：在实例上包装 `summarize()` 来生成交接；若实例没有自有 `compactIfNeeded()`，也包装它来提供压前记账提醒。不改官方 prototype、不重建引擎、不覆写 preset。已登记 agent 使用交接，其他 owner 调用原方法。
3. **显示**：浏览器只将来源为 `compact-checkpoint`、且含插件交接标题的消息显示为交接卡片，不隐藏其他压缩行。
4. **禁用或卸载**：释放该 agent 的工具、监听器和保活资源；最后一个使用者退出时恢复本插件包装的方法。若方法已被其他插件再次修改，不覆盖其改动。已生成的压缩历史不回滚。

## 功能与边界

- **上下文交接**：整理最新请求、上次助手回复、任务账本、最近动作和文件工作集，并附事件编号供回查。
- **任务账本**：保存进度、下一步、验收条件与证据；交接前尝试为未记账动作保存自动快照，快照不等于任务完成证明。
- **历史检索**：检索宿主会话事件，或按编号分页读取，包括仍在可读日志中的被压缩事件。
- **缓存观测**：依据 provider 用量与本地 TTL 假设估计冷热，不保证实际命中或精确费用。付费保活与冷缓存换窗默认关闭，需在插件详情页显式开启。
- **压前提醒**：默认开启。压力压缩达到阈值、账本为空或不够新、模型容量和用量可读且推迟一步后仍有余量时，最多推迟一次步边界并提醒记账；随后不再因该提醒推迟，不保证模型完成记账。`overflow` 触发不推迟，官方阈值不变。

自动触发、压缩区间、近期历史保留、事务与 `/compact` 仍由官方 Basic 后端负责；插件仅增加上述一次推迟，不保证每次压缩替换全部历史。交接生成不调用模型，但正常推理和可选保活仍可能产生模型请求与费用。

![交接卡片预览；不是当前宿主验收记录](<preview-handoff.png>)

## 环境要求

- Node.js ≥ 22.15.0。
- DSH `>=0.2.2-rc.1 <0.3.0`：依赖宿主的 peer 依赖解析与 agent 作用域接口。
- pnpm，用于同步目标 profile 的依赖；从仓库下载另需 git。

运行时依赖由 DSH 宿主解析，包括 Desktop 的 asar 内包。安装脚本不创建运行时联接，也不复制官方运行时包。普通 Node 直接导入插件不能替代宿主加载验证；离线测试使用独立 stub。

## 安装

> 安装会修改 DSH home（Windows 默认 `%USERPROFILE%\.dsh`）下的 profile 配置，影响共享该 profile 的会话，执行前需确认。用脚本或 CLI 写 profile 前，**必须完全退出使用该 profile 的 DSH**，并停止其他 profile 编辑或插件管理操作；插件页内安装不需要退出。不要自动重启 DSH 或打断会话；运行中的宿主明确要求重启时，再询问是否重启。

仓库：<https://github.com/AkotaP/dsh-compact-codex>

**从插件页安装**：侧边栏「插件」→「添加插件」，填入 `https://github.com/AkotaP/dsh-compact-codex`。DSH 用 `git ls-remote` 探测仓库后交给 pnpm 安装；完成后确认插件已启用，并核对宿主是否报告需重启。

**命令行安装**（desktop profile 由 Electron 独占管理，执行前先完全退出 DSH）：

```powershell
dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex
```

执行后确认 profile 依赖已安装，且 `dsh.profile.bundles` 包含 `dsh-compact-codex`，再启动 DSH 检查插件状态。包内 [cordis.patch.yml](<cordis.patch.yml>) 只插入 `compact-codex` 一行，不要在 profile patch 中重复添加。

**交给 agent 安装的指令**：

> 将 `https://github.com/AkotaP/dsh-compact-codex` 安装到当前 DSH 的 desktop profile。优先使用侧边栏「插件」→「添加插件」；若使用 CLI，需先安排完全退出 DSH，再执行 `dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex`。安装后检查 profile 的 `dsh.profile.bundles` 包含 `dsh-compact-codex`，并确认插件页显示启用。不要自动重启；运行中的宿主明确要求重启时再询问。

**本地开发**（link 方式，运行脚本前先退出 DSH）：

```powershell
# 在仓库根目录
node ./scripts/profile.mjs install --dry-run
node ./scripts/profile.mjs install
```

[profile 脚本](<scripts/profile.mjs>) 按顺序执行：

1. 读取已存在的 profile，备份清单及已存在的 lockfile。
2. 将本地仓库以 `link:` 写入 profile 的 `dependencies`。
3. 在 profile 中运行 `pnpm install --ignore-scripts --no-frozen-lockfile`。
4. 依赖安装成功后，将包加入 `dsh.profile.bundles`。

`link:` 只让依赖指向本地仓库，不保证源码保存后立即生效。宿主代码需由 DSH 重组或重启后加载；客户端更新依赖宿主的客户端热更新能力，必要时刷新页面。每次改动后都应验证实际加载结果。

脚本锁只防止本安装器并行执行，不阻止 DSH 或编辑器写入。写回前会检查内容是否变化，但检查与重命名之间仍有竞态，不能保证拒绝所有并发覆盖。profile 清单或 lockfile 为符号链接或非普通文件时拒绝写入。dry run 的 `requiresExclusiveProfileAccess: true` 只说明需要独占访问，不表示已取得独占。依赖安装失败时尝试恢复原清单，但不保证撤销 pnpm 对 lockfile 和依赖目录的全部改动。

### 路径与参数

`--profile-dir` 优先。没有显式 `--home` 或 `--profile` 时，优先使用 `DSH_PROFILE_DIR`；否则用 `--home` / `DSH_HOME` 与 `--profile` / `DSH_PROFILE` 组合路径，缺省为 `~/.dsh` 和 `desktop`。

| 参数 | 用途 |
| --- | --- |
| `--profile-dir <path>` | 指定已存在的 profile 目录 |
| `--home <path>` | 指定 DSH home |
| `--profile <name>` | 指定 profile 名 |
| `--repo <path>` | 指定本地仓库 |
| `--dry-run` | 只显示计划，不写文件、不执行 pnpm |
| `--skip-pnpm` | 跳过依赖同步；新安装只准备依赖声明，不启用 bundle；卸载后依赖清理仍待完成 |

`--skip-pnpm` 不代表安装完成，也不会禁用已经启用的 bundle。依赖问题解决后，应重新执行正常安装或卸载。

## 配置

位置：**设置 → 插件 → 本插件详情页**。表单分为「基础 / 缓存保活（付费） / 缓存过期后换窗 / 诊断」四组。点击「保存」才写入 `compact-codex` 行的整个 `options` 对象；「撤销未保存修改」恢复已保存值，不恢复默认值。只读、服务不可用或保存失败时会显示提示，不能仅凭编辑过字段判断已生效。

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 启用交接替换和该 agent 的辅助工具；关闭后恢复原行为，不回滚历史 |
| `handoffTokens` | `20000` | 交接信息的估算 token 预算，整数范围 1000–64000；不是换窗触发阈值或严格输出上限 |
| `budgetContext` | `false` | 向模型追加预算与缓存诊断读数；关闭不影响自动压缩或流程提醒 |
| `preCompactNudge` | `true` | 满足条件时，压力压缩前推迟一次步边界并提醒记账，每窗口一次 |
| `keepalive` | `false` | 空闲缓存保活；开启后可能发真实模型请求并产生费用 |
| `cacheTtlMs` | `3600000` | 保活与冷缓存换窗共用的有效期估计（毫秒），不代表 provider 保证 |
| `keepaliveAfterMs` | `3120000` | 距上次观测到缓存活动多久后尝试保活（毫秒），仍需满足其他条件 |
| `minCacheReadTokens` | `40000` | 保活所需的已观测缓存前缀规模下限（token） |
| `idleKeepaliveBudget` | `3` | 两次正常请求之间最多尝试保活几次 |
| `maxConsecutiveFailures` | `2` | 连续保活失败达到此次数后停止尝试 |
| `coldSwitch` | `false` | 缓存被判定过期、上下文足够大且账本检查通过时，在允许执行的步边界换窗 |
| `coldMinTokens` | `100000` | 冷缓存换窗的上下文规模下限（token） |
| `checkEveryMs` | `15000` | 开启保活后的后台检查周期（毫秒）；冷缓存换窗在步边界检查 |

所有数值必须为安全整数。`cacheTtlMs`、`keepaliveAfterMs`、`checkEveryMs` 最小为 1000，`maxConsecutiveFailures` 最小为 1，其余缓存数值最小为 0。

`keepaliveAfterMs >= cacheTtlMs` 或 `idleKeepaliveBudget: 0` 时不发送保活。保活请求设置 `maxTokens: 1` 限制输出，不表示总计费只有 1 token。

**付费保活与冷缓存换窗默认关闭**。保活不保证命中，也不能保证已发送请求取消后不计费；冷缓存换窗会缩减模型可见历史，不保证无损或节省成本。官方 Basic 的阈值、保留比例和路由策略不在本表单中配置。

1.1 及更早版本使用的 `preset-config.json` 已移除，详情页不读取或迁移它；旧引擎字段不能直接用作宿主 `options`。保留的显式引擎入口仅供兼容调用，不是推荐安装方式。1.2 起不再提供 preset 同步脚本。

## 工具

仅在已接入的 agent 作用域中注册：

| 工具 | 用途 |
| --- | --- |
| `new_context` | 登记换窗请求，在后续允许执行的步边界复核后调用官方 `compactRegion()` |
| `ledger_append` | 追加任务进度、下一步、验收条件和证据 |
| `ledger_read` | 读取概览、当前窗口记录或搜索账本 |
| `history` | 搜索会话事件，或按编号分页读取正文和调用参数 |

账本非空时，主动换窗要求在当前窗口最近请求后记过账，且未记账工具结果不超出门槛；没有新请求时仍检查未记账尾部。工具返回“已登记”不等于压缩完成，应核对后续压缩事件。账本 `anchors.path` 的相对路径按会话当前工作目录解析，绝对路径原样使用；账本读取失败时会拒绝换窗，而不是当成空账本。

## 验证

```powershell
npm test
```

离线测试通过[测试注册器](<test/support/register-runtime.mjs>)加载 stub，不启动真实 profile，也不验证当前 GUI、真实缓存命中或付费请求。真实宿主 smoke、实际安装和浏览器验收需单独执行并记录。

安装后应检查：插件页显示启用、profile 的 `dsh.profile.bundles` 包含 `dsh-compact-codex`；符合接入条件的 agent 在后续压缩时生成带交接标题的消息。自定义后端不以此作为验收条件。

## 卸载与升级

**插件页内卸载**：侧边栏「插件」→ 本插件 → 卸载，随后确认 `dsh.profile.bundles` 中已移除。

**脚本卸载**（对应本地 link 安装，需先退出 DSH）：

```powershell
node ./scripts/profile.mjs uninstall --dry-run
node ./scripts/profile.mjs uninstall
```

脚本先移除 bundle 与依赖声明，再同步依赖。同步失败不会重新启用 bundle，但可能仍需修复依赖目录或 lockfile。插件在宿主内禁用或卸载时会清理资源，不需要为该清理操作退出 DSH。

卸载会保留历史日志、任务账本、诊断文件、仓库与备份，也不会将已压缩的原文重新放回模型上下文。GUI 保存过的配置可能在 profile patch 中留下无效行；脚本不删除此类配置或其他手工改动，需核对后再决定是否移除。

从上游 1.1.x 升级到本 fork 的 1.2.x 时，需检查旧 preset 覆盖和手工运行时联接，备份后分别处理。新脚本不会扫描删除这些内容，也不会用旧备份整体覆盖现有 profile。DSH 升级后无需重新同步 preset，但需复核宿主接口兼容性。

## 与上游的差异

| | 上游 1.1.2 | 本 fork 1.2.x |
| --- | --- | --- |
| 接入点 | 替换 `ctx.compaction` 服务、覆写 preset | 包装官方实例的 `summarize()`，可用时也包装 `compactIfNeeded()` 提供压前提醒 |
| 自定义后端 | 一并接管 | 不接管，保留原行为 |
| 配置 | `preset-config.json` + preset patch | 插件详情页的 `options`，通过 volatile 配置更新 |
| 安装 | 脚本写 preset | 插件页 / git / 本地 link |

## 文档

- [工作原理](<docs/how-it-works.md>)：交接、账本、历史与缓存。
- [实现说明](<docs/internals.md>)：实例接入、作用域、配置与安装边界。
- [变更记录](<CHANGELOG.md>)：各版本变更。

## 许可证

[MIT](<LICENSE>)
