import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── 论断级证据核验（2026-09-27 加，学自 smartsearch）────────────────

const ev = (title, snippet, url = 'https://example.com/a') => ({ sourceId: 's', title, snippet, url })

test('extractClaims: 按句末标点切分，丢掉过短的片段', async () => {
  const { extractClaims } = await import('../src/verify-claims.ts')
  const got = extractClaims('短标题。这条论断足够长可以独立核验它的依据是否存在。第三段也足够长可以独立核验。')
  assert.equal(got.length, 2, JSON.stringify(got))
  assert.ok(!got.some(c => c.includes('短标题')), '过短的片段要被丢掉  它没有可核验的实质内容')
})

test('extractClaims: 去掉 markdown 列表符（它是排版不是论断）', async () => {
  const { extractClaims } = await import('../src/verify-claims.ts')
  const got = extractClaims('- 这条论断前面有列表符它应该被剥掉再核验')
  assert.equal(got.length, 1)
  assert.ok(!got[0].startsWith('-'), '列表符要剥掉: ' + got[0])
})

test('supported: 论断的实词大部分出现在证据里', async () => {
  const { verifyClaims } = await import('../src/verify-claims.ts')
  const r = verifyClaims('Rust 的所有权规则要求每个值有唯一主人', [
    ev('Rust 所有权规则', '所有权规则要求每个值有唯一主人，离开作用域时自动释放')
  ])
  assert.equal(r.checks.length, 1)
  assert.equal(r.checks[0].verdict, 'supported')
  assert.equal(r.supported, 1)
  assert.ok(r.checks[0].supports.length > 0, '要报出它依据了哪条证据')
})

test('unsupported: 无据不等于假  只报「找不到依据」', async () => {
  /**
   * 论断级证据核验  「这句话有没有被 fetch 到的原文支持」
   * .agents/notes/implemented/architecture/2026-09-27-claim-verification.md
   */
  const { verifyClaims, renderClaimReport } = await import('../src/verify-claims.ts')
  const r = verifyClaims('量子纠缠可以用于超光速通信', [ev('Rust 所有权规则', '每个值有唯一主人')])
  assert.equal(r.checks[0].verdict, 'unsupported')
  assert.equal(r.unsupported, 1)
  assert.deepEqual(r.checks[0].supports, [], '无据时不报依据')
  assert.match(renderClaimReport(r), /无据.*不等于.*假/)
})

test('partial: 中间态必须存在  硬二分会制造假精确', async () => {
  const { verifyClaims } = await import('../src/verify-claims.ts')
  const r = verifyClaims('量子纠缠可以用于超光速通信这件事其实没有依据。', [ev('量子纠缠实验', '量子纠缠在实验中用于密钥分发与贝尔不等式检验')])
  const c = r.checks[0]
  assert.ok(c.coverage > 0 && c.coverage < 0.5, '构造出的覆盖率应在 (0, 0.5): ' + c.coverage)
  assert.equal(c.verdict, 'partial')
})

test('coverage 与 matched 必须报出来  否则结论不可复核', async () => {
  const { verifyClaims } = await import('../src/verify-claims.ts')
  const r = verifyClaims('所有权规则要求每个值有唯一主人', [ev('所有权', '每个值有唯一主人')])
  const c = r.checks[0]
  assert.ok(typeof c.coverage === 'number' && c.coverage >= 0 && c.coverage <= 1)
  assert.ok(c.terms > 0, '要报出参与比对的实词数')
  assert.ok(c.matched.length > 0, '要报出命中了哪些词')
})

test('renderClaimReport: 全都有据时返回空串（不打扰）', async () => {
  const { verifyClaims, renderClaimReport } = await import('../src/verify-claims.ts')
  const r = verifyClaims('所有权规则要求每个值有唯一主人', [ev('所有权规则', '每个值有唯一主人')])
  assert.equal(renderClaimReport(r), '')
})

test('空答案与空证据都不崩', async () => {
  const { verifyClaims } = await import('../src/verify-claims.ts')
  assert.equal(verifyClaims('', []).checks.length, 0)
  const r = verifyClaims('这条论断没有任何证据可以依据它', [])
  assert.equal(r.unsupported, 1)
})

test('单字不成词  停用字不该制造虚假命中', async () => {
  const { verifyClaims } = await import('../src/verify-claims.ts')
  const r = verifyClaims('这是一个在其中的论断内容足够长', [ev('无关标题', '的一是在有和了')])
  assert.notEqual(r.checks[0].verdict, 'supported', '停用字不该让论断蒙混过关')
})
