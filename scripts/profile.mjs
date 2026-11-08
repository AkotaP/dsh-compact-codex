/** Install/remove this bundle without runtime Junctions or preset edits. */
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync, copyFileSync, realpathSync, lstatSync, openSync, closeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export const PACKAGE = 'dsh-compact-codex'
const ownRoot = dirname(dirname(fileURLToPath(import.meta.url)))
function json(text) { return JSON.parse(text.replace(/^\uFEFF/, '')) }
function format(value) { return JSON.stringify(value, null, 2) + '\n' }
function bundlesOf(profile) {
 const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
 if (!record(profile)) throw new Error('Profile manifest must be an object')
 if (profile.dsh !== undefined && !record(profile.dsh)) throw new Error('dsh must be an object')
 if (profile.dsh?.profile !== undefined && !record(profile.dsh.profile)) throw new Error('dsh.profile must be an object')
 const value = profile.dsh?.profile?.bundles
 if (value !== undefined && (!Array.isArray(value) || value.some(name => typeof name !== 'string'))) throw new Error('dsh.profile.bundles must be an array of names')
 return value ?? []
}
function setBundles(profile, bundles) {
 profile.dsh ??= {}
 profile.dsh.profile ??= {}
 profile.dsh.profile.bundles = bundles
}
/** Best-effort stale-read guard. The caller must exclude non-cooperating Host/editor writes. */
function replaceFile(file, text, expected) {
 if (readFileSync(file, 'utf8') !== expected) throw new Error('Profile changed concurrently; inspect it before retrying: ' + file)
 const temp = file + '.tmp-compact-codex-' + randomUUID()
 try { writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx' }); renameSync(temp, file) }
 finally { rmSync(temp, { force: true }) }
}
function packageManager(profileDir) {
 const result = spawnSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
  cwd: profileDir, stdio: 'inherit', shell: process.platform === 'win32'
 })
 if (result.error || result.status !== 0) throw new Error('pnpm install failed: ' + (result.error?.message ?? result.status))
}

