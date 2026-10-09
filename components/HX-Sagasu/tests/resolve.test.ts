import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeThread } from '../src/thread.ts'
import { resolve, digest, relevantFloors } from '../src/resolve.ts'
import type { RawThreadInput } from '../src/types.ts'

/** 一个典型的论坛场景: 楼主发问 → 有人反驳 → 楼主改口 → 有人引用楼主第一楼 */
const scenario: RawThreadInput = {
  id: 's1',
  platform: 'heybox',
  title: '小黑盒评分是不是暗改了',
  createdAt: 1_700_000_000_000,
  opAuthorId: 'u1',
  provenance: { kind: 'browser', session: 'anonymous', url: 'https://example.invalid/s1' },
  turns: [
    { id: 'f1', author: { id: 'u1', name: '橘子' }, text: '小黑盒的评分机制我觉得是暗改了，明显偏向新游戏', timestamp: 100 },
    { id: 'f2', author: { id: 'u2', name: '路人甲' }, text: '没有吧，我看评分公式没变，只是权重调了', timestamp: 200 },
    { id: 'f3', author: { id: 'u1', name: '橘子' }, text: '那我可能记错了，确实是权重的问题', timestamp: 300 },
    { id: 'f4', author: { id: 'u3', name: '路人乙' }, text: '小黑盒的评分机制我觉得是暗改了，明显偏向新游戏', timestamp: 400, quotedTurnId: 'f1' },
  ],
}

const { thread } = normalizeThread(scenario)

test('「楼主」解析到 OP，并取回其全部发言（按楼层顺序）', () => {
  const r = resolve(thread, '楼主后来改口了吗')
  const op = r.targets.find(t => t.role === 'op')!
  assert.equal(op.participantId, 'u1')
  assert.deepEqual(op.turns.map(t => t.id), ['f1', 'f3'])
})

test('引用产出的是**原文**与**楼层号**  能回答"哪一楼"', () => {
  const r = resolve(thread, '楼主后来改口了吗')
  const cites = digest(thread, r)[0]!.citations
  assert.equal(cites[0]!.floor, 1)
  assert.equal(cites[0]!.quote, '小黑盒的评分机制我觉得是暗改了，明显偏向新游戏')
  assert.equal(cites[1]!.floor, 3)
  // 引用必须是原文: 若 OP 文本含错字, 引用里必须保留错字
  assert.equal(cites[1]!.quote.includes('那我可能记错了'), true)
})

test('「楼上」在没有游标时**不给答案**，而是报歧义  不许猜', () => {
  const r = resolve(thread, '楼上说的是真的吗')
  assert.equal(r.targets.filter(t => t.role === 'reply').length, 0)
  assert.equal(r.ambiguous.length, 1)
  assert.ok(r.ambiguous[0]!.reason.includes('cursorTurnId'))
})

test('「楼上」在有游标时解析到上一楼作者', () => {
  const r = resolve(thread, '楼上说的那个权重问题', 'f3')
  const reply = r.targets.find(t => t.role === 'reply')!
  assert.equal(reply.participantId, 'u2')   // f3 的上一楼是 f2（路人甲）
  assert.ok(reply.confidence >= 0.9)
})

test('第三人称按**引用入度**解析，不按出现顺序', () => {
  const r = resolve(thread, '他说的对吗')
  const third = r.targets.find(t => t.role === 'third-person')!
  // f1 被 f4 引用过; u3 自己也发过 f4 但没人引用他
  assert.equal(third.participantId, 'u1')
  assert.ok(third.reason.includes('引用入度'))
})

test('端到端场景: 「楼主后来改口了吗」能回到具体楼层原文', () => {
  // 这是架构方案 §5.2 立的验收判据 #1 的可执行版本
  const r = resolve(thread, '楼主后来改口了吗')
  const cites = digest(thread, r)[0]!.citations
  assert.equal(cites.length, 2, 'OP 发言有两楼')
  assert.equal(cites[0]!.floor, 1)
  assert.equal(cites[1]!.floor, 3)
  // 判据要的是"回答改口了吗"的原材料: 前后两楼原文都在，且顺序正确
  assert.ok(cites[0]!.quote.includes('暗改'))
  assert.ok(cites[1]!.quote.includes('记错'))
})

