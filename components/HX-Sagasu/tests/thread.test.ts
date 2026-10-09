import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeThread } from '../src/thread.ts'
import type { RawThreadInput } from '../src/types.ts'

const base: RawThreadInput = {
  id: 't1',
  platform: 'heybox',
  title: '评分机制是不是改了',
  board: '游戏讨论',
  createdAt: 1_700_000_000_000,
  opAuthorId: 'u1',
  provenance: { kind: 'browser', session: 'anonymous', url: 'https://example.invalid/t1' },
  turns: [
    { id: 'p1', author: { id: 'u1', name: '楼主' }, text: '小黑盒的评分机制最近改了吗', timestamp: 100 },
    { id: 'p2', author: { id: 'u2', name: '路人甲' }, text: '我看是没改，只是权重调了', timestamp: 200 },
    { id: 'p3', author: { id: 'u3', name: '路人乙' }, text: '绘话记录在哪里看', timestamp: 300 },
  ],
}

test('按时间排序，OP 被标记，原文与归一文本并存', () => {
  const { thread } = normalizeThread(base)
  assert.deepEqual(thread.turns.map(t => t.id), ['p1', 'p2', 'p3'])
  assert.equal(thread.participants.find(p => p.id === 'u1')?.isOp, true)
  const p3 = thread.turns[2]!
  assert.equal(p3.text, '绘话记录在哪里看')      // 原文保真
  assert.equal(p3.normalizedText, '会话记录在哪里看') // 仅检索用
})

test('平台未提供引用链时，只在重叠足够高时推断，且标记 inferred', () => {
  const input: RawThreadInput = {
    ...base,
    turns: [
      { id: 'a', author: { id: 'u1', name: '楼主' }, text: '小黑盒的评分机制最近改了吗我很在意', timestamp: 100 },
      { id: 'b', author: { id: 'u2', name: '路人' }, text: '完全无关的一句话哈哈哈哈哈', timestamp: 200 },
      { id: 'c', author: { id: 'u3', name: '引用者' }, text: '小黑盒的评分机制最近改了吗', timestamp: 300 },
    ],
  }
  const { thread } = normalizeThread(input)
  const c = thread.turns.find(t => t.id === 'c')!
  assert.equal(c.quotedTurnId, 'a')
  assert.equal(c.quoteInferred, true, '推断出来的必须标 inferred，不许冒充事实')
  const b = thread.turns.find(t => t.id === 'b')!
  assert.equal(b.quotedTurnId, undefined, '重叠不足时必须放弃推断')
})

test('平台提供的引用链是事实，不标 inferred', () => {
  const input: RawThreadInput = {
    ...base,
    turns: [
      { id: 'a', author: { id: 'u1', name: '楼主' }, text: '第一楼', timestamp: 100 },
      { id: 'b', author: { id: 'u2', name: '路人' }, text: '第二楼', timestamp: 200, quotedTurnId: 'a' },
    ],
  }
  const { thread } = normalizeThread(input)
  const b = thread.turns.find(t => t.id === 'b')!
  assert.equal(b.quotedTurnId, 'a')
  assert.notEqual(b.quoteInferred, true)
})

test('provenance 随线程保留  合规审计要能回答「这条内容怎么来的」', () => {
  const { thread } = normalizeThread(base)
  assert.equal(thread.provenance.kind, 'browser')
})

test('广播型语料不做引用推断  实测它只会产出噪声', () => {
  // 依据: Telegram 公开频道 20 楼语料上, 每楼与历史楼的最大重叠中位数 0.708,
  // 95% 超过阈值 0.45; 而真正的引用只会有一对高。广播流的"同一性"来自话题重合,
  // 不是引用关系, 任何单一阈值都分不开这两种信号。
  const channel: RawThreadInput = {
    id: 'durov',
    platform: 'telegram',
    createdAt: 1,
    provenance: { kind: 'browser', session: 'anonymous', url: 'https://t.me/s/durov' },
    turns: Array.from({ length: 6 }, (_, i) => ({
      id: `durov/${500 + i}`,
      author: { id: 'durov', name: 'durov' },
      text: 'The UK government wants to ban social media for children, and this is a very important topic',
      timestamp: 1_780_000_000_000 + i * 86_400_000,
    })),
  }
  const { thread } = normalizeThread(channel)
  assert.equal(thread.turns.length, 6)
  assert.equal(thread.turns.filter(t => t.quoteInferred === true).length, 0,
    '单作者的频道帖流不许推断出引用链')
  // 显式关掉推断时同样为零, 且平台给的引用不受影响
  const explicit = normalizeThread({ ...channel, turns: channel.turns.map((t, i) => i === 1 ? { ...t, quotedTurnId: 'durov/500' } : t) }).thread
  assert.equal(explicit.turns[1]!.quotedTurnId, 'durov/500')
  assert.equal(explicit.turns[1]!.quoteInferred, undefined, '平台给的是事实')
})

