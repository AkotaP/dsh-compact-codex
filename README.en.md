# dsh-compact-codex

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.md)

> **Fork notice**: this repository is a fork of [niszhum/dsh-compact-codex](https://github.com/niszhum/dsh-compact-codex), maintained by [AkotaP](https://github.com/AkotaP). Since 1.2 the integration is minimally invasive and differs from the upstream 1.1.2 "replace the compaction service" approach. Upstream history lives in the [upstream repository](https://github.com/niszhum/dsh-compact-codex/commits/main); changes in this fork are recorded in the [CHANGELOG](<CHANGELOG.md>).

A DeepSeek Harness (DSH) plugin that replaces model summaries with a program-generated context handoff at the compaction point. Generation makes no model request, so it completes instantly; the session log is never deleted, so earlier content stays retrievable by event number.

## The problem

DSH's default compaction asks the model to read the whole span and write a summary:

- **Slow** — one compaction is one full model request; long sessions often wait tens of seconds.
- **Expensive** — the compaction itself consumes tokens and budget.
- **Lossy** — a summary is irreversible; exact commands, error text, and concrete paths are easily dropped.

The plugin reads the session events and the task ledger that already exist at the compaction point and assembles a structured handoff. It makes no model request, leaves the official compaction policy untouched, and deletes no history.

## Behavior

1. **Locate** — the host entry looks up the `compaction` service an agent actually uses, instead of replacing configuration by preset name.
2. **Admit** — only instances whose prototype is exactly the official `BasicCompactionEngine.prototype` and which have no instance-level `summarize` are accepted. Custom backends, subclasses, and already-decorated implementations keep their own behavior.
3. **Decorate** — install a reversible `summarize()` wrapper on that instance; the official prototype is not modified and the engine is not rebuilt.
4. **Route** — the wrapper dispatches per owner agent: registered agents get the code-generated handoff, other owners fall back to the original method.
5. **Display** — the browser side renders a handoff card only for messages sourced from `compact-checkpoint` that carry the plugin's handoff heading. Official compaction rows are not hidden.
6. **Restore** — disabling or uninstalling the plugin restores the decorated method and releases the tools, listeners, and keepalive resources held in the agent scope. Already-committed compaction history is not rolled back.

## Features and boundaries

- **Context handoff** — collects the latest request, the previous assistant reply, the task ledger, recent actions, and the file working set; each entry's event number can be used to read the original.
- **Task ledger** — records progress, next step, acceptance conditions, and evidence; before a handoff the plugin tries to snapshot unrecorded actions.
- **History search** — searches host session events or reads them by number, including compacted events that are still in the log.
- **Cache observation** — estimates hot/cold from provider usage plus local TTL assumptions; cold-cache switching and paid keepalive are both off by default and can be enabled on the plugin detail page.
- **Reversible integration** — see items 3 and 6 above; no preset declaration is rewritten.

Automatic triggering, thresholds, recent-history retention, transactions, and `/compact` remain owned by the official Basic backend. The handoff generator makes no model request, but that does not mean a session produces no model requests or cost, nor that every compaction replaces the entire history.

Handoffs are budgeted and truncated, and the ledger depends on record quality and storage availability; information loss cannot be ruled out. A retained log does not mean all of it is always in the model's current context.

![Handoff card preview; not a host acceptance record](<preview-handoff.png>)

## Requirements

- Node.js ≥ 22.15.0.
- DSH `>=0.2.2-rc.1 <0.3.0`; the integration depends on this version's host peer resolver and agent scope API.
- pnpm, used to sync dependencies into the target profile; automatic repository download additionally needs git.

Runtime dependencies are resolved by the DSH host, including packages inside Desktop's asar. The install script creates no runtime junction and does not copy official runtime packages into the repository. Importing the plugin from plain Node is not the same as loading it inside the DSH host; offline tests use an independent stub.

## Install

> Installing changes the profile configuration under `%USERPROFILE%\.dsh` and affects sessions that share that profile; confirm before running. Before writing a profile with the script or CLI, **fully quit DSH using that profile**; installing from the Plugins page needs no quit. Do not automatically restart DSH or interrupt running sessions afterwards; ask only when the host explicitly requires a restart.

Repository: <https://github.com/AkotaP/dsh-compact-codex>

**From the Plugins page** — sidebar **Plugins** → **Add plugin**, and enter the repository address `https://github.com/AkotaP/dsh-compact-codex`. DSH probes the repository with `git ls-remote` before handing it to pnpm; once installed, confirm the plugin is enabled.

**One command** (the desktop profile is managed exclusively by the Electron app, so fully quit DSH first):

```powershell
dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex
```

The command only adds the package to the profile dependencies; confirm `dsh.profile.bundles` contains `dsh-compact-codex`, and restart DSH before the plugin loads. The bundled [cordis.patch.yml](<cordis.patch.yml>) inserts only the `compact-codex` row; do not add it to the profile patch again.

**Let an agent install it** (paste this into a DSH agent):

> Install `https://github.com/AkotaP/dsh-compact-codex` into the current DSH desktop profile: use the sidebar **Plugins** page's **Add plugin**, or fully quit DSH and run `dsh plugin --profile desktop add https://github.com/AkotaP/dsh-compact-codex`. After installing, confirm `dsh.profile.bundles` contains `dsh-compact-codex` and that the Plugins page shows it. Ask before restarting only if the host explicitly requires a restart; do not restart automatically.

**Local development** (link a checkout so source changes apply live; quit DSH first):

```powershell
# from the repository root
node ./scripts/profile.mjs install --dry-run
node ./scripts/profile.mjs install
```

The [profile script](<scripts/profile.mjs>) performs these steps in order:

1. Read the existing profile and back up the manifest plus any existing lockfile.
2. Write the local repository into the profile `dependencies` as a `link:`.
3. Run `pnpm install --ignore-scripts --no-frozen-lockfile` in the profile.
4. Add the package to `dsh.profile.bundles` only after dependencies install successfully.

The script's `wx` lock only prevents concurrent runs of this installer; it does not share a write lock with DSH or editors. Compare-before-rename is a best-effort stale check, not an atomic CAS against other writers. The script refuses a profile manifest or lockfile that is a symlink or not a regular file; a dry run reporting `requiresExclusiveProfileAccess: true` does not mean exclusive access was obtained. On dependency failure the script tries to restore the original manifest, but pnpm's effects on the lockfile or dependency directory are not guaranteed to be fully rolled back.

### Paths and options

An explicit profile directory wins; without one, `DSH_PROFILE_DIR` is preferred, otherwise `DSH_HOME` and `DSH_PROFILE` are combined; the default home is `~/.dsh` and the default profile is `desktop`.

| Option | Purpose |
| --- | --- |
| `--profile-dir <path>` | Use an existing profile directory |
| `--home <path>` | Use a specific DSH home |
| `--profile <name>` | Use a specific profile name |
| `--repo <path>` | Use a specific local repository |
| `--dry-run` | Print the plan only; no writes, no pnpm |
| `--skip-pnpm` | Skip dependency sync; a new install only prepares the declaration and enables no bundle |

`--skip-pnpm` does not mean the install is complete; fix dependencies and run a normal install.

## Configuration

Location: **Settings → Plugins → this plugin's detail page**. The form is grouped into four cards — Basics, Cache keepalive (paid), Cold-cache switching, and Diagnostics — with one line of explanation per field. It saves the whole `options` object of the `compact-codex` row; when read-only, unavailable, or failing to save, the page message is authoritative.

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enables instance adaptation and agent helper features |
| `handoffTokens` | `20000` | Estimated token budget for the handoff, integer 1000–64000; not a hard output cap |
| `budgetContext` | `false` | Injects budget and cache diagnostics into the model context |
| `keepalive` | `false` | Idle cache keepalive; sends real model requests and consumes budget |
| `cacheTtlMs` | `3600000` | Assumed cache TTL in ms; past it the cache counts as expired |
| `keepaliveAfterMs` | `3120000` | Idle time before keepalive starts (ms) |
| `minCacheReadTokens` | `40000` | Minimum tracked prefix for keepalive (tokens) |
| `idleKeepaliveBudget` | `3` | Max keepalives between two real requests |
| `maxConsecutiveFailures` | `2` | Keepalive stops after this many consecutive failures |
| `coldSwitch` | `false` | Whether to compact at the next step once the cache expired |
| `coldMinTokens` | `100000` | Minimum context for a cold-cache switch (tokens) |
| `checkEveryMs` | `15000` | Cache-state check interval (ms) |

**Both automatic behaviors are off by default**: `keepalive` sends real requests and incurs charges; `coldSwitch` compacts at the next step once the cache expires. Turn them on explicitly when wanted.

Thresholds, retention ratios, and routing stay configured on the official Basic backend; they are not part of this plugin's form.

The `preset-config.json` used by 1.1 and earlier has been removed from the repository; the detail page does not read or migrate it, and legacy engine-only fields cannot be used as host `options`. The retained explicit engine entry exists only for compatible calls, not as a recommended install path. 1.2 ships no preset-sync script.

## Tools

Registered only in the scope of an adapted agent:

| Tool | Purpose |
| --- | --- |
| `new_context` | Registers a window-switch request; the host validates it at an allowed step boundary and then calls the official `compactRegion()` |
| `ledger_append` | Appends progress, next step, acceptance conditions, and evidence |
| `ledger_read` | Reads the overview, the current window's entries, or searches the ledger |
| `history` | Searches session events or pages through them by number, including arguments and output |

With a non-empty ledger, an explicit window switch requires the current window's post-request bookkeeping to be fresh and the unrecorded tool result count to stay under a threshold; with no new request the unrecorded tail is still checked. A tool returning "registered" does not mean compaction has run; inspect the following events.

## Verification

```powershell
npm test
```

Offline tests load stubs explicitly through the [test registrar](<test/support/register-runtime.mjs>); they start no real profile and do not verify the current GUI, real cache hits, or paid requests. Real host isolation smoke, actual installation, and browser UI acceptance should be recorded separately; no unconfirmed pass counts are listed here.

After installing, confirm that the Plugins page shows the plugin enabled, that `dsh.profile.bundles` contains `dsh-compact-codex`, and that the next compaction produces a message with the handoff heading rather than a model summary.

## Uninstall and upgrade

**From the Plugins page** — sidebar **Plugins** → this plugin → uninstall, then confirm `dsh-compact-codex` is gone from `dsh.profile.bundles`.

**With the script** (quit DSH first; for local link installs):

```powershell
node ./scripts/profile.mjs uninstall --dry-run
node ./scripts/profile.mjs uninstall
```

The script removes the bundle and the dependency declaration first, then syncs dependencies; a failed sync does not re-enable the bundle but may still require repairing the dependency directory or lockfile. Resource release when disabling or uninstalling inside the host belongs to the plugin lifecycle and is not subject to the script's exclusive-access requirement.

Uninstall is not zero-residue cleanup: historical logs, the task ledger, diagnostic files, the repository, and backups are kept, and compacted history is not restored. Configuration saved in the GUI may leave invalid rows in the profile patch; the script does not delete such configuration or other manual edits, so review before removing.

When upgrading from upstream 1.1.x to this fork's 1.2.x, inspect legacy preset overrides and manual runtime junctions, back up, and handle each source separately. The new script does not scan for or delete those legacy artifacts and never overwrites the current profile with an old backup wholesale. Re-syncing presets after a DSH upgrade is unnecessary, but host interface compatibility should be re-checked.

## Differences from upstream

| | Upstream 1.1.2 | This fork 1.2.x |
| --- | --- | --- |
| Integration point | Replaces the `ctx.compaction` service and overrides presets | Decorates the official instance's `summarize()` only |
| Custom backends | Taken over as well | Left alone and keep their behavior |
| Configuration | `preset-config.json` plus preset patches | The plugin page's volatile `options` |
| Install | Script writes presets | Plugins page / git / local link |

## Documentation

- [How it works](<docs/how-it-works.md>): handoff, ledger, history, and cache.
- [Internals](<docs/internals.md>): instance adaptation, scope, configuration, and install boundaries.
- [Changelog](<CHANGELOG.md>): per-version changes.

## License

[MIT](<LICENSE>)
