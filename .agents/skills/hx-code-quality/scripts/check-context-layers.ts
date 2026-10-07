import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.venv', 'venv', '__pycache__', 'vendor', 'target', 'coverage', '.next', '.nuxt', '.output'])
const ENTRY_NAMES = ['AGENTS.md', 'CLAUDE.md']
const MARKERS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json']
const SOURCE_SUFFIXES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.vue', '.svelte', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift', '.lua', '.sh', '.sql', '.dart', '.scala'])
const DOC_SUFFIXES = new Set(['.md', '.mdx'])
const DEFAULT_BUDGET = 3000
const DEFAULT_MIN_WEIGHT = 15

type Entry = { name: string; bytes: number }
type DirInfo = { rel: string; entries: Entry[]; weight: number; marker: boolean }
type Options = { root: string; budget: number; minWeight: number; excludes: string[]; baseline?: string; list: boolean }

function suffix(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

function counts(name: string): boolean {
  const ext = suffix(name)
  return SOURCE_SUFFIXES.has(ext) || DOC_SUFFIXES.has(ext)
}

/** Weight is recursive: a directory is judged by every source and doc file beneath it. */
function scan(dir: string, root: string, acc: DirInfo[], excludes: string[]): number {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  let weight = 0
  let marker = false
  const entries: Entry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    let stat
    try {
      stat = lstatSync(full)
    } catch {
      continue
    }
    // Symlinks are skipped: a link to an ancestor turns one directory into an unbounded
    // tree, and the counts below decide whether a directory owes an entry document.
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      const rel = relative(root, full)
      if (isExcluded(rel, excludes)) continue
      weight += scan(full, root, acc, excludes)
      continue
    }
    if (ENTRY_NAMES.includes(name)) {
      entries.push({ name, bytes: Buffer.byteLength(readFileSync(full, 'utf8')) })
      continue
    }
    if (MARKERS.includes(name)) marker = true
    if (counts(name)) weight += 1
  }
  acc.push({ rel: relative(root, dir), entries, weight, marker })
  return weight
}

function label(rel: string): string {
  return rel === '' ? '<root>' : rel
}

function isExcluded(rel: string, excludes: string[]): boolean {
  return excludes.some((prefix) => rel === prefix || rel.startsWith(prefix + '/'))
}

/** Excluded prefixes are pruned whole: they must not inflate an ancestor's weight. */
function collect(root: string, excludes: string[]): DirInfo[] {
  const acc: DirInfo[] = []
  scan(root, root, acc, excludes)
  return acc
}

function checkBudgets(dirs: DirInfo[], options: Options, problems: string[]): void {
  for (const dir of dirs) {
    if (isExcluded(dir.rel, options.excludes)) continue
    for (const entry of dir.entries) {
      if (entry.bytes > options.budget) {
        problems.push(label(dir.rel) + '/' + entry.name + ': ' + entry.bytes + ' bytes (limit ' + options.budget + ')')
      }
    }
  }
}

function missingEntries(dirs: DirInfo[], options: Options): string[] {
  const rows: string[] = []
  for (const dir of dirs) {
    if (isExcluded(dir.rel, options.excludes)) continue
    if (dir.entries.length) continue
    if (dir.weight < options.minWeight && !dir.marker) continue
    const why = dir.marker ? 'project marker (' + MARKERS.join(' / ') + ')' : dir.weight + ' files (threshold ' + options.minWeight + ')'
    rows.push(label(dir.rel) + ': no entry document, but qualifies -- ' + why)
  }
  return rows
}

/** The baseline is a ratchet: a directory recorded there is tolerated only while it stays missing. */
function checkBaseline(missing: string[], baselinePath: string | undefined, problems: string[]): void {
  if (!baselinePath) {
    for (const row of missing) problems.push(row)
    return
  }
  const exempt = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record<string, string>
  const seen = new Set(missing.map((row) => relOf(row)))
  for (const row of missing) if (!(relOf(row) in exempt)) problems.push(row)
  for (const rel of Object.keys(exempt)) {
    if (!seen.has(rel)) problems.push('baseline entry is no longer missing, remove it: ' + rel)
  }
}

function relOf(row: string): string {
  return row.slice(0, row.indexOf(': '))
}

function listDirs(dirs: DirInfo[], options: Options): void {
  const rows = dirs.filter((dir) => !isExcluded(dir.rel, options.excludes))
  for (const dir of rows.sort((a, b) => b.weight - a.weight)) {
    if (dir.weight < options.minWeight && !dir.marker) continue
    const names = dir.entries.map((entry) => entry.name + ' ' + entry.bytes + 'B').join(' ')
    const mark = dir.entries.length ? 'covered [' + names + ']' : 'MISSING'
    console.log(String(dir.weight).padStart(6) + '  ' + mark.padEnd(30) + label(dir.rel))
  }
}

function fill(dir: string, count: number, name: (i: number) => string): void {
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i += 1) writeFileSync(join(dir, name(i)), 'export const v' + i + ' = ' + i)
}

const rootRules = '# repository rules'

