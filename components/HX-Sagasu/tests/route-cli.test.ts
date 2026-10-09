import { test } from 'node:test'
import assert from 'node:assert/strict'

// ── `route` 子命令（2026-09-27 加，学自 smartsearch）────────────────
//
// **它只解释决策，不发起任何网络请求。** 与 `--explain` 的分工:
//   - `--explain` 要真跑一次召回（有网络成本），画时间线
//   - `route` 零网络成本，只回答「会查哪些、跳过哪些、为什么」

test('route: 输出的字段能完整解释一次路由决策', async () => {
  /**
   * `route` 子命令  把「路由决策的解释」做成零成本的一等命令
   * .agents/notes/implemented/architecture/2026-09-27-route-command.md
   */
  const { routeSources, classifyTopic } = await import('../src/route-sources.ts')
  const { classifyQueryIntent } = await import('../src/recall.ts')
  const { queryVariants } = await import('../src/query-variants.ts')
  const q = 'GPT 文生图 提示词'
  const d = routeSources(q)
  // 四项判据都要能拿到  少任何一项，读者就得靠猜
  assert.deepEqual([...classifyTopic(q)], ['genai'], '话题族')
  assert.equal(classifyQueryIntent(q), 'general', '查询意图')
  assert.deepEqual(queryVariants(q), [], '变体')
  assert.ok(d.keep.length > 0 && d.skip.size > 0, 'keep/skip 都要非空才算做了决策')
})

test('route: 跳过必须**每个都有理由**  这是它的核心价值', async () => {
  const { routeSources } = await import('../src/route-sources.ts')
  const d = routeSources('阿司匹林 相互作用')
  for (const [id, why] of d.skip) {
    assert.ok(typeof why === 'string' && why.length > 0, id + ' 的跳过理由为空')
  }
})

test('route: 空查询不崩（它不跑网络，但也不该抛）', async () => {
  const { routeSources } = await import('../src/route-sources.ts')
  const d = routeSources('')
  assert.ok(Array.isArray(d.keep), '空查询也要给出结构完整的决策')
})

test('route 与 recall 用的是**同一个** routeSources  不是两套判据', async () => {
  // **这是本测试锁住的真契约**: 如果 `route` 自己算一套判据，
  // 它就会与实际检索脱节，而**那正是它最坏的失效形态**（看起来能解释，实则无关）。
  const mod = await import('../src/route-sources.ts')
  assert.equal(typeof mod.routeSources, 'function')
  const cli = await import('node:fs').then(fs => fs.readFileSync('scripts/sagasu.ts', 'utf8'))
  assert.match(cli, /import \{ routeSources, classifyTopic \} from '\.\.\/src\/route-sources\.ts'/)
  assert.match(cli, /const decision = routeSources\(q\)/, 'cmdRoute 必须调用同一个函数')
})
