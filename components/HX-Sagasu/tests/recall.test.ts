import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recall, SOURCES, TIER_LABEL, detectScript, languageFitSignal, sourceDiversitySignal,
  classifyQueryIntent, topicFitSignal, substanceOfHit, queryCoverageSignal,
  queryTerms, queryTermMatches, isQueryRelevant, dedupeWithinSource, normalizeTitle,
  type SourceFetcher, type SourceHit,
} from '../src/recall.ts'
import { AdapterError } from '../src/adapters/adapter.ts'

// 标题必须**有信息量**（不能只复述查询），否则会被 evidence-substance 判据正确否掉 
// 这正是该判据的用途: 分辨"这条结果除了复述我的查询，还给了什么"。
const hit = (sourceId: string, n: number): SourceHit => ({
  sourceId,
  title: `${sourceId} 索引 排序 算法 讨论 第 ${n} 期`,
  url: `https://example.invalid/${sourceId}/${n}`,
})

/** 造一个按来源返回固定条数或抛错的取数函数。 */
function fetcher(spec: { hits?: number; fail?: AdapterError }): SourceFetcher {
  return async (source) => {
    if (spec.fail !== undefined) throw spec.fail
    return Array.from({ length: spec.hits ?? 0 }, (_, i) => hit(source.id, i))
  }
}

const ctx = { query: 'x', minHits: 3, perSourceLimit: 10, minSources: 1 }
const ctxMulti = { ...ctx, minSources: 2 }

test('每个来源都必须写明它为什么属于这一层  可被反驳的判断，不是"它是大站"', () => {
  for (const s of SOURCES) {
    assert.ok(s.rationale.length > 10, `${s.id} 缺少层级归属理由`)
    assert.ok([0, 1, 2].includes(s.tier))
  }
  assert.equal(TIER_LABEL[0], '权威公域')
  assert.equal(TIER_LABEL[2], '通用搜索引擎')
})

test('第 0 层的权威性依据是**持久标识符与机构责任**，不是搜索排名', () => {
  const t0 = SOURCES.filter(s => s.tier === 0)
  assert.ok(t0.length >= 5, '权威层必须有足够供给，否则"权威优先"只是口号')
  // 每个第 0 层来源的理由里必须出现可验证的身份/责任概念
  const identityWords = ['DOI', 'PMID', 'arXiv', 'owner', '标识符', '登记机构', '存档', '编辑审核', '唯一', '第一方', '维护', '投票']
  for (const s of t0) {
    assert.ok(identityWords.some(w => s.rationale.includes(w)),
      `${s.id} 的理由没有说明它的身份由什么保证: ${s.rationale}`)
  }
})

test('第 0 层够用 → 不下降到第 1、2 层（这就是"权威优先"）', async () => {
  // 第 0 层要有**两个**来源才能同时满足来源多样性
  const r = await recall('x', {
    'crossref': fetcher({ hits: 5 }),
    'github': fetcher({ hits: 5 }),
    'bilibili': fetcher({ hits: 5 }),
    'argo:anysearch': fetcher({ hits: 9 }),
  }, ctxMulti)
  assert.deepEqual(r.tiers.filter(t => t.ran).map(t => t.tier), [0])
  assert.equal(r.reachedTier, 0)
  assert.ok(r.stoppedBecause.includes('authoritative-first'))
  assert.equal(r.exhausted, false, '因为够了而提前停，不是跑完')
  assert.equal(r.hits[0]!.sourceId, 'crossref', '结果全部来自第 0 层')
  const t1 = r.tiers.find(t => t.tier === 1)!
  assert.equal(t1.ran, false)
  assert.ok((t1.skippedReason ?? '').includes('authoritative-first'), '被跳过的层必须写明为什么没跑')
})

test('第 0 层不够 → 下降到第 1 层；第 0 层的结果仍然排在最前（层级即优先级）', async () => {
  const r = await recall('x', {
    'crossref': fetcher({ hits: 1 }),
    'bilibili': fetcher({ hits: 5 }),
  }, ctxMulti)
  assert.deepEqual(r.tiers.filter(t => t.ran).map(t => t.tier), [0, 1])
  assert.equal(r.reachedTier, 1)
  assert.equal(r.hits[0]!.sourceId, 'crossref', '第 0 层命中必须排在第 1 层之前')
})

test('失效模式 A: 权威层全部报错**不算**供给  必须继续下降，且失败要上报', async () => {
  // 最关键的一条: 若把"全错"当"0 条结果", 系统会安静地降级到搜索引擎,
  // 而用户以为自己在看权威来源。
  const r = await recall('x', {
    'crossref': fetcher({ hits: 4, fail: new AdapterError('web', 'network', 'boom') }),
    'argo:anysearch': fetcher({ hits: 4 }),
  }, ctx)
  const t0 = r.tiers.find(t => t.tier === 0)!
  assert.equal(t0.ran, true)
  assert.equal(t0.hits, 0)
  assert.equal(t0.failures.length, 1, '失败必须出现在 failures 里，不能变成 0 条命中')
  assert.equal(t0.failures[0]!.kind, 'web/network')
  assert.equal(r.hits.length, 4)
  assert.equal(r.hits[0]!.sourceId, 'argo:anysearch', '下降到了兜底层')
})

test('失效模式 A2（最重要）: 降级必须可见  reachedTier 说明"这是兜底，不是权威确认"', async () => {
  const r = await recall('x', {
    'crossref': fetcher({ fail: new AdapterError('web', 'http', '500') }),
    'argo:anysearch': fetcher({ hits: 3 }),
  }, ctx)
  assert.equal(r.reachedTier, 2, '调用方必须能看出实际降到了搜索引擎')
  assert.equal(r.tiers.find(t => t.tier === 0)!.failures.length, 1)
  assert.ok(r.stoppedBecause.includes('已跑完所有登记的层级'))
})

test('失效模式 B: 最终结果必须能回答"实际到达了哪一层、为什么"', async () => {
  const r = await recall('x', { 'bilibili': fetcher({ hits: 4 }) }, ctx)
  // 第 0 层没有注入取数函数 → 必须记下原因，而不是静默跳过
  const t0 = r.tiers.find(t => t.tier === 0)!
  // 第 0 层登记了来源但一个都没给实现 → 必须报「没有接线」，不是「本来就没有来源」。
  // 这两种情况混为一谈会让"忘了接线"看起来像"这一层本来就是空的」。
  assert.ok((t0.skippedReason ?? '').includes('没有取数实现'), t0.skippedReason)
  assert.equal(t0.ran, false, '没有接线不是「跑过」 这一层没发出任何请求')
  assert.ok(t0.failures.every(f => f.kind === 'unwired'))
  assert.equal(r.reachedTier, 1)
  assert.equal(r.tiers.length, 3, '每一层都有记录（含被跳过的）这是"分层可审计"的载体')
  assert.ok(r.stoppedBecause.length > 0)
})

test('失效模式 C: 0 条命中永远不构成"充分"，但下降必须终止', async () => {
  const r = await recall('x', { 'argo:anysearch': fetcher({ hits: 0 }) }, ctx)
  assert.equal(r.hits.length, 0)
  assert.equal(r.exhausted, true, '没有结果时必须一路降到底并明确告知')
  assert.equal(r.stoppedBecause, '已跑完所有登记的层级')
  // 降到底 ≠ 有结果: 调用方必须自己看 hits.length，系统不替它编造"找到了"
})

test('maxTier 限制下降深度，且被限制的层要记原因', async () => {
  const r = await recall('x', { 'crossref': fetcher({ hits: 0 }), 'bilibili': fetcher({ hits: 0 }) }, { ...ctx, maxTier: 1 })
  const t2 = r.tiers.find(t => t.tier === 2)!
  assert.equal(t2.ran, false)
  assert.ok((t2.skippedReason ?? '').includes('maxTier'))
  assert.equal(r.reachedTier, 1)
})

