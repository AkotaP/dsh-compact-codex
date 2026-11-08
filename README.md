# dsh-compact-codex

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.en.md) | 中文

> **Fork 说明**：本仓库 fork 自 [niszhum/dsh-compact-codex](https://github.com/niszhum/dsh-compact-codex)，由 [AkotaP](https://github.com/AkotaP) 维护。从 1.2 起接入方式改为最小侵入，与上游 1.1.2 的“替换压缩服务”路线不同；上游历史见[上游仓库](https://github.com/niszhum/dsh-compact-codex/commits/main)，本仓库变更见 [CHANGELOG](<CHANGELOG.md>)。

DSH（DeepSeek Harness）插件：在压缩点用程序生成的上下文交接替代模型摘要。生成不调用模型，因此瞬间完成；会话日志不被删除，旧内容仍可按事件编号回查。

## 解决的问题

DSH 默认压缩要让模型先读完整段历史、再写一份摘要：

- **慢**：一次压缩等于一次完整模型请求，长会话通常要等几十秒。
- **贵**：压缩本身也消耗 token 与额度。
- **有损**：摘要不可逆，命令原文、报错细节、具体路径很容易被抹掉。

本插件在压缩点直接读取已有会话事件与任务账本，拼出一份结构化交接信息。它不请求模型，不动官方压缩策略，也不删除任何历史。

## 行为

1. **定位**：宿主入口按 agent 查询其实际使用的 `compaction` 服务，而不是按 preset 名称替换配置。
2. **判定**：只接受 prototype 精确等于官方 `BasicCompactionEngine.prototype`、且未被其他逻辑设置实例级 `summarize` 的实例；自定义后端、子类与已被装饰的实现保留原行为。
3. **装饰**：在该实例上安装可恢复的 `summarize()` 包装，不改官方 prototype，不重建引擎。
4. **分流**：包装按 owner agent 区分——已登记 agent 使用代码交接，其他 owner 回退原方法。
5. **显示**：浏览器端只对来源为 `compact-checkpoint` 且含插件交接标题的消息渲染交接卡片，不隐藏官方压缩行。
6. **恢复**：禁用或卸载时还原本插件安装的方法，并释放 agent 作用域中的工具、监听器与保活资源；已生成的压缩历史不回滚。

## 功能与边界

- **上下文交接**：整理最新请求、上次助手回复、任务账本、最近动作和文件工作集；条目上的事件编号可用于回查原文。
- **任务账本**：保存进度、下一步、验收条件与证据；交接前尝试记录未记账动作的自动快照。
- **历史检索**：从宿主会话事件检索或按编号分页读取，包括仍在日志中的被压缩事件。
- **缓存观测**：依据 provider 用量与本地 TTL 假设估计冷热；冷缓存换窗与付费保活默认都关闭，需要时在插件详情页显式开启。
- **可逆接入**：见上文第 3、6 条；不改写任何 preset 声明。

自动触发、阈值、近期历史保留、事务与 `/compact` 仍由官方 Basic 后端负责。交接生成本身不调用模型，但不表示整个会话不产生模型请求或费用，也不表示每次压缩都替换全部历史。

交接信息有预算与截断，账本也依赖记录质量与存储可用性，不能保证信息无损。日志保留不等于所有信息始终位于模型当前上下文中。

![交接卡片预览；不是当前宿主验收记录](<preview-handoff.png>)

## 环境要求

- Node.js ≥ 22.15.0。
- DSH `>=0.2.2-rc.1 <0.3.0`：当前接入依赖该版本的宿主 peer resolver 与 agent scope 接口。
- pnpm，用于同步目标 profile 的依赖；自动下载仓库另需 git。

运行时依赖由 DSH 宿主解析，包括 Desktop 的 asar 内包。安装脚本不创建运行时联接，不要求把官方运行时包复制到仓库。普通 Node 直接导入插件不等于在 DSH 宿主中加载；离线测试使用独立 stub。

## 安装

> 安装会修改 `%USERPROFILE%\.dsh` 下的 profile 配置，影响共享该 profile 的会话，请确认后执行。用脚本或 CLI 写 profile 前，**必须先完全退出使用该 profile 的 DSH**；在插件页内安装不需要退出。装好后不要自动重启 DSH 或打断正在运行的会话，只有宿主明确要求时才询问是否重启。

仓库：<https://github.com/AkotaP/dsh-compact-codex>

**从插件页安装**：侧边栏「插件」→「添加插件」，填入仓库地址 `https://github.com/AkotaP/dsh-compact-codex`。DSH 会先用 `git ls-remote` 探测仓库，再交给 pnpm；装完确认列表里该插件为启用状态。

**命令行安装**（desktop profile 由 Electron 独占管理，执行前先完全退出 DSH）：

```powershell
dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex
```

安装命令只把包加入 profile 的依赖；确认 `dsh.profile.bundles` 中包含 `dsh-compact-codex`，重启 DSH 后插件才加载。包内 [cordis.patch.yml](<cordis.patch.yml>) 只插入 `compact-codex` 一行，不要再往 profile patch 里重复添加。

**让 agent 安装**（把下面这段发给 DSH 里的 agent）：

> 把 `https://github.com/AkotaP/dsh-compact-codex` 装进当前 DSH 的 desktop profile：用侧边栏「插件」页的「添加插件」，或先完全退出 DSH 再执行 `dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex`。装完确认 profile 的 `dsh.profile.bundles` 里包含 `dsh-compact-codex`，并确认插件页能看到该插件；只有宿主明确要求时才询问是否重启，不要自动重启。

**本地开发**（link 方式，源码改动实时生效，需要先退出 DSH）：

```powershell
# 在仓库根目录
node ./scripts/profile.mjs install --dry-run
node ./scripts/profile.mjs install
```

[profile 脚本](<scripts/profile.mjs>) 按以下顺序操作：

1. 读取已存在的 profile，备份清单及已存在的 lockfile。
2. 把本地仓库以 `link:` 形式写入 profile 的 `dependencies`。
3. 在 profile 中运行 `pnpm install --ignore-scripts --no-frozen-lockfile`。
4. 依赖安装成功后才把包加入 `dsh.profile.bundles`。

脚本的 `wx` 锁只防止本安装器同时执行，不与 DSH 或编辑器共享写锁；读后比较再 rename 仅是 best-effort 过期检查，不是对其他写入者的原子 CAS。目标 profile 的清单或 lockfile 为符号链接或非普通文件时拒绝写入；dry run 报告 `requiresExclusiveProfileAccess: true`，不表示已经取得独占访问。依赖安装失败时会尝试恢复原清单，但 pnpm 对 lockfile 或依赖目录的影响不保证全部撤销。

### 路径与参数

显式 profile 目录优先；未显式提供 home 或 profile 时，优先使用 `DSH_PROFILE_DIR`，否则组合 `DSH_HOME`、`DSH_PROFILE`；缺省 home 为 `~/.dsh`，profile 为 `desktop`。

| 参数 | 用途 |
| --- | --- |
| `--profile-dir <path>` | 指定已存在的 profile 目录 |
| `--home <path>` | 指定 DSH home |
| `--profile <name>` | 指定 profile 名 |
| `--repo <path>` | 指定本地仓库 |
| `--dry-run` | 只显示计划，不写文件、不执行 pnpm |
| `--skip-pnpm` | 跳过依赖同步；新安装只准备依赖声明，不启用 bundle |

使用 `--skip-pnpm` 不代表安装完成；应修复依赖后重新执行正常安装。

## 配置

位置：**设置 → 插件 → 本插件详情页**。表单按「基础 / 缓存保活（付费） / 冷缓存换窗 / 诊断」四组卡片展示，每个字段附一行说明；保存的是 `compact-codex` 行的整个 `options` 对象，只读、服务不可用或保存失败时以页面提示为准。

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | 启用实例适配与 agent 辅助功能 |
| `handoffTokens` | `20000` | 交接信息的估算 token 预算，整数范围 1000–64000，不是严格输出上限 |
| `budgetContext` | `false` | 向模型注入预算与缓存诊断读数 |
| `keepalive` | `false` | 空闲缓存保活；开启后会发真实模型请求并消耗额度 |
| `cacheTtlMs` | `3600000` | 缓存 TTL 假设（毫秒）；超过即视为过期 |
| `keepaliveAfterMs` | `3120000` | 空闲多久后开始保活（毫秒） |
| `minCacheReadTokens` | `40000` | 保活的前缀规模下限（token） |
| `idleKeepaliveBudget` | `3` | 两次真实请求之间最多保活几次 |
| `maxConsecutiveFailures` | `2` | 连续失败达到该次数后停止保活 |
| `coldSwitch` | `false` | 缓存过期后是否在下一步主动换窗 |
| `coldMinTokens` | `100000` | 触发冷换窗的上下文下限（token） |
| `checkEveryMs` | `15000` | 冷热状态检查周期（毫秒） |

**两个自动行为默认都关闭**：`keepalive` 会发真实请求并产生费用；`coldSwitch` 会在缓存过期后的下一步主动换窗。需要时再显式打开。阈值、保留比例和路由策略仍配置在官方 Basic 后端，不属于本插件详情表单。

1.1 及更早版本使用的 `preset-config.json` 已从仓库移除；详情页不会读取或迁移它，旧引擎专用字段也不能直接当作宿主 `options`。保留的显式引擎入口仅用于兼容调用，不是推荐安装方式。1.2 起不再提供 preset 同步脚本。

## 工具

仅在已适配 agent 的作用域中注册：

| 工具 | 用途 |
| --- | --- |
| `new_context` | 登记换窗请求，在后续允许执行的步边界复核后调用官方 `compactRegion()` |
| `ledger_append` | 追加任务进度、下一步、验收条件和证据 |
| `ledger_read` | 读取概览、当前窗口记录或搜索账本 |
| `history` | 搜索会话事件，或按编号分页读取正文和调用参数 |

账本非空时，主动换窗要求当前窗口内最近请求后的记账足够新，且未记账工具结果不超出门槛；没有新请求时仍检查未记账尾部。工具返回“已登记”不等于压缩已完成，应查看后续事件。

## 验证

```powershell
npm test
```

离线测试通过[测试注册器](<test/support/register-runtime.mjs>)显式加载 stub，不启动真实 profile，也不验证当前 GUI、真实模型缓存命中或付费请求。真实宿主隔离 smoke、实际安装和浏览器 UI 验收应单独记录；此处不列未经确认的测试通过数。

安装完成后可确认：插件页显示启用、profile 的 `dsh.profile.bundles` 含 `dsh-compact-codex`、下一次压缩生成带交接标题的消息而不是模型摘要。

## 卸载与升级

**在插件页内卸载**：侧边栏「插件」→ 本插件 → 卸载，随后确认 `dsh.profile.bundles` 中已移除。

**用脚本卸载**（需要先退出 DSH，对应本地 link 安装）：

```powershell
node ./scripts/profile.mjs uninstall --dry-run
node ./scripts/profile.mjs uninstall
```

脚本卸载先移除 bundle 与依赖声明，再同步依赖；同步失败不会重新启用 bundle，但可能仍需修复依赖目录或 lockfile。宿主内禁用或卸载插件时的资源释放属于插件生命周期，不受脚本独占访问要求影响。

卸载不是零残留清理：历史日志、任务账本、诊断文件、仓库与备份均保留，也不恢复已经压缩的历史表面。GUI 保存过的配置可能在 profile patch 中留下无效行；脚本不自动删除此类配置或其他手工改动，应核对后决定是否移除。

从上游 1.1.x 升级到本 fork 的 1.2.x 时，应检查旧的 preset 覆盖与手工运行时联接，备份后按来源分别处理。新脚本不会扫描删除这些旧内容，也不会用旧备份整体覆盖现有 profile。DSH 升级后无需重新同步 preset，但应复核宿主接口兼容性。

## 与上游的差异

| | 上游 1.1.2 | 本 fork 1.2.x |
| --- | --- | --- |
| 接入点 | 替换 `ctx.compaction` 服务、覆写 preset | 只装饰官方实例的 `summarize()` |
| 自定义后端 | 一并接管 | 不接管，保留原行为 |
| 配置 | `preset-config.json` + preset patch | 插件详情页的 volatile `options` |
| 安装 | 脚本写 preset | 插件页 / git / 本地 link |

## 文档

- [工作原理](<docs/how-it-works.md>)：交接、账本、历史与缓存。
- [实现说明](<docs/internals.md>)：实例适配、作用域、配置与安装边界。
- [变更记录](<CHANGELOG.md>)：各版本变更。

## 许可证

[MIT](<LICENSE>)
