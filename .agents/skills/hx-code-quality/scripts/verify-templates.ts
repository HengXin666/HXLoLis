import { captureFailure, saveReport } from './report.ts'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(import.meta.url)
const defaultRoot = resolve(dirname(script), '..')
const hash = (text) => createHash('sha256').update(text).digest('hex')
const sourceNames = ['README.md', 'artifacts.md', 'reference-params.md', 'skeletons.md']
const ids = (text) => [...text.matchAll(/^\|(\d+)\|/gm)].map((match) => Number(match[1]))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Verify the committed source snapshot and its derived templates
 * .agents/notes/implemented/bug-fix/2026-10-10-template-manifest-tracks-committed-snapshot.md
 */
export function verify(root) {
  const errors = []
  const check = (ok, message) => { if (!ok) errors.push(message) }
  const read = (path) => {
    const full = join(root, path)
    if (!existsSync(full)) { errors.push('missing: ' + path); return '' }
    return readFileSync(full, 'utf8')
  }
  let manifest
  try { manifest = JSON.parse(read('assets/source/manifest.json')) }
  catch { return [...errors, 'invalid manifest'] }
  check(manifest.version === 1, 'manifest version must be 1')
  check(manifest.digestScope === 'repository-committed-text', 'manifest digest scope must identify the committed text')
  check(/^[a-f0-9]{40}$/.test(manifest.snapshotCommit ?? ''), 'manifest snapshot commit is missing or invalid')
  check(same(manifest.sources.map((item) => item.path), sourceNames.map((name) => 'assets/source/' + name)), 'four original documents must be registered')
  for (const item of manifest.sources) {
    check(/^[a-f0-9]{64}$/.test(item.suppliedSha256 ?? ''), 'supplied source digest is missing: ' + item.path)
    check(hash(read(item.path)) === item.sha256, 'original content changed: ' + item.path)
  }
  const entry = read('SKILL.md')
  const index = read('templates/index.md')
  check(entry.includes('templates/index.md'), 'SKILL must route to template entry')
  check(entry.includes('assets/source/index.md'), 'SKILL must expose source provenance')
  check(entry.includes('disable-model-invocation: true'), 'manual invocation must remain enabled')
  const local = read('steps/2-local/index.md')
  const remote = read('steps/3-remote/index.md')
  const portrait = read('steps/4-portrait/index.md')
  const originalSkeleton = read('assets/source/skeletons.md')
  const headers = [...originalSkeleton.matchAll(/^## (\d+)\. .*$/gm)]
  check(same(manifest.skeletons.map((item) => item.id), Array.from({ length: 14 }, (_, i) => i + 1)), 'all fourteen skeletons must be mapped')
  for (const item of manifest.skeletons) {
    check(/^[a-f0-9]{64}$/.test(item.suppliedSectionSha256 ?? ''), 'supplied section digest is missing: ' + item.id)
    const text = read(item.path)
    check(index.includes(item.path), 'unreachable skeleton: ' + item.path)
    const i = headers.findIndex((match) => Number(match[1]) === item.id)
    if (i < 0) { errors.push('unknown original section: ' + item.id); continue }
    const original = originalSkeleton.slice(headers[i].index, headers[i + 1]?.index ?? originalSkeleton.length)
    check(hash(original) === item.sourceSectionSha256, 'section mapping changed: ' + item.id)
    if (item.id === 11) {
      check(item.mode === 'delegate' && text.includes('hx-agent-notes'), 'note implementation must be delegated')
    } else {
      const body = text.split('<!-- source-section:start -->\n')[1]?.split('<!-- source-section:end -->')[0]
      check(item.mode === 'preserved' && body === original, 'skeleton source payload lost: ' + item.id)
    }
  }
  const referenceRows = read('assets/source/reference-params.md').split('\n').filter((line) => /^\|\d+\|/.test(line))
  const expected = { backend: [1, 15], frontend: [16, 22], shared: [23, 31] }
  check(manifest.profiles.length === 3, 'three profiles required')
  for (const [name, [first, last]] of Object.entries(expected)) {
    const path = 'templates/profiles/' + name + '.md'
    const text = read(path)
    const range = Array.from({ length: last - first + 1 }, (_, i) => first + i)
    check(same(ids(text), range), 'profile rule coverage: ' + name)
    check(same(manifest.profiles.find((item) => item.path === path)?.ids, range), 'profile manifest mismatch: ' + name)
    for (const row of referenceRows.filter((line) => range.includes(Number(line.split('|')[1])))) check(text.split('\n').includes(row), 'original rule text lost: ' + row.split('|')[1])
    check(index.includes(path) && local.includes(path), 'profile not routed by local step: ' + name)
  }
  for (const path of ['templates/remote/github-docs.md', 'templates/remote/github-actions.md']) {
    read(path)
    check(index.includes(path) && remote.includes(path), 'remote template not routed: ' + path)
  }
  check(portrait.includes('templates/skeletons/14-guide.md'), 'portrait must use original guide skeleton')
  check(index.includes('templates/context-layers.md'), 'context-layer contract must be routed from the template entry')
  read('templates/context-layers.md')
  const contextGate = resolve(root, 'scripts/check-context-layers.ts')
  check(existsSync(contextGate), 'context-layer gate script is missing')
  const probe = spawnSync(process.execPath, [contextGate, '--self-test'], { encoding: 'utf8', timeout: 60000 })
  check(probe.status === 0 && probe.stdout.includes('probes:'), 'context-layer gate self-test did not pass')
  return errors
}

function selfTest() {
  const cases = [
    ['control', () => {}, 0, ''],
    ['missing-frontend-rule', (root) => mutate(root, 'templates/profiles/frontend.md', (text) => text.replace(/^\|16\|.*\n/m, '')), 1, 'profile rule coverage'],
    ['missing-lane-skeleton', (root) => rmSync(join(root, 'templates/skeletons/07-lanes.md')), 1, 'missing:'],
    ['unreachable-skeleton', (root) => mutate(root, 'templates/index.md', (text) => text.replace('templates/skeletons/02-check.md', 'REMOVED')), 1, 'unreachable skeleton'],
    ['source-drift', (root) => mutate(root, 'assets/source/artifacts.md', (text) => text + 'changed'), 1, 'original content changed'],
    ['skeleton-loss', (root) => mutate(root, 'templates/skeletons/01-bus.md', (text) => text.replace('export const GATES', 'export const LOST')), 1, 'skeleton source payload lost'],
    ['missing-note-delegation', (root) => mutate(root, 'templates/skeletons/11-notes.md', (text) => text.replaceAll('hx-agent-notes', 'REMOVED')), 1, 'note implementation must be delegated'],
    ['missing-stage-route', (root) => mutate(root, 'steps/3-remote/index.md', (text) => text.replace('templates/remote/github-actions.md', 'REMOVED')), 1, 'remote template not routed'],
    ['context-contract-unrouted', (root) => mutate(root, 'templates/index.md', (text) => text.replaceAll('templates/context-layers.md', 'REMOVED')), 1, 'context-layer contract must be routed'],
    ['context-gate-missing', (root) => rmSync(join(root, 'scripts/check-context-layers.ts')), 1, 'context-layer gate script is missing'],
  ]
  const temp = mkdtempSync(join(tmpdir(), 'hx-quality-templates-'))
  try {
    for (const [name, change, status, diagnostic] of cases) {
      const root = join(temp, name)
      cpSync(defaultRoot, root, { recursive: true })
      change(root)
      const result = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', timeout: 10000 })
      if (result.status !== status || !(result.stdout + result.stderr).includes(diagnostic)) {
        throw new Error(name + ': unexpected gate result: ' + result.status + '\n' + result.stdout + result.stderr)
      }
      console.log('PASS ' + name)
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
  console.log('template probes: ' + cases.length + '/' + cases.length + ' passed')
}

function mutate(root, path, transform) {
  const file = join(root, path)
  writeFileSync(file, transform(readFileSync(file, 'utf8')))
}

function main(args: string[]): void {
  captureFailure('templates', defaultRoot)
  if (args.length === 1 && args[0] === '--self-test') selfTest()
  else if (!args.length || (args.length === 2 && args[0] === '--root' && args[1])) {
    const root = args.length ? resolve(args[1]) : defaultRoot
    const errors = verify(root)
    saveReport('templates', errors.map((message) => ({ rule: 'template-contract', severity: 'error', message })), root)
    process.exitCode = errors.length ? 1 : 0
  } else { console.error('Usage: verify-templates.ts [--root DIR | --self-test]'); process.exitCode = 2 }
}

if (resolve(process.argv[1] ?? '') === script) main(process.argv.slice(2))