test('层内多来源: 部分失败仍然算这一层提供了供给，但失败仍要上报', async () => {
  const r = await recall('x', {
    'crossref': fetcher({ hits: 1 }),
    'bilibili': fetcher({ hits: 3 }),
    'telegram-public': fetcher({ fail: new AdapterError('telegram', 'blocked', 'x') }),
  }, ctx)
  const t1 = r.tiers.find(t => t.tier === 1)!
  assert.equal(t1.sources.length, 2)
  assert.equal(t1.hits, 3, '成功来源的命中照样算数')
  assert.equal(t1.failures.length, 1)
  assert.equal(r.hits.length, 4)
})

test('不做跨来源分值融合  层内保持来源给出的顺序', async () => {
  const r = await recall('x', {
    'bilibili': async (s) => [
      { sourceId: s.id, title: 'A', url: 'u1', score: 0.1 },
      { sourceId: s.id, title: 'B', url: 'u2', score: 99 },
    ],
  }, ctx)
  assert.deepEqual(r.hits.map(h => h.title), ['A', 'B'], '来源自报分值不可比, 不允许参与重排')
})

test('perSourceLimit 生效，且总命中不被偷偷截断', async () => {
  const r = await recall('x', { 'bilibili': fetcher({ hits: 100 }) }, { ...ctx, perSourceLimit: 4 })
  assert.equal(r.hits.length, 4)
})

// ── 语种匹配: 实测倒逼出来的判据 ──────────────────────────────

test('没有查询原文时不做语种判断  「拿不到查询」不等于「判定为不相关」', async () => {
  const sig = languageFitSignal([{ sourceId: 'crossref', title: 'X', url: 'u' }], undefined)
  assert.equal(sig.ok, true)
  const r = await recall('x', { 'crossref': fetcher({ hits: 5 }), 'github': fetcher({ hits: 5 }) },
    { minHits: 3, perSourceLimit: 5 } as never)
  const lang = r.verdict.signals.find(s => s.name === 'language-fit')!
  assert.equal(lang.ok, true, '缺 query 时语种判据必须放行，不许把"拿不到查询"变成"判定为不相关"')
})

// ── 话题契合度: 「权威的空壳」的正面判据 ──────────────────────

test('查询意图按形态学信号判定', () => {
  assert.equal(classifyQueryIntent('Rust 所有权'), 'code')
  assert.equal(classifyQueryIntent('CSS 作用域'), 'web-platform')
  assert.equal(classifyQueryIntent('RFC 9110 是什么'), 'standards')
  assert.equal(classifyQueryIntent('癌细胞的免疫治疗'), 'biomedical')
  assert.equal(classifyQueryIntent('有什么关于并发编程的综述论文'), 'academic')
  assert.equal(classifyQueryIntent('今天天气怎么样'), 'general', '判不出来就是 general，不许猜')
})

test('话题判据复现真实失效: 代码问题 + 只有学术库答话 = 权威的空壳', () => {
  // 线上真实构成: 「Rust 所有权」意图是 code，答话的是 crossref/pubmed（学术），
  // 而擅长 code 的来源一条内容都没产出。
  const sig = topicFitSignal(
    [
      { sourceId: 'crossref', title: '全民所有自然资源资产所有权委托代理模式探究', url: 'u1' },
      { sourceId: 'pubmed', title: '权利冲突视角下所有权保留的性质探析', url: 'u2' },
    ],
    ['crossref', 'pubmed', 'github'],   // github 跑通了但 0 条产出
    'Rust 所有权',
    1,
  )
  assert.equal(sig.ok, false, '擅长 code 的来源一条都没答上 → 必须判为权威的空壳')
  assert.ok(sig.detail.includes('权威的空壳'))
})

test('话题判据不误伤: 擅长该意图的来源答上了就放行', () => {
  const sig = topicFitSignal(
    [
      { sourceId: 'crossref', title: '无关的学术论文', url: 'u1' },
      { sourceId: 'github', title: 'rust-lang/rust', url: 'u2' },
    ],
    ['crossref', 'github'],
    'Rust 所有权',
    1,
  )
  assert.equal(sig.ok, true, '实测 GitHub 真的返回了 rust-lang/rust，不能因为别处有噪声就说整层是空壳')
})

test('意图为 general 时不做任何话题过滤（false negative 的代价更大）', () => {
  const sig = topicFitSignal([{ sourceId: 'crossref', title: 'x', url: 'u' }], ['crossref'], '今天天气', 1)
  assert.equal(sig.ok, true)
  assert.ok(sig.detail.includes('不做话题过滤'))
})

test('来源没有任何擅长者时不构成反证  不许把"没有证据"当成"证据"', () => {
  const sig = topicFitSignal([], ['crossref'], 'Rust 所有权', 1)
  assert.equal(sig.ok, true)
  assert.ok(sig.detail.includes('不构成反证'))
})

test('层内按话题契合度稳定重排  相关结果不许被学科语料库埋掉', async () => {
  // 依据（线上实测）: 查询「Rust 所有权」时第 0 层**确实**拿到了 github 的
  // rust-lang/rust，但 Crossref 的 3 篇中文法律论文排在前面（crossref 登记在最前）。
  // 于是前 3 条全无关  用户看到的就是「一屏权威来源，没一条答问题」。
  // 修法不是过滤（那会丢掉有用线索），而是把契合的来源排到前面。
  const r = await recall('Rust 所有权', {
    'crossref': async (s) => [{ sourceId: s.id, title: '全民所有自然资源资产所有权委托代理模式探究', url: 'u1' }],
    'github': async (s) => [{ sourceId: s.id, title: 'rust-lang/rust 借用检查器实现', url: 'u2' }],
  }, { ...ctx, query: 'Rust 所有权', minHits: 1, minSources: 2 })
  assert.equal(r.hits[0]!.sourceId, 'github', '契合并精确匹配意图的来源必须排在学科语料库之前')
  assert.equal(r.hits.length, 2, '重排不改采纳  无关结果仍然保留，只是不在最前')
})

test('来源没有任何擅长者时不做话题过滤（避免把"判不出来"变成"判定无关"）', () => {
  const sig = topicFitSignal([{ sourceId: 'unknownsrc', title: 'x', url: 'u' }], ['unknownsrc'], 'Rust 所有权', 1)
  assert.equal(sig.ok, true)
})

test('证据信息量: 只复述查询的条目不算证据', () => {
  const bare: SourceHit = { sourceId: 'crossref', title: '所有权', url: 'u' }
  const rich: SourceHit = { sourceId: 'github', title: 'rust-lang/rust 内存安全实现原理与借用检查器', url: 'u' }
  assert.ok(substanceOfHit(rich, '所有权') > substanceOfHit(bare, '所有权'))
  assert.ok(substanceOfHit(bare, '所有权') < 3)
})

// ── 字面相关性口径: 词表必须与检索侧一致 ─────────────────────

test('匹配口径必须包含 bigram  否则技术词被切碎后一律判为不相关', () => {
  // 实测倒逼: Intl.Segmenter 的 zh-Hans 词典缺技术词，
  // 把「服务端组件原理」切成 服务|端|组|件|原理，「组件」被切碎。
  // 只用词流 → 所有 React 结果都停在 1/3 覆盖，判据一律判否。
  const terms = queryTerms('React 服务端组件原理')
  assert.ok(terms.includes('组件'), '「组件」必须是一个可匹配项')
  assert.ok(terms.includes('react'))
  assert.ok(!terms.includes('组'), '单字不做匹配项  会引入大量噪声')
  assert.ok(!terms.includes('件'))
})

test('bigram 只取含 CJK 的  不许把 latin 单词切碎', () => {
  const terms = queryTerms('webpack')
  assert.deepEqual(terms, ['webpack'], 'latin 词的 bigram 不得进入匹配项')
})

