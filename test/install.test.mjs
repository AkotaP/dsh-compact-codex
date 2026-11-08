import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { manageProfile, parseArgs, PACKAGE } from '../scripts/profile.mjs'
function fixture(t, extra = {}) {
 const dir = mkdtempSync(join(tmpdir(), 'compact-profile-'))
 t.after(() => rmSync(dir, { recursive: true, force: true }))
 const file = join(dir, 'package.json'), patch = join(dir, 'cordis.patch.yml')
 const manifest = { name: 'profile-test', dependencies: { unrelated: '1.0.0' }, dsh: { profile: { bundles: ['base', 'web'], custom: true } }, ...extra }
 const original = JSON.stringify(manifest)
 writeFileSync(file, original)
 writeFileSync(patch, '[] # operator settings stay unchanged\n')
 return { dir, file, patch, original, read: () => JSON.parse(readFileSync(file, 'utf8')) }
}
test('dry run performs no writes and invokes no package manager', async t => {
 const f = fixture(t), before = readdirSync(f.dir)
 const result = await manageProfile({ action:'install', profileDir:f.dir, dryRun:true }, () => assert.fail('not dry'))
 assert.equal(result.dryRun, true)
 assert.deepEqual(readdirSync(f.dir), before)
 assert.equal(readFileSync(f.file,'utf8'), f.original)
})
test('dependency is prepared before selection and other settings stay unchanged', async t => {
 const f = fixture(t)
 let called = 0
 await manageProfile({ action:'install', profileDir:f.dir }, () => {
  called++
  assert.ok(f.read().dependencies[PACKAGE].startsWith('link:'))
  assert.equal(f.read().dsh.profile.bundles.includes(PACKAGE), false)
 })
 assert.equal(called, 1)
 assert.deepEqual(f.read().dsh.profile.bundles, ['base','web',PACKAGE])
 assert.equal(f.read().dependencies.unrelated, '1.0.0')
 assert.equal(f.read().dsh.profile.custom, true)
 assert.equal(readFileSync(f.patch,'utf8'), '[] # operator settings stay unchanged\n')
 assert.ok(readdirSync(f.dir).some(name => name.includes('.bak-compact-codex-')))
 await manageProfile({ action:'install', profileDir:f.dir }, () => {})
 assert.equal(f.read().dsh.profile.bundles.filter(name=>name===PACKAGE).length, 1)
})
test('failed package installation restores original manifest and never enables bundle', async t => {
 const f = fixture(t)
 await assert.rejects(manageProfile({action:'install', profileDir:f.dir}, () => { throw new Error('offline') }), /manifest restored/)
 assert.equal(readFileSync(f.file,'utf8'), f.original)
})
test('concurrent edits are preserved even on installation failure', async t => {
 const f = fixture(t)
 await assert.rejects(manageProfile({action:'install',profileDir:f.dir}, () => {
  const next = f.read(); next.operatorEdit=true; writeFileSync(f.file,JSON.stringify(next)); throw new Error('offline')
 }), /concurrently/)
 assert.equal(f.read().operatorEdit, true)
})
test('skip-pnpm prepares dependencies but cannot falsely announce activation', async t => {
 const f = fixture(t)
 const result = await manageProfile({action:'install',profileDir:f.dir,skipPnpm:true},()=>assert.fail())
 assert.equal(result.preparedOnly, true)
 assert.equal(result.enabled,false)
 assert.equal(f.read().dsh.profile.bundles.includes(PACKAGE),false)
})
test('uninstall removes bundle and dependency before package cleanup', async t => {
 const f = fixture(t, { dependencies:{ unrelated:'1', [PACKAGE]:'link:repo' }, dsh:{profile:{bundles:['base',PACKAGE,'web']}} })
 await manageProfile({action:'uninstall',profileDir:f.dir},()=>{
  assert.equal(f.read().dependencies[PACKAGE],undefined)
  assert.deepEqual(f.read().dsh.profile.bundles,['base','web'])
 })
 assert.equal(f.read().dependencies.unrelated,'1')
 const r = await manageProfile({action:'uninstall',profileDir:f.dir},()=>assert.fail())
 assert.equal(r.changed,false)
})
test('cleanup failure does not re-enable the removed bundle', async t => {
 const f = fixture(t, {dependencies:{[PACKAGE]:'link:repo'},dsh:{profile:{bundles:[PACKAGE]}}})
 await assert.rejects(manageProfile({action:'uninstall',profileDir:f.dir},()=>{throw new Error('offline')}),/Bundle disabled/)
 assert.equal(f.read().dsh.profile.bundles.includes(PACKAGE),false)
})
test('explicit profile selection outranks inherited profile directory',()=>{
 const env={DSH_PROFILE_DIR:'old',DSH_HOME:'home',DSH_PROFILE:'desktop'}
 assert.equal(parseArgs(['install'],env).profileDir,'old')
 assert.equal(parseArgs(['install','--profile','other'],env).profileDir,join('home','profiles','other'))
 assert.equal(parseArgs(['uninstall','--profile-dir','specific'],env).profileDir,'specific')
 assert.throws(()=>parseArgs(['install','--profile','../oops'],env),/profile name/)
 assert.throws(()=>parseArgs(['install','--unknown'],env),/argument/)
})

test('invalid profile structures are rejected before backups or dependency mutations', async t => {
 for (const bad of [null, [], {dsh:'invalid'}, {dsh:{profile:[]}}, {dsh:{profile:{bundles:[123]}}}]) {
  const f=fixture(t)
  const text=JSON.stringify(bad)
  writeFileSync(f.file,text)
  const before=readdirSync(f.dir)
  await assert.rejects(manageProfile({action:'install',profileDir:f.dir},()=>assert.fail()), /object|array/)
  assert.equal(readFileSync(f.file,'utf8'),text)
  assert.deepEqual(readdirSync(f.dir),before)
 }
})

test('exclusive installer lock rejects a second operation and is released after settlement', async t => {
 const f=fixture(t)
 await manageProfile({action:'install',profileDir:f.dir},async()=>{
  await assert.rejects(manageProfile({action:'uninstall',profileDir:f.dir},()=>assert.fail()),/installer lock/)
 })
 assert.equal(readdirSync(f.dir).includes('.compact-codex-profile.lock'),false)
 assert.equal(f.read().dsh.profile.bundles.includes(PACKAGE),true)
})