/** Serializes this installer's own operations; it is not a shared DSH/editor lock. */
export async function manageProfile(options, runPnpm = packageManager) {
 if (options.dryRun || !options.profileDir) return manageOwnedProfile(options, runPnpm)
 const lock = join(resolve(options.profileDir), '.compact-codex-profile.lock')
 let fd
 try { fd = openSync(lock, 'wx') }
 catch (cause) { throw new Error('Profile installer lock exists or cannot be created. Exclude concurrent operations before retrying: ' + lock, { cause }) }
 try { return await manageOwnedProfile(options, runPnpm) }
 finally { closeSync(fd); rmSync(lock, { force: true }) }
}
async function manageOwnedProfile({ action, profileDir, repo = ownRoot, dryRun = false, skipPnpm = false }, runPnpm) {
 if (action !== 'install' && action !== 'uninstall') throw new Error('Action must be install or uninstall')
 if (!profileDir) throw new Error('An existing profile directory is required')
 profileDir = resolve(profileDir)
 const file = join(profileDir, 'package.json')
 const fileStat = lstatSync(file)
 if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('Profile manifest must be a regular file, not a symbolic link')
 const original = readFileSync(file, 'utf8')
 const profile = json(original)
 const bundles = bundlesOf(profile)
 if (profile.dependencies !== undefined && (typeof profile.dependencies !== 'object' || !profile.dependencies || Array.isArray(profile.dependencies))) {
  throw new Error('dependencies must be an object')
 }
 if (action === 'install') {
  repo = realpathSync(resolve(repo))
  const manifest = json(readFileSync(join(repo, 'package.json'), 'utf8'))
  if (manifest.name !== PACKAGE || !existsSync(join(repo, 'lib/plugin.js'))) throw new Error('Not a compatible plugin repository: ' + repo)
 }
 const link = 'link:' + repo.replace(/\\/g, '/')
 const dependency = profile.dependencies?.[PACKAGE]
 const selected = bundles.includes(PACKAGE)
 const plan = { action, profileDir, repo, selected, dependency, dryRun, skipPnpm,
  requiresExclusiveProfileAccess: true,
  steps: action === 'install' ? ['prepare dependency', 'pnpm install', 'enable bundle'] : ['disable bundle and remove dependency', 'pnpm install'] }
 if (dryRun) return plan
 if (action === 'uninstall' && !selected && dependency === undefined) return { ...plan, changed: false }
 const lock = join(profileDir, 'pnpm-lock.yaml')
 if (existsSync(lock) && (!lstatSync(lock).isFile() || lstatSync(lock).isSymbolicLink())) throw new Error('Profile lockfile must be a regular file, not a symbolic link')
 const backup = file + '.bak-compact-codex-' + Date.now() + '-' + randomUUID().slice(0, 8)
 copyFileSync(file, backup)
 const lockBackup = existsSync(lock) ? backup + '.lock' : undefined
 if (lockBackup) copyFileSync(lock, lockBackup)
 if (action === 'uninstall') {
  setBundles(profile, bundles.filter(name => name !== PACKAGE))
  if (profile.dependencies) delete profile.dependencies[PACKAGE]
  replaceFile(file, format(profile), original)
  // Failure must not re-enable a bundle that the operator explicitly removed.
  if (!skipPnpm) {
   try { await runPnpm(profileDir) }
   catch (cause) { throw new Error('Bundle disabled; dependency cleanup failed. Run pnpm install after resolving the error. Backup: ' + backup, { cause }) }
  }
  return { ...plan, changed: true, backup, enabled: false, cleanupPending: skipPnpm }
 }
 profile.dependencies ??= {}
 profile.dependencies[PACKAGE] = link
 const staged = format(profile)
 replaceFile(file, staged, original)
 if (skipPnpm) return { ...plan, changed: true, backup, enabled: selected, preparedOnly: true }
 try { await runPnpm(profileDir) }
 catch (cause) {
  // Revert only files still owned by this transaction. Never overwrite a new operator edit.
  try {
   replaceFile(file, original, staged)
  } catch (rollback) {
   throw new AggregateError([cause, rollback], 'Install failed and profile changed concurrently; inspect the backup: ' + backup)
  }
  // pnpm can change node_modules; do not claim those effects were rolled back.
  throw new Error('Install failed; original profile manifest restored. node_modules/lockfile may need pnpm repair. Backup: ' + backup, { cause })
 }
 setBundles(profile, [...bundles.filter(name => name !== PACKAGE), PACKAGE])
 replaceFile(file, format(profile), staged)
 return { ...plan, changed: true, backup, enabled: true }
}

export function parseArgs(argv, env = process.env) {
 const [action = 'install', ...args] = argv
 const values = {}
 const flags = new Set()
 for (let i = 0; i < args.length; i++) {
  const key = args[i]
  if (key === '--dry-run' || key === '--skip-pnpm') { flags.add(key); continue }
  if (!['--profile-dir', '--profile', '--home', '--repo'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Unknown or incomplete argument: ' + key)
  values[key] = args[++i]
 }
 const profile = values['--profile'] ?? env.DSH_PROFILE ?? 'desktop'
 if (!/^[A-Za-z0-9._-]+$/.test(profile) || profile === '.' || profile === '..') throw new Error('Invalid profile name')
 const home = values['--home'] ?? env.DSH_HOME ?? join(homedir(), '.dsh')
 const profileDir = values['--profile-dir'] ?? ((!values['--home'] && !values['--profile'] && env.DSH_PROFILE_DIR) || join(home, 'profiles', profile))
 return { action, profileDir, repo: values['--repo'] ?? ownRoot, dryRun: flags.has('--dry-run'), skipPnpm: flags.has('--skip-pnpm') }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const result = await manageProfile(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(result, null, 2))
  if (result.dryRun) console.log('Dry run only: no files changed.')
  else if (result.preparedOnly) console.log('Dependency prepared only. Run pnpm install before enabling the bundle.')
  else console.log('Profile updated. Check the plugin status in DSH; a startup-only profile needs a restart. No presets were rewritten.')
 } catch (error) {
  console.error(error.message)
  if (error.cause) console.error(String(error.cause))
  process.exitCode = 1
 }
}
