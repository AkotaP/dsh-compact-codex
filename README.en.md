# dsh-compact-codex

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](<README.md>)

> **Fork notice**: this repository is a fork of [niszhum/dsh-compact-codex](https://github.com/niszhum/dsh-compact-codex), maintained by [AkotaP](https://github.com/AkotaP). Since 1.2, it generates handoffs through eligible official instances rather than replacing the compaction service or overriding presets. Upstream history is in the [upstream repository](https://github.com/niszhum/dsh-compact-codex/commits/main); changes in this fork are in the [CHANGELOG](<CHANGELOG.md>).

A DeepSeek Harness (DSH) plugin that replaces model summaries with program-generated context handoffs during compaction. Handoff generation makes no model request and deletes no session log; original events can be retrieved by event number while they remain readable.

## The problem

Model summaries need an extra model request, adding latency and token usage, and may omit details such as commands, errors, and paths.

This plugin instead reads existing session events and the task ledger to collect the current request, progress, and history references, avoiding the summary-generation request. Handoffs still have budgets and truncation, and the ledger depends on record quality and storage availability; they are not lossless. Keeping a log does not mean its full text stays in the model context.

## Behavior

1. **Scope** — looks up the `compaction` service each agent actually uses. Only instances whose prototype is exactly the official `BasicCompactionEngine.prototype` and which have no own `summarize` property are eligible. Custom backends, subclasses, and existing instance-level summary changes keep their behavior.
2. **During compaction** — wraps the instance's `summarize()` to generate a handoff. If the instance has no own `compactIfNeeded()`, it also wraps that method for the pre-compaction bookkeeping reminder. It does not modify the official prototype, rebuild the engine, or override presets. Registered agents get handoffs; other owners use the original method.
3. **Display** — renders a handoff card only for messages sourced from `compact-checkpoint` that contain the plugin's handoff heading. Other compaction rows are not hidden.
4. **Disable or uninstall** — releases the agent's tools, listeners, and keepalive resources. The last user of an instance restores the plugin-wrapped methods, unless another plugin has since changed them. Existing compaction history is not rolled back.

## Features and boundaries

- **Context handoff** — collects the latest request, previous assistant reply, task ledger, recent actions, and file working set, with event numbers for retrieval.
- **Task ledger** — records progress, next step, acceptance conditions, and evidence. Before a handoff, the plugin tries to snapshot unrecorded actions; a snapshot is not proof of task completion.
- **History search** — searches host session events or reads them by number, including compacted events that remain in the readable log.
- **Cache observation** — estimates hot/cold state from provider usage and a local TTL assumption; it does not guarantee actual cache hits or exact costs. Paid keepalive and cold-cache switching are off by default and require explicit enabling on the plugin detail page.
- **Pre-compaction reminder** — on by default. When pressure compaction reaches the threshold, the ledger is empty or stale, model capacity and usage are available, and the deferral still leaves room for the nudged step, it defers at most one step boundary to remind the model to record progress. This reminder causes no further deferral in the same window and does not guarantee the model records progress. The `overflow` trigger is not deferred, and the official threshold is unchanged.

The official Basic backend still handles automatic triggering, compaction ranges, recent-history retention, transactions, and `/compact`; the plugin adds only the deferral described above to that flow. Compaction does not necessarily replace the entire history. Handoff generation makes no model request, but normal inference and optional keepalive can still generate requests and charges.

![Handoff card preview; not a host acceptance record](<preview-handoff.png>)

## Requirements

- Node.js ≥ 22.15.0.
- DSH `>=0.2.2-rc.1 <0.3.0`; requires the host's peer dependency resolution and agent scope API.
- pnpm to sync the target profile's dependencies; downloading from the repository also needs git.

The DSH host resolves runtime dependencies, including packages inside Desktop's asar. The install script creates no runtime junctions and copies no official runtime packages. Importing the plugin from plain Node does not verify host loading; offline tests use independent stubs.

## Install

> Installation changes profile configuration under DSH home (default `%USERPROFILE%\.dsh` on Windows) and affects sessions sharing that profile; confirmation is required before proceeding. Before writing a profile with the script or CLI, **fully quit DSH using that profile** and stop other profile edits or plugin-management operations. Installation from the Plugins page needs no quit. Do not automatically restart DSH or interrupt sessions; ask about restarting a running host only when it explicitly requires it.

Repository: <https://github.com/AkotaP/dsh-compact-codex>

**From the Plugins page** — sidebar **Plugins** → **Add plugin**, then enter `https://github.com/AkotaP/dsh-compact-codex`. DSH probes the repository with `git ls-remote` before passing it to pnpm. After installation, confirm the plugin is enabled and check whether the host reports a required restart.

**Command-line installation** (the desktop profile is managed exclusively by Electron, so fully quit DSH first):

```powershell
dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex
```

After the command completes, confirm the profile dependencies are installed and `dsh.profile.bundles` contains `dsh-compact-codex`. Then start DSH and check the plugin status. The bundled [cordis.patch.yml](<cordis.patch.yml>) inserts only the `compact-codex` row; do not add it again in the profile patch.

**Installation instructions for an agent**:

> Install `https://github.com/AkotaP/dsh-compact-codex` into the current DSH desktop profile. Prefer sidebar **Plugins** → **Add plugin**. If using the CLI, arrange to fully quit DSH before running `dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex`. After installation, confirm `dsh.profile.bundles` contains `dsh-compact-codex` and the Plugins page shows it enabled. Do not restart automatically; ask about restarting a running host only when it explicitly requires it.

**Local development** (link a checkout; quit DSH before running the script):

```powershell
# from the repository root
node ./scripts/profile.mjs install --dry-run
node ./scripts/profile.mjs install
```

The [profile script](<scripts/profile.mjs>) runs these steps in order:

1. Read the existing profile and back up the manifest and any existing lockfile.
2. Add the local checkout to the profile's `dependencies` as a `link:`.
3. Run `pnpm install --ignore-scripts --no-frozen-lockfile` in the profile.
4. Add the package to `dsh.profile.bundles` after dependencies install successfully.

`link:` only points the dependency at the checkout; it does not guarantee that saved source changes take effect immediately. Host code must be loaded through DSH recomposition or a restart. Client updates depend on the host's client hot-reload support and may require a page refresh. Verify the loaded behavior after each change.

The installer lock prevents only concurrent runs of this installer, not writes by DSH or editors. The script checks for changed content before writing, but a race remains between that check and the rename, so it cannot reject every concurrent overwrite. It refuses profile manifests or lockfiles that are symlinks or non-regular files. A dry run reporting `requiresExclusiveProfileAccess: true` states a requirement, not that exclusive access was obtained. On dependency failure it tries to restore the original manifest, but cannot guarantee undoing all pnpm changes to the lockfile or dependency directory.

### Paths and options

`--profile-dir` takes precedence. If neither `--home` nor `--profile` is supplied, `DSH_PROFILE_DIR` is preferred. Otherwise the path combines `--home` / `DSH_HOME` with `--profile` / `DSH_PROFILE`, defaulting to `~/.dsh` and `desktop`.

| Option | Purpose |
| --- | --- |
| `--profile-dir <path>` | Use an existing profile directory |
| `--home <path>` | Use a specific DSH home |
| `--profile <name>` | Use a specific profile name |
| `--repo <path>` | Use a specific local repository |
| `--dry-run` | Print the plan only; no writes or pnpm |
| `--skip-pnpm` | Skip dependency sync; a new install only prepares the dependency declaration without enabling the bundle; uninstall leaves dependency cleanup pending |

`--skip-pnpm` does not complete installation or disable an already-enabled bundle. After resolving dependency issues, rerun a normal install or uninstall.

## Configuration

Location: **Settings → Plugins → this plugin's detail page**. The form has four groups: Basics, Cache keepalive (paid), Compaction after cache expiry, and Diagnostics. Clicking Save writes the whole `options` object of the `compact-codex` row; Discard unsaved edits restores saved values, not defaults. Read-only state, unavailable services, and save failures are shown on the page; editing a field alone does not mean it took effect.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables handoff replacement and the agent's helper tools; disabling restores original behavior without rolling back history |
| `handoffTokens` | `20000` | Estimated handoff token budget, integer 1000–64000; not the compaction trigger threshold or a hard output cap |
| `budgetContext` | `false` | Appends budget and cache diagnostics to the model context; disabling does not disable automatic compaction or workflow reminders |
| `preCompactNudge` | `true` | When conditions are met, defers one step boundary before pressure compaction to remind the model to record progress; once per window |
| `keepalive` | `false` | Idle cache keepalive; can send real model requests and incur charges when enabled |
| `cacheTtlMs` | `3600000` | Estimated cache lifetime shared by keepalive and cold-cache switching (ms), not a provider guarantee |
| `keepaliveAfterMs` | `3120000` | Time since the last observed cache activity before trying keepalive (ms); other conditions still apply |
| `minCacheReadTokens` | `40000` | Minimum observed cache prefix for keepalive (tokens) |
| `idleKeepaliveBudget` | `3` | Maximum keepalive attempts between normal requests |
| `maxConsecutiveFailures` | `2` | Stops trying after this many consecutive keepalive failures |
| `coldSwitch` | `false` | Switches at an allowed step boundary when the cache is judged expired, context is large enough, and ledger checks pass |
| `coldMinTokens` | `100000` | Minimum context size for cold-cache switching (tokens) |
| `checkEveryMs` | `15000` | Background check interval when keepalive is enabled (ms); cold-cache switching is checked at step boundaries |

All numeric values must be safe integers. `cacheTtlMs`, `keepaliveAfterMs`, and `checkEveryMs` have a minimum of 1000; `maxConsecutiveFailures` has a minimum of 1; other cache values have a minimum of 0.

No keepalive is sent when `keepaliveAfterMs >= cacheTtlMs` or `idleKeepaliveBudget: 0`. Keepalive requests set `maxTokens: 1` to limit output; this does not mean total billing is only 1 token.

**Paid keepalive and cold-cache switching are off by default.** Keepalive does not guarantee a cache hit, and cancelling a sent request does not guarantee no charge. Cold-cache switching reduces model-visible history and is not guaranteed lossless or cheaper. The official Basic backend's thresholds, retention ratios, and routing are not configured in this form.

The `preset-config.json` used by 1.1 and earlier has been removed; the detail page does not read or migrate it. Legacy engine fields cannot be used directly as host `options`. The retained explicit engine entry is for compatibility, not the recommended installation path. There is no preset-sync script from 1.2 onward.

## Tools

Registered only in the scope of an eligible, attached agent:

| Tool | Purpose |
| --- | --- |
| `new_context` | Registers a window-switch request; rechecks it at a later allowed step boundary before calling the official `compactRegion()` |
| `ledger_append` | Appends progress, next step, acceptance conditions, and evidence |
| `ledger_read` | Reads the overview or current window's entries, or searches the ledger |
| `history` | Searches session events or reads text and call arguments by event number with pagination |

With a non-empty ledger, an explicit switch requires bookkeeping after the latest request in the current window, and the unrecorded tool result count must stay under a threshold. With no new request, the unrecorded tail is still checked. A tool returning "registered" does not mean compaction completed; check subsequent compaction events. Relative ledger `anchors.path` values resolve from the session's current working directory; absolute paths are used as written. If the ledger cannot be read, the window switch is refused instead of treating the ledger as empty.

## Verification

```powershell
npm test
```

Offline tests load stubs through the [test registrar](<test/support/register-runtime.mjs>); they start no real profile and do not verify the current GUI, real cache hits, or paid requests. Real-host smoke checks, installation, and browser acceptance need separate execution and records.

After installation, check that the Plugins page shows the plugin enabled and `dsh.profile.bundles` contains `dsh-compact-codex`. An eligible agent should generate a message with the handoff heading at a later compaction; this is not an acceptance condition for custom backends.

## Uninstall and upgrade

**From the Plugins page** — sidebar **Plugins** → this plugin → uninstall, then confirm it is removed from `dsh.profile.bundles`.

**With the script** (for local link installations; quit DSH first):

```powershell
node ./scripts/profile.mjs uninstall --dry-run
node ./scripts/profile.mjs uninstall
```

The script removes the bundle and dependency declaration before syncing dependencies. A failed sync does not re-enable the bundle, but the dependency directory or lockfile may still need repair. Disabling or uninstalling inside the host releases plugin resources without requiring DSH to quit for that cleanup.

Uninstall keeps historical logs, the task ledger, diagnostic files, the repository, and backups; it does not put compacted original text back into the model context. GUI-saved configuration may leave invalid rows in the profile patch. The script does not delete those settings or other manual edits; review them before removal.

When upgrading from upstream 1.1.x to this fork's 1.2.x, inspect legacy preset overrides and manual runtime junctions, back them up, and handle them separately. The new script does not scan for or delete them, nor overwrite the current profile with an old backup. Presets need no re-sync after a DSH upgrade, but host API compatibility needs rechecking.

## Differences from upstream

| | Upstream 1.1.2 | This fork 1.2.x |
| --- | --- | --- |
| Integration point | Replaces `ctx.compaction` and overrides presets | Wraps the official instance's `summarize()` and, when available, `compactIfNeeded()` for the pre-compaction reminder |
| Custom backends | Taken over as well | Left unchanged |
| Configuration | `preset-config.json` plus preset patches | The plugin detail page's `options`, updated through volatile configuration |
| Install | Script writes presets | Plugins page / git / local link |

## Documentation

- [How it works](<docs/how-it-works.md>): handoff, ledger, history, and cache (Chinese).
- [Internals](<docs/internals.md>): instance integration, scope, configuration, and installation boundaries (Chinese).
- [Changelog](<CHANGELOG.md>): per-version changes.

## License

[MIT](<LICENSE>)
