import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, bigrams, overlapCoefficient } from '../src/normalize.ts'

test('同音词被归一，原文保持不动', () => {
  const r = normalize('我们上次那个绘话记录在哪')
  assert.equal(r.normalized, '我们上次那个会话记录在哪')
  assert.equal(r.original, '我们上次那个绘话记录在哪')  // 证据层不许被改写
  assert.ok(r.edits.some(e => e.rule === 'homophone' && e.from === '绘话' && e.to === '会话'))
})

test('自我更正取后半段  后半段才是最终意图', () => {
  const r = normalize('帮我查一下小红书，不对，是查小黑盒的数据')
  assert.equal(r.normalized, '查小黑盒的数据')
  assert.ok(r.edits.some(e => e.rule === 'self-correction'))
})

test('句首口头填充被清掉，句中语义词不动', () => {
  const r = normalize('就是那个那个我们要做的是一个非非常复杂的检所')
  // 只剥句首话语标记；句中 "就是"（A就是B）承载语义，必须留下
  assert.equal(r.normalized, '我们要做的是一个非非常复杂的检索')
  assert.equal(normalize('这个方案就是我们要的').normalized, '这个方案就是我们要的')
})

test('已知边界: 叠字不被折叠  没有词典就分不清"非非"与"人人"', () => {
  // 这条测试**故意锁死当前行为**，而不是锁死理想行为: 曾用一条正则想折叠叠字，
  // 结果把"人人"折成"人"。字符层面两类无法区分，要区分必须有词典。
  assert.equal(normalize('人人都能用的工具').normalized, '人人都能用的工具')
  assert.equal(normalize('这是一个非非常复杂的问题').normalized, '这是一个非非常复杂的问题')
})

test('变体集并列保留原写法  归一可能猜错，用集合兜底', () => {
  const r = normalize('贴把的帖子怎么搜')
  assert.ok(r.variants.includes('贴把的帖子怎么搜'))  // 原文
  assert.ok(r.variants.includes('贴吧的帖子怎么搜'))  // 归一后
  assert.ok(r.variants.length >= 2)
})

test('改动越多置信度越低  低置信度意味着可能是归一器在猜', () => {
  const clean = normalize('这是一个正常的句子')
  const messy = normalize('绘话的带码和函树都要看检所的问题')
  assert.equal(clean.confidence, 1)
  assert.ok(messy.confidence < clean.confidence)
  assert.ok(messy.confidence >= 0.3)
})

test('重叠系数对「短查询 vs 长帖」不惩罚长度  这是不用 Jaccard 的原因', () => {
  const short = bigrams('小黑盒 评分')
  const long = bigrams('小黑盒这个平台的评分机制最近改了吗我很想知道具体的算法细节')
  const overlap = overlapCoefficient(short, long)
  // 4 个 bigram 中命中 3 个（缺 "盒评"  长文里是 "盒这个"）。断言查的是
  // **性质**（长文不该压低指标），不是某个魔数:
  assert.ok(overlap >= 0.7, `重叠系数应保持高位，实际 ${overlap}`)
  // 对照: Jaccard 在这种长度差下会明显偏低
  let hit = 0
  for (const g of short) if (long.has(g)) hit++
  const jaccard = hit / (short.size + long.size - hit)
  assert.ok(jaccard < overlap, 'Jaccard 会因长度差异低估，这正是要避免的')
})

test('消融对比: 归一后检索命中度确实提升（不是觉得更准，是可测量的）', () => {
  // 语料 = 论坛里真实的样子（正确写法）
  const corpus = '小黑盒的评分机制最近改了吗'
  const corpusGrams = bigrams(corpus)
  const typoQuery = '小黑合的评分机制改了吗'      // 语音输入法错字
  const before = overlapCoefficient(bigrams(typoQuery), corpusGrams)
  const after = overlapCoefficient(bigrams(normalize(typoQuery).normalized), corpusGrams)
  assert.ok(after > before, `归一后应更接近语料: before=${before} after=${after}`)
})

test('单个错字不足以判定「不相关」', () => {
  const corpus = bigrams('小黑盒的评分机制最近改了吗')
  const raw = overlapCoefficient(bigrams('小黑合的评分机制改了吗'), corpus)
  assert.ok(raw > 0.5, '即便未归一也应保有足够相关度，不能因为一个错字就判不相关')
})
