import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { verify } from '../verify-templates.ts'

const skill = new URL('../../', import.meta.url)

/**
 * Check snapshot provenance and negative cases in an isolated copy
 * .agents/notes/implemented/bug-fix/2026-10-10-template-manifest-tracks-committed-snapshot.md
 */
function fixture(t: any): string {
  const root = mkdtempSync(join(tmpdir(), 'template-manifest-'))
  cpSync(skill, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('the stored source hashes describe bytes and retain the supplied digests', t => {
  const root = fixture(t)
  const manifest = JSON.parse(readFileSync(join(root, 'assets/source/manifest.json'), 'utf8'))
  assert.equal(manifest.snapshotCommit, '81a7eec77cf02e74d8a7e6a5f2f109d15cf73093')
  assert.equal(manifest.digestScope, 'repository-committed-text')
  for (const item of manifest.sources) {
    assert.equal(item.sha256, createHash('sha256').update(readFileSync(join(root, item.path))).digest('hex'))
    assert.match(item.suppliedSha256, /^[a-f0-9]{64}$/)
  }
  assert.deepEqual(verify(root), [])
})

test('removing provenance fields or changing source text fails verification', t => {
  const root = fixture(t)
  const path = join(root, 'assets/source/manifest.json')
  const original = readFileSync(path, 'utf8')
  for (const field of ['snapshotCommit', 'digestScope']) {
    const manifest = JSON.parse(original)
    delete manifest[field]
    writeFileSync(path, JSON.stringify(manifest))
    assert(verify(root).some((message: string) => message.includes(field === 'snapshotCommit' ? 'snapshot commit' : 'digest scope')))
  }
  writeFileSync(path, original)
  const source = join(root, 'assets/source/artifacts.md')
  writeFileSync(source, readFileSync(source, 'utf8') + '\nchanged\n')
  assert(verify(root).some((message: string) => message.includes('original content changed')))
})

test('missing supplied digests and changed skeleton payloads remain failures', t => {
  const root = fixture(t)
  const path = join(root, 'assets/source/manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  delete manifest.sources[0].suppliedSha256
  delete manifest.skeletons[0].suppliedSectionSha256
  writeFileSync(path, JSON.stringify(manifest))
  const source = join(root, 'templates/skeletons/01-bus.md')
  writeFileSync(source, readFileSync(source, 'utf8').replace('export const GATES', 'export const LOST'))
  const issues = verify(root)
  assert(issues.some((message: string) => message.includes('supplied source digest')))
  assert(issues.some((message: string) => message.includes('supplied section digest')))
  assert(issues.some((message: string) => message.includes('skeleton source payload lost')))
})