test('论坛语料（多参与者）仍然做推断  广播规则不误伤', () => {
  const forum: RawThreadInput = {
    id: 'f', platform: 'heybox', createdAt: 1,
    provenance: { kind: 'api', endpoint: 'x' },
    turns: [
      { id: 'a', author: { id: 'u1', name: '甲' }, text: '这个更新把武器数值改坏了' },
      { id: 'b', author: { id: 'u2', name: '乙' }, text: '我觉得还行吧' },
      { id: 'c', author: { id: 'u3', name: '丙' }, text: '这个更新把武器数值改坏了' },
      { id: 'd', author: { id: 'u4', name: '丁' }, text: '同感' },
      { id: 'e', author: { id: 'u5', name: '戊' }, text: '再看一版' },
      { id: 'f', author: { id: 'u6', name: '己' }, text: '等后续' },
    ],
  }
  const { thread } = normalizeThread(forum)
  assert.equal(thread.turns[2]!.quoteInferred, true, '六人论坛里逐字重复仍然应当被连上')
  assert.equal(thread.turns[2]!.quotedTurnId, 'a')
})

// ── 回复树（2026-09-18 加）────────────────────────────────────────
//
// 实测依据: B站 BV1GJ411x7h7 的 11 楼里 **8 条有 parentId + quotedTurnId，
// 且 quoteInferred 全为 0**  平台直接给了事实，没有一条是猜的。
// 而此前**没有任何地方呈现这棵树**（CLI 与界面都按楼层平铺）。

test('回复树: 父子关系被正确重建', async () => {
  const { buildReplyTree } = await import('../src/reply-tree.ts')
  const tree = buildReplyTree([
    { id: 'a', text: '根' },
    { id: 'b', parentId: 'a', text: '回 a' },
    { id: 'c', parentId: 'a', text: '也回 a' },
    { id: 'd', parentId: 'b', text: '回 b' },
  ])
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.maxDepth, 2)
  assert.deepEqual(tree.roots[0]!.children.map(n => n.id), ['b', 'c'])
  assert.deepEqual(tree.roots[0]!.children[0]!.children.map(n => n.id), ['d'])
})

test('孤儿楼层挂到根  不许因为父不存在就消失', async () => {
  // 父可能被删、被截断、或被平台给错。**"这条回复存在"是事实**，
  // 丢掉会让帖子结构看起来比实际少了一层。
  const { buildReplyTree } = await import('../src/reply-tree.ts')
  const tree = buildReplyTree([
    { id: 'a', text: '根' },
    { id: 'x', parentId: '不存在', text: '孤儿' },
  ])
  assert.equal(tree.flat.length, 2, '两个节点都在')
  assert.equal(tree.roots.length, 2, '孤儿挂到根')
})

test('引用与父级分开保存  它们不是同一件事', async () => {
  // 实测 #10 的父亲是 #7，而它**引用**的是 #9。
  // 只看父子会以为它在回 #7；只说引用会丢掉树形。
  const { buildReplyTree, renderTree } = await import('../src/reply-tree.ts')
  const tree = buildReplyTree([
    { id: 'a', text: '根' },
    { id: 'b', parentId: 'a', text: '二楼' },
    { id: 'c', parentId: 'a', quotedTurnId: 'b', text: '三楼引二楼' },
  ])
  const c = tree.flat.find(n => n.id === 'c')!
  assert.equal(c.parentId, 'a')
  assert.equal(c.quotedTurnId, 'b')
  const lines = renderTree(tree)
  assert.ok(lines.some(l => l.includes('引用 #2')), '引用要显示成楼层号: ' + lines.join(' | '))
})

test('推断的引用必须标出来  不假装是事实', async () => {
  const { buildReplyTree, renderTree } = await import('../src/reply-tree.ts')
  const tree = buildReplyTree([{ id: 'a', text: 'x' }, { id: 'b', parentId: 'a', quotedTurnId: 'a', quoteInferred: true, text: 'y' }])
  const lines = renderTree(tree)
  assert.ok(lines.some(l => l.includes('推断')), '推断的引用要可识别: ' + lines.join(' | '))
})

test('深帖不递归爆栈  迭代算深度', async () => {
  const { buildReplyTree } = await import('../src/reply-tree.ts')
  const turns = [{ id: 't0', text: 'r' }]
  for (let i = 1; i < 2000; i++) turns.push({ id: 't' + i, parentId: 't' + (i - 1), text: 'x' })
  const tree = buildReplyTree(turns as never)
  assert.equal(tree.maxDepth, 1999, '2000 层链不崩')
})