function selfTest(): void {
  const temp = mkdtempSync(join(tmpdir(), 'hx-context-layers-'))
  const cases: Array<[string, (root: string) => void, number, string, (root: string) => string[]]> = [
    ['control', () => {}, 0, '', () => []],
    ['budget-over', (root) => writeFileSync(join(root, 'AGENTS.md'), 'x'.repeat(DEFAULT_BUDGET + 1)), 1, 'bytes (limit', () => []],
    ['root-missing', (root) => fill(join(root, 'src'), 20, (i) => 'm' + i + '.ts'), 1, '<root>: no entry document', () => []],
    ['coverage-missing', (root) => { writeFileSync(join(root, 'AGENTS.md'), rootRules); fill(join(root, 'src'), 20, (i) => 'm' + i + '.ts') }, 1, 'src: no entry document', () => []],
    ['coverage-covered', (root) => { writeFileSync(join(root, 'AGENTS.md'), rootRules); fill(join(root, 'src'), 20, (i) => 'm' + i + '.ts'); writeFileSync(join(root, 'src/AGENTS.md'), 'ok') }, 0, '', () => []],
    ['docs-only-dir', (root) => { writeFileSync(join(root, 'AGENTS.md'), rootRules); fill(join(root, 'docs'), 20, (i) => 'p' + i + '.md') }, 1, 'docs: no entry document', () => []],
    ['nested-marker', (root) => { writeFileSync(join(root, 'AGENTS.md'), rootRules); mkdirSync(join(root, 'docs'), { recursive: true }); writeFileSync(join(root, 'docs/package.json'), '{}') }, 1, 'project marker', () => []],
    ['baseline-ratchet', (root) => { writeFileSync(join(root, 'AGENTS.md'), rootRules); fill(join(root, 'src'), 20, (i) => 'm' + i + '.ts'); writeFileSync(join(root, 'baseline.json'), '{"src": "legacy"}') }, 0, '', (_root) => ['--baseline', join(temp, 'baseline-ratchet', 'baseline.json')]],
    ['baseline-stale', (root) => { writeFileSync(join(root, 'AGENTS.md'), rootRules); writeFileSync(join(root, 'baseline.json'), '{"src": "legacy"}') }, 1, 'no longer missing', (_root) => ['--baseline', join(temp, 'baseline-stale', 'baseline.json')]],
    ['vendor-skipped', (root) => fill(join(root, 'node_modules/pkg'), 50, (i) => 'm' + i + '.ts'), 0, '', () => []],
    ['symlink-cycle-skipped', (root) => { mkdirSync(join(root, 'app'), { recursive: true }); symlinkSync('..', join(root, 'app/loop')) }, 0, '', () => []],
    ['exclude-honored', (root) => fill(join(root, 'ref/lib'), 50, (i) => 'm' + i + '.ts'), 0, '', (_root) => ['--exclude', 'ref']],
  ]
  try {
    for (const [name, change, status, diagnostic, extra] of cases) {
      const root = join(temp, name)
      mkdirSync(root, { recursive: true })
      change(root)
      const result = spawnSync(process.execPath, [script, '--root', root, ...extra(root)], { encoding: 'utf8', timeout: 20000 })
      const output = result.stdout + result.stderr
      if (result.status !== status || !output.includes(diagnostic)) {
        throw new Error(name + ': got exit ' + result.status + ', expected ' + status)
      }
      console.log('PASS ' + name)
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
  console.log('context-layer probes: ' + cases.length + '/' + cases.length + ' passed')
}

function parseArgs(argv: string[]): Options {
  const options: Options = { root: '', budget: DEFAULT_BUDGET, minWeight: DEFAULT_MIN_WEIGHT, excludes: [], list: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root') options.root = resolve(argv[i + 1])
    else if (arg === '--baseline') options.baseline = resolve(argv[i + 1])
    else if (arg === '--budget') options.budget = Number(argv[i + 1])
    else if (arg === '--min-weight') options.minWeight = Number(argv[i + 1])
    else if (arg === '--exclude') options.excludes.push(argv[i + 1])
    else if (arg === '--list') options.list = true
    else throw new Error('unknown argument: ' + arg)
    if (arg !== '--list') i += 1
  }
  return options
}

const argv = process.argv.slice(2)
if (argv.includes('--self-test')) {
  selfTest()
} else {
  const options = parseArgs(argv)
  if (!options.root) {
    console.error('Usage: node check-context-layers.ts --root DIR [--baseline FILE] [--budget BYTES] [--min-weight N] [--exclude PREFIX] [--list]')
    process.exitCode = 2
  } else {
    const dirs = collect(options.root, options.excludes)
    if (options.list) {
      listDirs(dirs, options)
    } else {
      const problems: string[] = []
      checkBudgets(dirs, options, problems)
      checkBaseline(missingEntries(dirs, options), options.baseline, problems)
      for (const problem of problems) console.error('ERROR ' + problem)
      if (problems.length) console.error('[check-context-layers] ' + problems.length + ' violation(s) under ' + options.root)
      else console.log('[check-context-layers] PASS (' + options.root + ')')
      process.exitCode = problems.length ? 1 : 0
    }
  }
}