test('排序口径: 排除完全无关（0 覆盖），沾边的进相关组', () => {
  // 排序与充分性的口径**故意不同**  实测倒逼:
  // 若排序也用"≥2 词"，「Rust 所有权」里 GitHub 的 rust-lang/rust（1 词）
  // 会落到"不相关组"，而 Crossref 那篇含"所有权"的中文法律论文（2 词）落到"相关组"
  // → 法律论文排第一。两档分开后，两者同组，组内按来源契合度排 → GitHub 在前。
  assert.equal(isQueryRelevant({ sourceId: 'github', title: 'rust-lang/rust', url: 'u' }, 'Rust 所有权'), true,
    '1 个词也算沾边，进相关组；谁该排前面交给来源契合度')
  assert.equal(isQueryRelevant({ sourceId: 'npm', title: '@formatjs/icu-messageformat-parser', url: 'u' }, 'Rust 所有权'), false,
    '0 覆盖 = 完全无关，必须被挡在相关组之外')
  assert.equal(isQueryRelevant({ sourceId: 'x', title: '无关', url: 'u' }, undefined), true, '没有查询就不做判定')
})

// ── 同来源内去重 ──────────────────────────────────────────────

test('同来源同标题只保留一条  实测 Crossref 会返回重复记录', () => {
  // 线上实测: 查询「服务端渲染」时 Crossref 返回两条**完全相同标题**的记录，白占名额。
  const hits: SourceHit[] = [
    { sourceId: 'crossref', title: '汽车后市场服务模式创新研究', url: 'u1' },
    { sourceId: 'crossref', title: '汽车后市场 服务模式 创新研究', url: 'u2' },
    { sourceId: 'crossref', title: '另一篇', url: 'u3' },
  ]
  dedupeWithinSource(hits)
  assert.equal(hits.length, 2, '标点差异不算不同条目')
  assert.equal(hits[0]!.url, 'u1', '保留**首次**出现的那条')
})

test('跨来源的同标题**不合并**  两个独立来源是相互印证，不是冗余', () => {
  // 这是刻意的: 合并会让 source-diversity 判据失真，而那条判据防的正是
  // 「一个来源的 N 条本质是一条」。实测三个查询里跨来源重复为 0，本就没有需要解决的问题。
  const hits: SourceHit[] = [
    { sourceId: 'mdn', title: 'Scope', url: 'u1' },
    { sourceId: 'wikipedia', title: 'Scope', url: 'u2' },
  ]
  dedupeWithinSource(hits)
  assert.equal(hits.length, 2, '不同来源的同一结论是印证证据，必须都保留')
})

test('标题归一化只用于判同  去标点、转小写，不改展示文本', () => {
  assert.equal(normalizeTitle('Rust (编程语言)'), normalizeTitle('rust编程语言'))
  assert.equal(normalizeTitle('A-B_C'), 'abc')
})

test('充分性口径比排序口径更严  两者职责不同，不许合并成一个阈值', () => {
  // 同一条命中: 排序认为"沾边了"，充分性认为"这不够回答我的问题"
  const weak: SourceHit = { sourceId: 'crossref', title: 'Rust fungi and global change.', url: 'u' }
  assert.equal(isQueryRelevant(weak, 'Rust 所有权'), true, '排序: 沾边')
  assert.equal(queryCoverageSignal([weak], 'Rust 所有权', 0.5).ok, false, '充分性: 覆盖不了，不算答上了')
})

test('字面相关性的优先级高于来源话题契合  覆盖 0 词的条目不许插到相关条目前面', () => {
  // 实测踩到: 我先写成"来源维度优先"，于是 npm 的 @formatjs/icu-messageformat-parser
  // （覆盖 0 个查询词）排到了第 4 位  只因为 npm 与查询意图同为 code。
  // 直接证据（内容覆盖）必须强于先验（来源学科归属）。
  assert.equal(queryTermMatches({ sourceId: 'npm', title: '@formatjs/icu-messageformat-parser', url: 'u' }, 'Rust 所有权'), 0)
})

// ── 覆盖度: 第 0 层到底在不在回答这个问题 ─────────────────────

test('覆盖度判据复现真实失效: 学术库对上「不存在的时事」', () => {
  // 线上实测: 「2026 年某某事件进展」第 0 层返回 15 条、全部判据通过，
  // 最佳命中是《色觉研究的某些重要进展》 只匹配了"进展"一个词。
  const hits: SourceHit[] = [
    { sourceId: 'crossref', title: '色觉研究的某些重要进展', url: 'u1' },
    { sourceId: 'pubmed', title: '事件相关电位研究', url: 'u2' },
  ]
  const sig = queryCoverageSignal(hits, '2026 年某某事件进展', 0.5)
  assert.equal(sig.ok, false, '只匹配一个词不算在回答问题')
  // 覆盖的**分母**现在是「词流 + CJK bigram」的并集（见 queryTerms 注释），
  // 所以这里不写死数字，只断言最佳覆盖数确实是 1
  assert.ok(sig.detail.includes('最佳 1/'), sig.detail)
})

test('覆盖度判据不误伤: 真的对上了就放行', () => {
  const hits: SourceHit[] = [
    { sourceId: 'crossref', title: '无关的论文', url: 'u1' },
    { sourceId: 'github', title: 'Rust 所有权与借用：从堆栈开始建立心智模型', url: 'u2' },
  ]
  assert.equal(queryCoverageSignal(hits, 'Rust 所有权', 0.5).ok, true)
  // 「Rust 所有权」的查询词是 [rust, 有权]  一条只含 rust 的包名**不算**覆盖了问题
  assert.equal(
    queryCoverageSignal([{ sourceId: 'npm', title: '@codemirror/lang-rust', url: 'u' }], 'Rust 所有权', 0.5).ok,
    false,
    '这正是线上第 0 层的真实最佳命中: 它只匹配了 rust 一个词',
  )
})

test('已知边界: 摘要里凑齐查询词就能骗过覆盖度  判据只降低概率，没有根除', () => {
  // 线上实测踩到: 「2026 年某某事件进展」最终由一条 Wikipedia 条目
  // （标题《2026年3月中國大陸》）满足覆盖度并停在 L0  它的**摘要**恰好含全四个词，
  // 而条目本身不是那个"某某事件"，那一层其余 14 条也全无关。
  // 这说明覆盖度是**字面**判据: 它证明"这些字都出现了"，不证明"这条在回答这个问题"。
  const sneaky: SourceHit = {
    sourceId: 'wikipedia',
    title: '2026年3月中國大陸',
    snippet: '2026年 某某 事件 进展 的段落索引',
    url: 'u',
  }
  assert.equal(queryCoverageSignal([sneaky], '2026 年某某事件进展', 0.5).ok, true,
    '判据确实会被字面凑词骗过  这是已知边界，不是 bug；根除它需要语义理解')
})

test('覆盖度判据的诚实边界: 单查询词的题目豁免「至少两个词」的要求', () => {
  const sig = queryCoverageSignal([{ sourceId: 'github', title: 'webpack 配置', url: 'u' }], 'webpack', 0.5)
  assert.equal(sig.ok, true, '只有一个词时不该要求覆盖两个')
})

test('detectScript 按字符集分类，不做语种判断', () => {
  assert.equal(detectScript('Rust 所有权'), 'mixed')
  assert.equal(detectScript('transformer'), 'latin')
  assert.equal(detectScript('所有权'), 'cjk')
  assert.equal(detectScript('12345'), 'other')
})

test('实测复现: 中文查询拿到一屏英文/无关结果时，语种判据必须报警', () => {
  // 依据: 2026-09-16 实测, 查询「Rust 所有权」第 0 层返回 18 条、标识符覆盖 18/18,
  // 但全部与问题无关  而它满足了条数条件, 把真正可能有答案的第 1 层挡在外面。
  const hits: SourceHit[] = [
    { sourceId: 'crossref', title: 'Transformer ratings and transformer life', url: 'u1' },
    { sourceId: 'npm', title: 'a protocol implementation', url: 'u2' },
  ]
  const sig = languageFitSignal(hits, 'Rust 所有权')
  assert.equal(sig.ok, false)
  assert.ok(sig.detail.includes('没有'))
  assert.ok(sig.detail.includes('条数够不代表够用'))
})

