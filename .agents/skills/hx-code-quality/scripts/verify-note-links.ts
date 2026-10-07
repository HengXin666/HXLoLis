import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillRel = '.agents/skills/hx-code-quality/SKILL.md'
const noteRels = [
  '.agents/notes/implemented/process/2026-10-02-code-quality-skill-project-specific-landscape.md',
  '.agents/notes/implemented/process/2026-10-06-context-layer-gate-and-ref26-completeness.md',
]
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

function section(text, title) {
  const start = text.indexOf(title)
  if (start < 0) return ''
  const rest = text.slice(start + title.length)
  const end = rest.search(/^## /m)
  return end < 0 ? rest : rest.slice(0, end)
}

function checkLinks(skill, note, noteRel) {
  const errors = []
  if (!section(skill, '## 决策记录交接').includes(noteRel)) errors.push('SKILL.md decision section has no citation for ' + noteRel)
  if (!section(note, '## Decision').includes(skillRel)) errors.push('decision note ' + noteRel + ' has no skill citation in its Decision section')
  return errors
}

if (process.argv.includes('--self-test')) {
  const rel = noteRels[0]
  const cases = [
    ['## 决策记录交接\n' + rel, '## Decision\n' + skillRel, 0],
    ['## 决策记录交接\n', '## Decision\n' + skillRel, 1],
    ['## 决策记录交接\n' + rel, '## Decision\n', 1],
    ['## 决策记录交接\n' + noteRels[1], '## Decision\n' + skillRel, 1],
  ]
  if (cases.some(([skill, note, expected]) => checkLinks(skill, note, rel).length !== expected)) {
    throw new Error('link checks did not detect a missing citation')
  }
  console.log('link probes: ' + cases.length + '/' + cases.length + ' passed')
} else {
  const skill = readFileSync(resolve(root, skillRel), 'utf8')
  const errors = noteRels.flatMap((rel) => checkLinks(skill, readFileSync(resolve(root, rel), 'utf8'), rel))
  if (errors.length) {
    for (const error of errors) console.error(error)
    process.exitCode = 1
  } else {
    console.log('skill/note citations: both directions present for ' + noteRels.length + ' note(s)')
  }
}