test('无 OP 标记时回退首楼作者并降置信度', () => {
  const noOp = normalizeThread({ ...scenario, opAuthorId: undefined }).thread
  const r = resolve(noOp, '楼主怎么看')
  const op = r.targets.find(t => t.role === 'op')!
  assert.equal(op.participantId, 'u1')
  assert.equal(op.confidence, 0.6)
  assert.ok(op.reason.includes('回退'))
})

// ── 证据楼层: 核心场景的端到端判据（§5.2 验收判据 1）──────────────

test('「楼主后来改口了吗」必须返回**具体楼层**，不许返回空', () => {
  // 这是本项目第 (3) 项需求点名的判据。实测它此前**整个失败**（2026-09-16）:
  //   resolve(thread, '楼主后来改口了吗') → topic = "改口了"
  //   → 没有一楼含"改口了" → relevantFloors 返回 **0 条**
  // 原因不是解析错了（楼主被正确解析到 1、3 楼），而是**用话题做了硬过滤**。
  const r = resolve(thread, '楼主后来改口了吗')
  const floors = relevantFloors(thread, r)
  assert.ok(floors.length > 0, '改口类问题的证据楼层不能为空  这正是本模块存在的理由')
  // 场景里 OP 的显示名是「橘子」（u1） 断角色要看 id，不是看名字里有没有"楼主"
  assert.ok(floors.some(c => c.turnId === 'f1' || c.turnId === 'f3'), '至少包含 OP 的发言楼层')
  assert.ok(floors.every(c => typeof c.quote === 'string' && c.quote.length > 0), '每条证据都要有原文引用')
})

test('话题匹配是**重排**不是过滤  不含话题词的楼层也必须保留', () => {
  // 用过滤表达相关性的病: 答案往往恰恰不含问题里的字面词。
  // 楼主改口后说的是「编译期约束」而不是「改口」。
  const r = resolve(thread, '楼主后来改口了吗')
  const all = digest(thread, r).flatMap(d => d.citations)
  const floors = relevantFloors(thread, r)
  assert.equal(floors.length, all.length, '重排不改变集合大小  一次错误的话题提取不该丢掉证据')
  // 排序是稳定的: 楼层顺序表达「随时间的变化」，不能被相关度打乱到无法阅读
  const ids = floors.map(c => c.turnId)
  const sorted = [...all].map(c => c.turnId)
  assert.deepEqual([...ids].sort(), [...sorted].sort(), '集合相同')
})

test('提取的话题词是提问动作时，也不影响证据返回（实测「改口了」这个反例）', () => {
  const r = resolve(thread, '楼主后来改口了吗')
  assert.equal(r.topic, '改口了', '记录实测结果: 话题提取确实把提问动作当成了话题')
  assert.ok(relevantFloors(thread, r).length > 0, '而它**不该**因此丢掉证据  这是本测试锁住的契约')
})

// ── 对话语义入口（2026-09-18 加）──────────────────────────────────
//
// CLI 的 `thread` 子命令是这条链唯一的真实入口。以下测试锁住它依赖的两个契约，
// 因为**字段名凭印象写错过一次**（第一版把 `id` 写成 `floor`、把 `author.name`
// 当成 `author`、把 `res.targets[].turns` 当成 `relevantFloors`）。

test('resolve 的引用链在 targets[].turns 里  不是 relevantFloors', async () => {
  const { normalizeThread } = await import('../src/thread.ts')
  const { resolve, relevantFloors } = await import('../src/resolve.ts')
  const raw = {
    platform: 'test', ref: 'x',
    turns: [
      { id: 't1', author: { id: 'u1', name: '楼主' }, text: '我一开始觉得这样对', timestamp: 1 },
      { id: 't2', author: { id: 'u2', name: '路人' }, text: '改口这个词真好用', timestamp: 2 },
      { id: 't3', author: { id: 'u1', name: '楼主' }, text: '后来我改主意了', parentId: 't1', timestamp: 3 },
    ],
  }
  const { thread } = normalizeThread(raw as never)
  const res = resolve(thread, '楼主后来改口了吗')
  // 指代目标是**楼主的发言**（t1/t3），不该是含"改口"字面的路人 t2
  assert.ok(res.targets.length > 0, '应解析出指代目标')
  const ids = res.targets.flatMap(t => t.turns.map(x => x.id))
  assert.ok(ids.includes('t1') && ids.includes('t3'), '楼主两条发言都该在引用链里，实际: ' + JSON.stringify(ids))
  assert.ok(!ids.includes('t2'), '路人的话不是指代目标')
  // relevantFloors 是**另一个判据**（字面话题重叠），不是指代链  混淆过就会引用错的楼层
  const cites = relevantFloors(thread, res)
  assert.ok(Array.isArray(cites), '它存在但语义不同')
})