test('已知边界: 同文字系统但话题无关时**抓不到**  不许把这条判据说成能解决相关性', () => {
  // 线上实测确认: 查询「Rust 所有权」时 Crossref 返回的是中文论文《全民所有自然资源
  // 资产所有权委托代理模式探究》 文字系统匹配、内容毫不相关，判据因此**通过**，
  // 系统仍停在 L0。这是本判据的已知能力边界，不是缺陷。
  // 线上真实的第 0 层结果构成: 中英混杂  crossref/pubmed 给中文论文,
  // github/mdn/npm 给英文条目。两者都出现 → 判据**通过**, 系统停在 L0。
  const observed: SourceHit[] = [
    { sourceId: 'crossref', title: '全民所有自然资源资产所有权委托代理模式探究', url: 'u1' },
    { sourceId: 'pubmed', title: '权利冲突视角下所有权保留的性质探析', url: 'u2' },
    { sourceId: 'github', title: 'rust-lang/rust', url: 'u3' },
    { sourceId: 'mdn', title: 'Array.prototype.map', url: 'u4' },
  ]
  assert.equal(languageFitSignal(observed, 'Rust 所有权').ok, true,
    '本判据只能识别文字系统不匹配; 结果里两种系统都出现时它必然通过，' +
    '把"同系统无关"当成已解决是过度声称')
})

test('文字系统吻合时不报警（不许把正常情况也判成异常）', () => {
  const cjkHits: SourceHit[] = [{ sourceId: 'juejin', title: 'Rust 的所有权模型详解', url: 'u' }]
  assert.equal(languageFitSignal(cjkHits, 'Rust 所有权').ok, true)
  const latin: SourceHit[] = [{ sourceId: 'mdn', title: 'Array.prototype.map', url: 'u' }]
  assert.equal(languageFitSignal(latin, 'Array map').ok, true)
})

test('语种不吻合 → 不满足充分性 → 必须继续下降到有对应语料的层', async () => {
  const en = { sourceId: 'crossref', title: 'Transformer ratings', url: 'u' } as SourceHit
  const zh = { sourceId: 'juejin', title: 'Rust 所有权模型详解', url: 'u' } as SourceHit
  const r = await recall('Rust 所有权', {
    'crossref': async () => [en, en, en, en],
    'juejin': async () => [zh],
  }, { ...ctx, query: 'Rust 所有权', minHits: 3, minSources: 1 })
  // 第 0 层不充分 → 必须**继续尝试**第 1 层。第 1 层是否真有实现不影响这条断言:
  // 这一层被尝试过（ran 或报出未接线）就说明下降发生了。
  assert.deepEqual(r.tiers.filter(t => t.ran).map(t => t.tier), [0, 1], '语种不吻合时必须下降')
  assert.equal(r.reachedTier, 1, '实测里就是"权威层的空壳挡掉了中文社区"，这条判据就是为它加的')
  const langSig = r.verdict.signals.find(s => s.name === 'language-fit')!
  assert.equal(langSig.ok, true, '第 1 层补上中文语料后语种判据应当通过')
})

test('来源多样性: 单一来源的 N 条本质上只是一条来源', () => {
  const same: SourceHit[] = Array.from({ length: 9 }, (_, i) => ({ sourceId: 'crossref', title: 'T', url: `u${i}` }))
  assert.equal(sourceDiversitySignal(same, 2).ok, false)
  assert.equal(sourceDiversitySignal([...same, { sourceId: 'npm', title: 'T', url: 'u' }], 2).ok, true)
})

test('充分性判定必须带完整证据链  每条判据都有名字、结论与理由', async () => {
  const r = await recall('x', { 'crossref': fetcher({ hits: 5 }), 'npm': fetcher({ hits: 5 }) }, ctxMulti)
  assert.ok(r.verdict.sufficient)
  const names = r.verdict.signals.map(s => s.name)
  assert.deepEqual(names, [
    'authoritative-supply', 'volume', 'topic-fit', 'language-fit', 'source-diversity',
    'evidence-substance', 'query-coverage',
  ])
  for (const s of r.verdict.signals) assert.ok(s.detail.length > 0, `${s.name} 缺少理由`)
})

test('未通过时的判据同样要留在结果里  「为什么没停」必须可复查', async () => {
  const r = await recall('x', { 'crossref': fetcher({ hits: 1 }) }, ctxMulti)
  assert.equal(r.verdict.sufficient, false, '只有 1 条, 不该够用')
  const vol = r.verdict.signals.find(s => s.name === 'volume')!
  assert.equal(vol.ok, false)
  assert.ok(vol.detail.includes('1 条'))
})

test('取数函数返回非数组 → 响亮报错，不许伪装成"没有内容"', async () => {
  // 实测踩到: 工厂函数没被调用直接放进表里, 返回的是函数而不是数组 
  // 当时它被吞成 unknown 错误, 5 个来源静默变成"0 条命中"。
  const bad = (async () => ({ not: 'an array' })) as unknown as SourceFetcher
  const r = await recall('x', { 'crossref': bad }, ctxMulti)
  const t0 = r.tiers.find(t => t.tier === 0)!
  assert.equal(t0.failures.length, 1)
  assert.ok(t0.failures[0]!.message.includes('非数组'), '错误信息必须指出是实现有误')
})

test('第 0 层内多个来源同属权威层，没有层内优先级  靠标识符而不是分值', async () => {
  const r = await recall('x', {
    'github': fetcher({ hits: 2 }),
    'wikipedia': fetcher({ hits: 2 }),
  }, { ...ctx, minHits: 10, perSourceLimit: 5 })
  assert.equal(r.tiers.find(t => t.tier === 0)!.sources.length, 2)
  assert.equal(r.hits.length, 4)
})

// ── 证据块密度（2026-09-18 读 argo 源码后加）─────────────────────

test('证据块识别: 数字/定义/对比/步骤/披露 各自被识别', async () => {
  const { evidenceBlocksOf } = await import('../src/recall.ts')
  const mk = (title, snippet) => ({ sourceId: 'x', title, url: 'u', snippet })
  assert.equal(evidenceBlocksOf(mk('性能提升 30%', '')).hasNumbers, true)
  assert.equal(evidenceBlocksOf(mk('所有权', '所有权是指每个值有唯一主人')).hasDefinition, true)
  assert.equal(evidenceBlocksOf(mk('对比', '相比旧版快了 2 倍')).hasComparison, true)
  assert.equal(evidenceBlocksOf(mk('教程', '步骤：首先安装，其次配置')).hasHowto, true)
  assert.equal(evidenceBlocksOf(mk('说明', '本方法有局限，仅供参考')).hasDisclosure, true)
})

test('纯 Q&A 格式**只统计不扣分**  我们没有 argo 的 GEO 实测，不照搬它的扣分', async () => {
  // argo 对纯问答格式扣 0.08，理由是有实测支撑（GEO 语料）。我们没有这个实测，
  // 照搬一个没有本机证据支持的扣分，正是本项目反复否决的形态。
  const { evidenceBlocksOf } = await import('../src/recall.ts')
  // 两段的**内容必须逐字相同**，只差 Q/A 标记  否则测的是别的东西。
  // 第一版就写错了: 用了"怎么用"，它命中 howto 正则，于是两段密度本来就不等。
  const qa = evidenceBlocksOf({ sourceId: 'x', title: '安装', url: 'u', snippet: 'Q：安装步骤\nA：首先安装，其次配置' })
  assert.equal(qa.isQaFormat, true, '要如实统计出来')
  const plain = evidenceBlocksOf({ sourceId: 'x', title: '安装', url: 'u', snippet: '安装步骤\n首先安装，其次配置' })
  assert.equal(qa.density, plain.density, '但**密度不许因此变化**  扣分需要有实测依据')
})

