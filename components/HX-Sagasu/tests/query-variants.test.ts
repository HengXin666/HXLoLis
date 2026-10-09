import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── 查询变体（2026-09-19 加，实测倒逼）──────────────────────────────

test('glossaryRewriter: 整块命中词表时直接替换', async () => {
  const { glossaryRewriter } = await import('../src/query-variants.ts')
  assert.equal(glossaryRewriter('数据库 索引 优化'), 'database index optimization')
})

test('glossaryRewriter: 按最长匹配切分，切不出的部分原样保留', async () => {
  // 阿司匹林 不在表里 → 应原样保留；相互作用 在表里 → 应被替换
  const { glossaryRewriter } = await import('../src/query-variants.ts')
  const out = glossaryRewriter('阿司匹林 相互作用')
  assert.ok(out !== null, '一半以上的词块命中就该改写成功')
  assert.match(out, /interaction/)
  assert.match(out, /阿司匹林/)
})

test('**改写不出来时返回 null，不猜**', async () => {
  // 这是本模块最重要的安全属性: 宁可不补查询，也不产出一个错误的英文查询。
  const { glossaryRewriter } = await import('../src/query-variants.ts')
  assert.equal(glossaryRewriter('李白 杜甫 唐诗'), null, '词表里没有的词不该被硬凑')
  assert.equal(glossaryRewriter('Du Fu Li Bai'), null, '本来就是英文 → 不需要改写')
})

test('判据: 命中不到一半词块就算失败（避免中英混杂的查询）', async () => {
  // 只换掉一个词、其余全是中文的查询，对英文后端没帮助，却可能干扰中文后端。
  const { glossaryRewriter } = await import('../src/query-variants.ts')
  assert.equal(glossaryRewriter('李白 杜甫 数据库'), null, '三个词块只中一个 → 失败')
  assert.ok(glossaryRewriter('李白 数据库') !== null, '两个词块中一个 → 恰好一半 → 通过')
})

test('queryVariants: 只加不减，且与原文相同不算变体', async () => {
  const { queryVariants } = await import('../src/query-variants.ts')
  const v = queryVariants('Rust 所有权 借用')
  assert.equal(v.length, 1)
  assert.match(v[0], /ownership/)
  assert.match(v[0], /borrow checker/)
  assert.match(v[0], /Rust/, '拉丁词原样保留  Rust 本来就是英文')
  assert.deepEqual(queryVariants('rust ownership'), [], '英文查询没有变体')
})

test('queryVariants: 可注入改写器（供将来接 LLM）', async () => {
  const { queryVariants } = await import('../src/query-variants.ts')
  assert.deepEqual(queryVariants('任意中文', () => 'any english'), ['any english'])
})

test('词表规模: 明确记录它刻意小', async () => {
  const { GLOSSARY_SIZE } = await import('../src/query-variants.ts')
  assert.ok(GLOSSARY_SIZE > 30 && GLOSSARY_SIZE < 200, '规模 ' + GLOSSARY_SIZE + ' 应在刻意小的范围内')
})