test('Turn 的字段名是 id / author.name / normalizedText（实测核对过）', async () => {
  const { normalizeThread } = await import('../src/thread.ts')
  const raw = {
    platform: 'test', ref: 'x',
    turns: [{ id: 'r123', author: { id: 'u1', name: '某人' }, text: '内容', timestamp: 1 }],
  }
  const { thread } = normalizeThread(raw as never)
  const t = thread.turns[0]!
  assert.equal(typeof t.id, 'string', '不是 floor')
  assert.equal(typeof (t.author as { name?: string }).name, 'string', 'author 是对象不是字符串')
  assert.equal(typeof t.normalizedText, 'string')
})

// ── 多轮上下文：阅读游标（2026-09-18 接线）────────────────────────
//
// `cursorTurnId` 此前**零外部调用方**（只有测试用过），于是「楼上」永远解析不出来。
// 现在 CLI 的 `--at <楼层号>` 提供了它。

test('有游标时「楼上」解析到游标上一楼  这是多轮上下文的最小形态', async () => {
  const { normalizeThread } = await import('../src/thread.ts')
  const { resolve } = await import('../src/resolve.ts')
  const raw = {
    platform: 'test', ref: 'x',
    turns: [
      { id: 't1', author: { id: 'u1', name: '甲' }, text: '第一楼', timestamp: 1 },
      { id: 't2', author: { id: 'u2', name: '乙' }, text: '第二楼', timestamp: 2 },
      { id: 't3', author: { id: 'u3', name: '丙' }, text: '第三楼', timestamp: 3 },
    ],
  }
  const { thread } = normalizeThread(raw as never)
  const r = resolve(thread, '楼上说得对吗', 't3')
  assert.equal(r.ambiguous.length, 0, '有游标就不该报歧义')
  assert.equal(r.targets.length, 1)
  assert.equal(r.targets[0]!.role, 'reply')
  assert.equal(r.targets[0]!.participantName, '乙', '游标在 t3，楼上应是 t2 的作者')
  assert.ok(r.targets[0]!.confidence >= 0.8)
})

test('无游标时「楼上」必须报歧义并给候选  不许猜', async () => {
  // resolve 的注释写着"给出候选让人来定，不替人定"。这是刻意的设计:
  // "楼上"在没有阅读位置时**语义上就是不确定的**，猜一个等于编造。
  const { normalizeThread } = await import('../src/thread.ts')
  const { resolve } = await import('../src/resolve.ts')
  const raw = {
    platform: 'test', ref: 'x',
    turns: [
      { id: 't1', author: { id: 'u1', name: '甲' }, text: '第一楼', timestamp: 1 },
      { id: 't2', author: { id: 'u2', name: '乙' }, text: '第二楼', timestamp: 2 },
    ],
  }
  const { thread } = normalizeThread(raw as never)
  const r = resolve(thread, '楼上说得对吗')
  assert.equal(r.targets.length, 0, '不许猜出目标')
  assert.equal(r.ambiguous.length, 1, '但要报出来')
  assert.ok(r.ambiguous[0]!.candidates.length > 0, '并给候选')
  assert.match(r.ambiguous[0]!.reason, /游标|cursorTurnId/)
})

test('游标在第 1 楼时没有「上一楼」 不报错也不编造', async () => {
  const { normalizeThread } = await import('../src/thread.ts')
  const { resolve } = await import('../src/resolve.ts')
  const raw = {
    platform: 'test', ref: 'x',
    turns: [{ id: 't1', author: { id: 'u1', name: '甲' }, text: '第一楼', timestamp: 1 }],
  }
  const { thread } = normalizeThread(raw as never)
  const r = resolve(thread, '楼上说得对吗', 't1')
  assert.equal(r.targets.length, 0, '首楼没有楼上')
})