test('“有事实块”排在“只有形容词”之前  密度是分档不是全序', async () => {
  const { recall } = await import('../src/recall.ts')
  const ctx0 = { query: 'Rust 所有权', minHits: 1, perSourceLimit: 9, minSources: 1, maxTier: 0 }
  const r = await recall('Rust 所有权', {
    'github': async (s) => [
      { sourceId: s.id, title: 'Rust 所有权说明', url: 'u1', snippet: 'Rust 所有权很重要，需要好好理解它' },
      { sourceId: s.id, title: 'Rust 所有权规则', url: 'u2', snippet: 'Rust 所有权是指每个值有唯一主人；相比 GC 无运行时开销；规则共 3 条' },
    ],
  }, ctx0)
  assert.equal(r.hits[0]!.url, 'u2', '含数字+定义+对比的那条必须排前面')
  assert.equal(r.hits.length, 2, '分档不改采纳  另一条仍然保留')
})

test('没有查询词可覆盖时不受密度分档影响（不引入新的丢弃）', async () => {
  const { recall } = await import('../src/recall.ts')
  const r = await recall('zzz', {
    'github': async (s) => [
      { sourceId: s.id, title: 'a', url: 'u1' },
      { sourceId: s.id, title: 'b', url: 'u2', snippet: '数字 123 个，定义是指某物，对比优于旧版' },
    ],
  }, { query: 'zzz', minHits: 1, perSourceLimit: 9, minSources: 1, maxTier: 0 })
  assert.equal(r.hits.length, 2)
})

// ── 否定约束（2026-09-18 实测倒逼）────────────────────────────────

test('否定触发词本身不许变成检索词  它必然出现在查询里，会污染覆盖度', async () => {
  const { queryTerms } = await import('../src/recall.ts')
  // 实测修复前: 「除了百度的搜索引擎」产出 除了/了百/度的 三个垃圾词
  for (const q of ['除了百度的搜索引擎', '不要广告的图片压缩工具']) {
    const terms = queryTerms(q)
    for (const junk of ['除了', '不要', '了百', '度的', '要广']) {
      assert.ok(!terms.includes(junk), `${q} 的检索词里不该有「${junk}」: ${JSON.stringify(terms)}`)
    }
  }
})

test('被排除的实体必须被识别出来（中文四种 + 英文两种 + 减号）', async () => {
  const { parseNegation } = await import('../src/recall.ts')
  const cases: Array<[string, string[]]> = [
    ['除了百度的搜索引擎', ['百度']],
    ['不要广告的图片压缩工具', ['广告']],
    ['排除广告的压缩工具', ['广告']],
    ['不想看剧透的影评', ['剧透']],
    ['Rust 所有权 -GC', ['GC']],
    ['notion 替代品 NOT 飞书', ['飞书']],
    ['a tool without ads', ['ads']],
  ]
  for (const [q, want] of cases) {
    assert.deepEqual(parseNegation(q).exclude, want, q)
  }
})

test('减号不许误伤连字符词  gpt-4 不是"排除 4"', async () => {
  const { parseNegation } = await import('../src/recall.ts')
  assert.deepEqual(parseNegation('gpt-4 提示词').exclude, [], '负号前是字母，属于词的一部分')
  assert.deepEqual(parseNegation('GPT-4o 生图').exclude, [])
})

test('命中里的排除词只**降档**不丢弃  含该词未必是关于它', async () => {
  const { recall } = await import('../src/recall.ts')
  const q = '不要广告的图片压缩工具'
  const r = await recall(q, {
    github: async (s) => [
      { sourceId: s.id, title: '广告联盟：图片压缩工具推荐', url: 'u1', snippet: '图片压缩工具，含广告' },
      { sourceId: s.id, title: '图片压缩工具', url: 'u2', snippet: '纯本地图片压缩工具' },
    ],
  }, { query: q, minHits: 1, perSourceLimit: 9, minSources: 1, maxTier: 0 })
  assert.equal(r.hits.length, 2, '含排除词的那条**仍然保留**  降档不是丢弃')
  assert.equal(r.hits[0]!.url, 'u2', '不含「广告」的排前面')
})

test('没有否定词时排序不受影响（不引入新的重排）', async () => {
  const { recall } = await import('../src/recall.ts')
  const q = 'Rust 所有权'
  const r = await recall(q, {
    github: async (s) => [
      { sourceId: s.id, title: 'A', url: 'u1', snippet: 'Rust 所有权 内存安全' },
      { sourceId: s.id, title: 'B', url: 'u2', snippet: 'Rust 所有权 借用检查' },
    ],
  }, { query: q, minHits: 1, perSourceLimit: 9, minSources: 1, maxTier: 0 })
  assert.deepEqual(r.hits.map(h => h.url), ['u1', 'u2'], '保持来源给出的顺序')
})


// ── 放宽阶梯（2026-09-18 读 argo recovery 后加）──────────────────

test('放宽阶梯逐层剥离，且每层只撤一类条件', async () => {
  const { relaxSteps } = await import('../src/recall.ts')
  const st = relaxSteps('"精确短语" 测试 -排除')
  assert.equal(st.length, 2, '两类语法 → 两步')
  assert.equal(st[0]!.dropped, 'exclude', '先撤损失最小的（排除）')
  assert.equal(st[0]!.query, '"精确短语" 测试')
  assert.equal(st[1]!.dropped, 'phrase', '再撤引号')
  assert.equal(st[1]!.query, '精确短语 测试')
})

test('无语法可撤时返回空数组  不是返回原查询', async () => {
  // 返回原查询会让调用方以为"试过了"，而实际什么都没变。
  const { relaxSteps } = await import('../src/recall.ts')
  assert.deepEqual(relaxSteps('普通查询'), [])
  assert.deepEqual(relaxSteps(''), [])
  assert.deepEqual(relaxSteps(undefined), [])
})

test('减号不许误伤连字符词  gpt-4 不该被当成"撤掉排除项"', async () => {
  const { relaxSteps } = await import('../src/recall.ts')
  assert.deepEqual(relaxSteps('gpt-4 提示词'), [], 'gpt-4 没有可撤的排除项')
})

test('阶梯的层数等于真实支持的语法数  不许产出永远为空的步骤', async () => {
  // argo 有七层（对应七类平台语法），我们只有三类。
  // 照搬七层会产出四个永远为空的步骤  那是**假的能力**。
  const { relaxSteps } = await import('../src/recall.ts')
  const maxSteps = relaxSteps('"短语" 词 -排除')
  assert.ok(maxSteps.length <= 2, '我们只实现了 exclude 与 phrase 两类，步数不许超过这个')
})

// ── 错别字容错进检索词（2026-09-18 修）────────────────────────────

test('归一后的词必须进检索词  否则容错是空的', async () => {
  // 实测缺口: `normalize` 模块早就写好了（混淆词表/自我更正/填充词/变体集），
  // **而它的归一结果从没进过检索词**  queryTerms 抽的是原始查询。
  // 同一形态在本项目出现过五次: 机制在、测试绿、没接线。
  const { queryTerms } = await import('../src/recall.ts')
  assert.deepEqual(queryTerms('微薄 热搜'), ['微博', '热搜'], '微薄 → 微博')
  assert.ok(queryTerms('知呼 怎么学 Rust').includes('知乎'), '知呼 → 知乎')
  assert.ok(!queryTerms('微薄 热搜').includes('微薄'), '错字本身不该成为检索词')
})

test('口语句读与填充词不许进检索词', async () => {
  const { queryTerms } = await import('../src/recall.ts')
  const terms = queryTerms('那个那个 就是就是 编成语言')
  for (const junk of ['那个', '就是', '个那', '是就', '编成']) {
    assert.ok(!terms.includes(junk), '垃圾词不该出现: ' + junk + ' → ' + JSON.stringify(terms))
  }
  assert.ok(terms.includes('编程'), '编成 → 编程')
})

test('正常查询不受归一影响（不引入新的改写）', async () => {
  const { queryTerms } = await import('../src/recall.ts')
  assert.deepEqual(queryTerms('Rust 所有权'), ['rust', '有权', '所有'])
  // **断言值来自实测，不来自猜测**  我第一版写了 ['react','服务','端']，
  // 而实际分词是 react/服务/原理/务端/... （“服务端”被切成服务+端）。
  // 测试断言必须照着实测写，否则测的是我的想象。
  const t = queryTerms('React 服务端组件原理')
  assert.ok(t.includes('react') && t.includes('服务') && t.includes('原理'), '常规词该在: ' + JSON.stringify(t))
  assert.ok(!t.includes('微薄'), '不引入新的改写')
})

test('错字与正字**都在相关组内**  退化只影响排序，不丢证据', async () => {
  // 真实权衡: 用户打错字、而**文档标题也是错字**时（别人也打错了），
  // 用归一后的词去匹配会少覆盖一个词。这是**刻意的取舍**，不是缺陷:
  //   - 判据 isQueryRelevant 只要 >= 1 个词，所以两者都进相关组
  //   - 退化的只是组内排序，**证据没有被丢掉**
  const { queryTermMatches, isQueryRelevant } = await import('../src/recall.ts')
  const q = '微薄 热搜'
  const rightTitle = { sourceId: 'weibo', title: '微博热搜榜', url: 'u' }
  const wrongTitle = { sourceId: 'weibo', title: '微薄的实时热搜榜', url: 'u' }
  assert.equal(queryTermMatches(rightTitle, q), 2, '标题正确 → 覆盖 2 个词（这正是修复带来的）')
  assert.equal(queryTermMatches(wrongTitle, q), 1, '标题也是错字 → 覆盖 1 个词')
  assert.equal(isQueryRelevant(rightTitle, q), true)
  assert.equal(isQueryRelevant(wrongTitle, q), true, '**两者都在相关组内**  不丢证据')
})

test('变体集刻意不进检索词  容错不是"两种写法都算命中"', async () => {
  // 若把 normalize 的 variants（`微薄 热搜` / `微博 热搜`）的词并起来，
  // "微薄"与"微博"会同时成为检索词  一条**只含错字的旧文**就成了相关证据，
  // 判据失真。**容错的正确形态是用归一后的词去检索，而不是把错字也当有效词。**
  const { queryTerms } = await import('../src/recall.ts')
  const terms = queryTerms('微薄 热搜')
  assert.ok(terms.includes('微博'), '归一后的词在')
  assert.ok(!terms.includes('微薄'), '错字变体**不在**  这是刻意的')
})

// ── A/B 消融: 发给上游的查询必须是归一后的（2026-09-18）───────────
//
// **这是本项目自己立的规矩**（对齐"下结论前必须做消融对比"）：
// 上一轮我修了归一进 queryTerms，但**没有做消融**，所以当时只能说"容错已接线"，
// 不能说"召回率不低于"。本轮做了，结论是**上一轮的修复不够**  见下。

test('消融: 上游收到的必须是归一后的查询，不是原文', async () => {
  // 消融实测（同一假来源，只改查询；上游**忠实于收到的词**过滤）:
  //   修复前: 「微薄 热搜」→ 上游收到「微薄 热搜」→ 只拿回含"微薄"的旧文 1 条
  //           「微博 热搜」→ 上游收到「微博 热搜」→ 拿回 2 条正确文档
  //   **错误在召回，不在排序  排序层修不了这件事。**
  //   修复后: 两者上游都收到「微博 热搜」→ 都拿回 2 条 ✅
  const { recall, SOURCES } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  const corpus = [
    { title: '微博热搜榜', url: 'u1', snippet: '微博 热搜' },
    { title: '微薄这个词的由来', url: 'u2', snippet: '微薄 词汇' },
    { title: '微博营销案例', url: 'u3', snippet: '微博 营销' },
  ]
  const run = async (q: string) => {
    let received: string | null = null
    const mk = (s: { id: string }, query: string) => {
      received = query
      const key = query.split(' ')[0]!
      const got = corpus.filter(d => d.title.includes(key) || d.snippet.includes(key))
      return Promise.resolve(got.map(d => ({ ...d, sourceId: s.id })))
    }
    const r = await recall(q, { [t0.id]: mk as never }, { query: q, minHits: 1, perSourceLimit: 9, minSources: 1, maxTier: 0 })
    return { received: received as string | null, urls: r.hits.map(h => h.url) }
  }
  const wrong = await run('微薄 热搜')
  const right = await run('微博 热搜')
  assert.equal(wrong.received, '微博 热搜', '上游必须收到归一后的查询')
  assert.deepEqual(wrong.urls, right.urls, '错字查询与正确查询的命中集合必须一致（消融等价）')
  assert.equal(right.urls.length, 2, '两条正确文档都该召回')
})

test('消融: 无错别字的查询，**首次**发给上游的查询不被改写', async () => {
  // 归一只在**有命中规则时**才改。正常查询必须原样发出 
  // 否则"容错"会变成"静默改写用户的查询"。
  //
  // **2026-09-19 更新**: 加了换语种重查之后，同一个来源会被调用**两次** 
  // 第一次是原查询，第二次是英文变体。这条测试因此改为**只看第一次**。
  // **约束本身没变**: 原查询必须原样发出，变体是**追加**而不是替换。
  // 新加的两条测试锁住"第二次是什么"与"原查询仍在"。
  const { recall, SOURCES } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  const calls: string[] = []
  const mk = (_s: unknown, query: string) => { calls.push(query); return Promise.resolve([]) }
  await recall('Rust 所有权', { [t0.id]: mk as never }, { query: 'Rust 所有权', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.equal(calls[0], 'Rust 所有权', '第一次必须是原查询')
})

test('换语种重查: 中文查询会追加一次英文变体，**原查询永远在前**', async () => {
  // 实测依据 (2026-09-19): 三个中文查询的英文改写各自多召回 40-77%。
  const { recall, SOURCES } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  const calls: string[] = []
  const mk = (_s: unknown, query: string) => { calls.push(query); return Promise.resolve([]) }
  await recall('Rust 所有权', { [t0.id]: mk as never }, { query: 'Rust 所有权', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.equal(calls.length, 2, '一次原查询 + 一次变体，实际: ' + JSON.stringify(calls))
  assert.equal(calls[0], 'Rust 所有权')
  assert.match(calls[1]!, /ownership/)
})

test('换语种重查: **改写不出就不补调用**  不猜', async () => {
  const { recall, SOURCES } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  const calls: string[] = []
  const mk = (_s: unknown, query: string) => { calls.push(query); return Promise.resolve([]) }
  // 纯英文查询与词表外的中文都不该产生变体
  await recall('rust ownership', { [t0.id]: mk as never }, { query: 'rust ownership', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.equal(calls.length, 1, '英文查询不该有变体: ' + JSON.stringify(calls))
  calls.length = 0
  await recall('李白 杜甫 唐诗', { [t0.id]: mk as never }, { query: '李白 杜甫 唐诗', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.equal(calls.length, 1, '词表外不该硬凑: ' + JSON.stringify(calls))
})

test('换语种重查: 变体失败**不让来源整体失败**（它是补充不是主路径）', async () => {
  const { recall, SOURCES } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  let n = 0
  const mk = (_s: unknown, _q: string) => {
    n++
    if (n === 1) return Promise.resolve([{ sourceId: t0.id, title: '主查询结果', url: 'https://example.com/a' }])
    return Promise.reject(new Error('变体挂了'))   // 第二次必须抛
  }
  const r = await recall('Rust 所有权', { [t0.id]: mk as never }, { query: 'Rust 所有权', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.equal(r.hits.length, 1, '主查询的结果必须保住')
  const f = r.tiers.flatMap(t => t.failures).filter(x => x.sourceId === t0.id)
  assert.equal(f.length, 0, '变体失败不该记成来源失败: ' + JSON.stringify(f))
})

test('消融: 否定片段不会发给上游  它只是过滤条件', async () => {
  const { recall, SOURCES } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  let received: string | null = null
  const mk = (_s: unknown, query: string) => { received = query; return Promise.resolve([]) }
  await recall('图片压缩工具 -广告', { [t0.id]: mk as never }, { query: '图片压缩工具 -广告', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.ok(received !== null && !received.includes('-广告'), '上游不该收到减号排除语法: ' + received)
  assert.ok(received !== null && received.includes('图片压缩'), '正题词要在: ' + received)
})

// ── 来源语义路由（2026-09-18 加）──────────────────────────────────
//
// 消融实测（「阿司匹林 相互作用」，maxTier=2 强制跑完所有层）:
//   路由关: 调用 42 个来源 | 108.3s | 命中 21
//   路由开: 调用 19 个来源 |  76.4s | 命中 20
//   **省下 23 个请求（-55%）、耗时降 30%，命中只差 1 条。**

test('话题判定: 六个领域的查询都要能被分类', async () => {
  const { classifyTopic } = await import('../src/route-sources.ts')
  const cases: Array<[string, string]> = [
    ['Rust 所有权', 'code'],
    ['阿司匹林 相互作用', 'biomedical'],
    ['美国 GDP 增速', 'finance'],
    ['合同纠纷 判决', 'legal'],
    ['周杰伦 新专辑', 'media'],
    ['Transformer 论文', 'academic'],
  ]
  for (const [q, want] of cases) {
    assert.ok(classifyTopic(q).has(want as never), q + ' 应归 ' + want + '，实际 ' + [...classifyTopic(q)].join('/'))
  }
})

test('**误跳是最严重的错**  技术查询不许跳过中文技术社区', async () => {
  // 第一版设计（用"来源自述词"逐词匹配）在实测中立刻暴露:
  // 「Rust 所有权」跳过了 juejin  因为它的描述是"掘金 前端 后端 编程…"，
  // 没有一个词与 rust/所有/有权 匹配。**而它恰恰最该查。**
  // 存的是**话题族**而不是词，才修掉这个。
  const { routeSources } = await import('../src/route-sources.ts')
  const d = routeSources('Rust 所有权')
  for (const id of ['juejin', 'bilibili', 'duckduckgo', 'mdn', 'github']) {
    assert.ok(d.keep.includes(id), id + ' 不该被跳过（技术查询）')
  }
  // 而真正不相关的必须跳
  for (const id of ['uniprot', 'rcsb_pdb', 'pubchem', 'clinicaltrials']) {
    assert.ok(d.skip.has(id), id + ' 对编程查询应跳过')
  }
})

test('权威层永不跳过  误跳的代价大于省下的请求', async () => {
  // 第 0 层只有 11 个来源，省下的请求少，而它们是"权威公域"。
  const { routeSources } = await import('../src/route-sources.ts')
  const d = routeSources('阿司匹林 相互作用')
  for (const id of ['crossref', 'arxiv', 'github', 'mdn', 'npm']) {
    assert.ok(d.keep.includes(id), '第 0 层 ' + id + ' 永不跳过')
  }
})

test('无法归类时**只保留通用来源**  全查的代价实测不可接受', async () => {
  // **这条测试锁的是 2026-09-18 修正后的行为**，它取代了此前"全查"的决策。
  //
  // 旧决策的理由是对的（判不出类别时跳过任何来源都是赌），但**代价实测不可接受**:
  //   "durov telegram" → 无法归类 → 查 31 个第 1 层来源
  //   而 argo 的 MCP server 是**完全串行**的（mcp_transport.py:78）
  //   → 实测 31 个串行 = **123 秒**
  //
  // 新决策: 保留**自称通用**的（标 '*'）与**没声明**的，跳过**自称专精**的。
  // **判据仍来自来源自己的声明**  不是我们猜。
  const { routeSources, classifyTopic, SOURCE_TOPICS } = await import('../src/route-sources.ts')
  const q = 'qwertyuiop 12345'
  assert.equal(classifyTopic(q).size, 0, '这个词表判不出类别')
  const d = routeSources(q)
  assert.ok(d.skip.size > 0, '要裁掉自称专精的')
  // 关键: 保留的必须是"权威层 + 自称通用 + 没声明"三类之一
  const { SOURCES } = await import('../src/recall.ts')
  const tierOf = new Map(SOURCES.map(s => [s.id, s.tier]))
  for (const id of d.keep) {
    if (tierOf.get(id) === 0) continue   // 权威层永不跳过（单独的测试锁它）
    const owned = SOURCE_TOPICS[id]
    assert.ok(owned === undefined || owned.includes('*'), id + ' 不该在无法归类时被保留: ' + JSON.stringify(owned))
  }
})

test('无法归类时**权威层仍永不跳过**  我第一版漏了这条', async () => {
  // 兜底分支在 tier 检查**之前** return，于是 crossref/pubmed 被判
  // "只覆盖 academic/biomedical" 而跳过  实测 6 条层级行为测试因此变红。
  const { routeSources } = await import('../src/route-sources.ts')
  const d = routeSources('qwertyuiop 12345')
  for (const id of ['crossref', 'arxiv', 'pubmed', 'github', 'mdn']) {
    assert.ok(d.keep.includes(id), '第 0 层 ' + id + ' 永不跳过（兜底分支里也一样）')
  }
})

test('跳过必须**可解释**  每一次跳都要说出为什么', async () => {
  const { routeSources } = await import('../src/route-sources.ts')
  const d = routeSources('Rust 所有权')
  assert.ok(d.skip.size > 0)
  for (const [id, reason] of d.skip) {
    assert.ok(reason.includes('只覆盖'), id + ' 的理由不完整: ' + reason)
    assert.ok(reason.includes('classifyTopic') === false)
  }
})

test('路由的产出保持登记顺序  它不参与排序', async () => {
  // 铁律: 各来源自报分口径不可比，跨来源融合不做。路由只决定"查不查"。
  const { routeSources } = await import('../src/route-sources.ts')
  const { SOURCES } = await import('../src/recall.ts')
  const d = routeSources('Rust 所有权')
  const expect = SOURCES.map(s => s.id).filter(id => d.keep.includes(id))
  assert.deepEqual(d.keep, expect, 'keep 必须是 SOURCES 顺序的子序列')
})

test('ctx.route === false 时不路由  供消融与调试', async () => {
  const { recall } = await import('../src/recall.ts')
  const { SOURCES } = await import('../src/recall.ts')
  const seen: string[] = []
  const all: Record<string, unknown> = {}
  for (const s of SOURCES) all[s.id] = async () => { seen.push(s.id); return [] }
  await recall('阿司匹林 相互作用', all as never, { query: '阿司匹林 相互作用', minHits: 1, perSourceLimit: 1, minSources: 1, maxTier: 0, route: false })
  assert.ok(seen.length >= 11, '关掉路由时第 0 层全查，实际 ' + seen.length)
})

// ── 作用域的判据（2026-09-18 修正）────────────────────────────────
//
// **同一个字段在本仓库曾有两份互相矛盾的理解**:
//   - `adapters/adapter.ts` 的 `isApplicable`: `scope !== undefined && scope.length > 0`（对的）
//   - `recall.ts` 的判定: 要求 `ctx.scope` **字面包含** `'channel'`（错的）
//
// 后果实测: 用户写 `durov telegram`（适配器自己能解析频道名），
// 若 scope 传 `['durov']` 或 `['telegram','durov']` → 被判"缺 channel 作用域"
// → 标 not-applicable → **适配器从未被调用**。

test('作用域传**频道名**时必须让适配器被调用  它自己会解析', async () => {
  const { recall } = await import('../src/recall.ts')
  const called: string[] = []
  const mk = async (source: { id: string }) => {
    called.push(source.id)
    return [{ sourceId: source.id, title: 't', url: 'https://e/x', snippet: '一段足够长的摘要内容用于通过证据长度检查' }]
  }
  for (const scope of [['durov'], ['telegram', 'durov'], ['channel']]) {
    called.length = 0
    await recall('durov telegram', { 'telegram-public': mk }, { query: 'durov telegram', scope, minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
    assert.ok(called.includes('telegram-public'), 'scope=' + JSON.stringify(scope) + ' 时适配器该被调用')
  }
})

test('**未提供**作用域时仍必须跳过  否则每次召回白跑一次请求', async () => {
  // 这是修复的边界: 放宽的是"作用域叫什么名字"，不是"要不要有作用域"。
  const { recall } = await import('../src/recall.ts')
  const called: string[] = []
  const mk = async (source: { id: string }) => { called.push(source.id); return [] }
  const r = await recall('durov telegram', { 'telegram-public': mk }, { query: 'durov telegram', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  assert.ok(!called.includes('telegram-public'), '没给作用域就不该调用')
  const f = r.tiers.flatMap(t => t.failures).find(x => x.sourceId === 'telegram-public')
  assert.ok(f !== undefined && f.kind === 'not-applicable', '要标 not-applicable 而不是失败')
  // 消息里会带 'channel'  那是 requiredScope 的**能力名**，不是错误。
  // 要断言的是它**讲清了怎么提供作用域**（此前只说"如频道名"，没说写法）。
  assert.ok(f.message.includes('频道名'), '消息要说明作用域长什么样: ' + f.message)
  assert.ok(f.message.includes('不是坏了'), '要明确这不是故障: ' + f.message)
})

test('空数组等同于未提供  空 scope 不能算"提供了作用域"', async () => {
  const { recall } = await import('../src/recall.ts')
  const called: string[] = []
  const mk = async (source: { id: string }) => { called.push(source.id); return [] }
  await recall('durov telegram', { 'telegram-public': mk }, { query: 'durov telegram', scope: [], minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  assert.ok(!called.includes('telegram-public'), '空数组不该被当成"提供了作用域"')
})

test('不需要作用域的来源不受影响', async () => {
  const { recall } = await import('../src/recall.ts')
  const called: string[] = []
  const mk = async (source: { id: string }) => { called.push(source.id); return [] }
  await recall('Rust', { crossref: mk }, { query: 'Rust', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0 })
  assert.ok(called.includes('crossref'), '无 requiredScope 的来源照常调用')
})

// ── 作用域自动识别（2026-09-18 加）────────────────────────────────
//
// 上轮修好了判据（"有没有提供作用域"），但 **ctx.scope 仍没有生产者** 
// 用户写 `durov telegram` 时 Telegram 仍被判 not-applicable。本轮补上生产者。

test('自动识别: 频道查询能解析出作用域，裸查询不解析', async () => {
  const { resolveScope, registerScopeProbe, clearScopeProbes } = await import('../src/scope-resolve.ts')
  clearScopeProbes()
  registerScopeProbe('telegram-public', (q: string) => {
    const m = /^\s*([A-Za-z0-9_]{5,32})\s+(.+)$/.exec(q)
    return m === null ? null : [m[1]!]
  })
  const a = resolveScope('durov telegram', ['telegram-public'])
  assert.deepEqual(a.scope, ['durov'])
  assert.deepEqual([...a.found.keys()], ['telegram-public'])
  const b = resolveScope('Rust 所有权', ['telegram-public'])
  assert.deepEqual(b.scope, [], '裸查询识别不出作用域')
  clearScopeProbes()
})

test('探测函数抛错时**不毁掉整次召回**  那只是"这次没识别到"', async () => {
  // 抛出去会让一个平台的格式问题毁掉整次检索。**探测失败不是故障。**
  const { resolveScope, registerScopeProbe, clearScopeProbes } = await import('../src/scope-resolve.ts')
  clearScopeProbes()
  registerScopeProbe('boom', () => { throw new Error('解析炸了') })
  const r = resolveScope('任意查询', ['boom'])
  assert.deepEqual(r.scope, [], '抛错被吞成"没识别到"')
  clearScopeProbes()
})

test('没有探测器的来源不被猜  猜错会把查询发到别人的频道', async () => {
  const { resolveScope, clearScopeProbes } = await import('../src/scope-resolve.ts')
  clearScopeProbes()
  const r = resolveScope('durov telegram', ['某个没注册探测器的来源'])
  assert.deepEqual(r.scope, [], '没有探测器就不填')
})

test('显式传入的 scope 优先，且不被自动识别覆盖', async () => {
  // 调用方明确给的是**更强的信号**（它可能知道查询里看不出的东西）。
  const { recall } = await import('../src/recall.ts')
  const { registerScopeProbe, clearScopeProbes } = await import('../src/scope-resolve.ts')
  clearScopeProbes()
  registerScopeProbe('telegram-public', () => ['auto-channel'])
  const seen: Array<string[] | undefined> = []
  const mk = async (source: { id: string }, _q: string, ctx: { scope?: readonly string[] }) => {
    seen.push(ctx.scope as string[] | undefined)
    return []
  }
  await recall('durov telegram', { 'telegram-public': mk }, { query: 'durov telegram', scope: ['explicit'], minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  assert.deepEqual(seen[0], ['explicit'], '显式的优先')
  clearScopeProbes()
})

test('未注册探测器时退回"没作用域"  行为与加此机制前一致', async () => {
  const { recall } = await import('../src/recall.ts')
  const { clearScopeProbes } = await import('../src/scope-resolve.ts')
  clearScopeProbes()
  const called: string[] = []
  const mk = async (source: { id: string }) => { called.push(source.id); return [] }
  const r = await recall('durov telegram', { 'telegram-public': mk }, { query: 'durov telegram', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 1 })
  assert.ok(!called.includes('telegram-public'), '没有探测器就不调用（不猜）')
  const f = r.tiers.flatMap(t => t.failures).find(x => x.sourceId === 'telegram-public')
  assert.equal(f?.kind, 'not-applicable')
})

// ── source-started 事件与时间线（2026-09-18 加）────────────────────

test('observer 报出**进入时刻**  它与 elapsedMs 配合才能区分「慢」与「排队」', async () => {
  // **为什么需要这个事件**: `elapsedMs` 是**从这一层开始算**的，它把排队时间也算进去。
  // 实测某个来源 elapsedMs=33028 而真实网络耗时只有 975ms  其余 32 秒在闸门后排队。
  // 只有拿到"进入时刻"，才能把这两件事分开。
  const { SOURCES, recall } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  const events: Array<{ kind: string; sourceId?: string; at?: number }> = []
  const mk = async () => { await new Promise(r => setTimeout(r, 20)); return [] }
  await recall('Rust', { [t0.id]: mk }, {
    query: 'Rust', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0,
    observer: (e) => events.push({ kind: e.kind, ...('sourceId' in e ? { sourceId: e.sourceId } : {}), ...('at' in e ? { at: e.at } : {}) }),
  })
  const started = events.filter(e => e.kind === 'source-started')
  const settled = events.filter(e => e.kind === 'source-settled')
  assert.ok(started.length > 0, '必须有 source-started')
  assert.equal(started.length, settled.length, '每个来源一进一出')
  assert.ok(typeof started[0]!.at === 'number' && started[0]!.at > 0, 'at 是时间戳')
})

test('进入时刻必须**早于或等于**落定时刻', async () => {
  const { SOURCES, recall } = await import('../src/recall.ts')
  const t0 = SOURCES.find(s => s.tier === 0)!
  const started = new Map<string, number>()
  const order: Array<[string, number, number]> = []
  await recall('Rust', { [t0.id]: async () => [] }, {
    query: 'Rust', minHits: 1, perSourceLimit: 3, minSources: 1, maxTier: 0,
    observer: (e) => {
      if (e.kind === 'source-started') started.set(e.sourceId, e.at)
      else if (e.kind === 'source-settled') order.push([e.sourceId, started.get(e.sourceId) ?? 0, Date.now()])
    },
  })
  for (const [id, st, se] of order) assert.ok(st <= se, id + ' 的进入时刻不该晚于落定')
})
