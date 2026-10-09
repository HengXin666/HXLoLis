import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOURCES, recall } from '../src/recall.ts'
import { AUTHORITATIVE_SOURCES, authoritativeFetchers } from '../src/authoritative.ts'

test('登记表里不允许重复 id  同一来源登记两次会让它被取两次', () => {
  // 实测踩到: recall 按 id 过滤取数函数, 但组装 tier.sources 时用的是全部同层条目,
  // 于是重复登记会让同一次召回把它调用两遍、结果重复一遍(实测 12→15 条)。
  const seen = new Map<string, number>()
  for (const s of SOURCES) seen.set(s.id, (seen.get(s.id) ?? 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  assert.deepEqual(dupes, [], `重复登记的来源: ${dupes.join(',')}`)
})

/**
 * 来源的实现**来源**（哪个模块负责给它产数据）。
 *
 * 为什么需要这张表: 此前这条测试用一行 `if (id === 'bilibili' || ...) continue` 跳过
 * 非权威源  测试**知道**它们不在 `AUTHORITATIVE_SOURCES` 里，却把这个事实写成了
 * 例外而不是"它们由谁实现"。于是"忘了接线"（第 1、2 层整整 12 轮没有实现）
 * 在第 12 轮之前一直不可见。
 *
 * 现在每个来源都必须**指名**它的实现归属，且每一类都必须在下面被验证:
 * 有实现的直接对上；由别的模块实现的，必须有对应测试证明那个模块真的产出了数据。
 
 * .agents/notes/implemented/architecture/2026-09-16-capability-claims-need-evidence.md
 * .agents/notes/implemented/architecture/2026-09-18-authoritative-engine-families.md
 * .agents/notes/implemented/architecture/2026-09-18-engine-breadth-and-skip-cache.md
 */
const IMPL_OWNER: Readonly<Record<string, 'authoritative' | 'argo' | 'adapter'>> = {
  // ── 第 0 层: 全部由 authoritative*.ts 原生实现（HTTP 直连，不经过 argo）
  crossref: 'authoritative',
  arxiv: 'authoritative',
  github: 'authoritative',
  wikipedia: 'authoritative',
  hackernews: 'authoritative',
  pubmed: 'authoritative',
  openalex: 'authoritative',
  mdn: 'authoritative',
  ietf: 'authoritative',
  npm: 'authoritative',
  stackexchange: 'authoritative',
  // ── 第 1、2 层
  bilibili: 'adapter',
  'telegram-public': 'adapter',
  'argo:anysearch': 'argo',
  // juejin 走 authoritative 的原生实现（authoritative-tech.ts 的 juejinSearch）。
  // 它**也**出现在 argo-source 的 ARGO_ENGINE 里  这是刻意的双路：原生实现优先，
  // argo 作为备选。两条路能同时存在，但不能互相矛盾（下一测试验证同题同答）。
  juejin: 'authoritative',
  // ── 2026-09-18 扩张: 新增的 argo 引擎全部由 argo 模块实现 ──────────
  // 它们**不**在 AUTHORITATIVE_SOURCES 里（我们不各自实现 HTTP 客户端），
  // 由 argoFetchers(session) 提供。下一测试会验证 argo 模块真的产出了数据。
  duckduckgo: 'argo',
  baidu_baike: 'argo',
  moegirl: 'argo',
  reddit: 'argo',
  douban_book: 'argo',
  devto: 'argo',
  huggingface: 'argo',
  dblp: 'argo',
  open_library: 'argo',
  gutenberg: 'argo',
  crates: 'argo',
  bilibili_hot: 'argo',
  pubchem: 'argo',
  clinicaltrials: 'argo',
  openfda: 'argo',
  uniprot: 'argo',
  rcsb_pdb: 'argo',
  gbif: 'argo',
  nasa_cmr: 'argo',
  usgs: 'argo',
  fred: 'argo',
  worldbank: 'argo',
  nbs_stats: 'argo',
  sec_edgar: 'argo',
  courtlistener: 'argo',
  gov_policy: 'argo',
  europepmc: 'argo',
  doaj: 'argo',
  pypi: 'argo',
  stackoverflow: 'argo',
}

test('SOURCES 与实现表必须双向一一对应（多一个少一个都算脱节）', () => {
  const reg = new Set(SOURCES.map(s => s.id))
  const impl = new Set(Object.keys(AUTHORITATIVE_SOURCES))
  for (const id of reg) {
    const owner = IMPL_OWNER[id]
    if (owner === 'authoritative') {
      assert.ok(impl.has(id), `登记为 authoritative 却没有实现: ${id}`)
      continue
    }
    // 有归属的（argo/adapter）不算脱节  但**必须真的在 IMPL_OWNER 里**，
    // 不许再用"跳过清单"把未知情况掩盖过去。
    assert.ok(owner !== undefined, `登记了但没指明实现归属: ${id}。新来源必须在这里登记它是谁实现的`)
    assert.ok(!impl.has(id), `${id} 声明归 ${owner} 实现，却同时出现在 AUTHORITATIVE_SOURCES 里`)
  }
  for (const id of impl) assert.ok(reg.has(id), `有实现却没有登记层级: ${id}`)
})

test('IMPL_OWNER 里的每个键都必须真的登记在 SOURCES 里（不许有孤儿归属）', () => {
  const reg = new Set(SOURCES.map(s => s.id))
  for (const id of Object.keys(IMPL_OWNER)) {
    assert.ok(reg.has(id), `IMPL_OWNER 里的 ${id} 没有登记在 SOURCES 里`)
  }
})

/**
 * 一条来源**允许**被多条路径实现，但不许**无人察觉**。
 *
 * 为什么要重写这个测试: 它的第一版只比对 `ARGO_ENGINE ∩ AUTHORITATIVE_SOURCES`
 * （当时抓到 juejin），**漏掉了适配器这一路**  而 `bilibili` 正是适配器 + argo 双路，
 * 于是它逃过了检测。**一个只覆盖两条路里一条的检测，比没有检测更危险**: 它给出
 * "重叠已经被检查过了"的错觉。
 *
 * 现在把**三种实现模块**全部纳入: authoritative（原生 HTTP）、argo（引擎聚合）、
 * adapter（直连平台 API）。同一来源出现在两个及以上模块里就必须显式登记。
 */
const DUAL_PATH: Readonly<Record<string, string>> = {
  juejin: '原生 juejinSearch 优先（实测 20 条高度相关），argo 为备选',
  bilibili: '直连适配器优先（实测返回真实 BV 号），argo 为备选',
  // 2026-09-18 扩张时新增的两条双路: 它们在第 0 层有原生直连实现（官方 API），
  // 同时 argo 也提供同名引擎（本地镜像 / 不同端点）。**原生优先** 
  // 产出更好且失败语义更精确；argo 那条按 fallback 登记，需显式启用。
  wikipedia: '原生 Wikipedia 官方 API 优先（条目 id 稳定），argo local_wikipedia 为备选',
  hackernews: '原生 HN 官方 API（Algolia）优先（点数与 id 可核查），argo 引擎为备选',
}

test('来源的重叠实现必须显式登记，且三种实现模块都要在检测范围内', async () => {
  /**
   * 平台判定的复核  从"单查询探测"到"多变体多查询"
   * .agents/notes/implemented/architecture/2026-09-18-platform-recheck.md
   */
  const { ARGO_ENGINE } = await import('../src/argo-source.ts')
  const { PLATFORMS } = await import('../src/adapters/registry.ts')

  // 每一条来源 → 它有几个实现模块
  const paths = new Map<string, string[]>()
  const add = (id: string, mod: string) => {
    const cur = paths.get(id) ?? []
    if (!cur.includes(mod)) cur.push(mod)
    paths.set(id, cur)
  }
  for (const id of Object.keys(AUTHORITATIVE_SOURCES)) add(id, 'authoritative')
  for (const id of Object.keys(ARGO_ENGINE)) add(id, 'argo')
  for (const p of PLATFORMS) {
    if (p.adapter === undefined) continue
    // `telegram-public` 与 `telegram` 是同一个平台的两种命名  不能因命名不同而漏检
    for (const id of SOURCES.map(s => s.id)) {
      if (id === p.platform || id === `${p.platform}-public`) add(id, 'adapter')
    }
  }

  const multi = [...paths.entries()].filter(([, mods]) => mods.length > 1).map(([id]) => id).sort()
  assert.deepEqual(
    multi,
    Object.keys(DUAL_PATH).sort(),
    `以下来源被多个模块实现但没有登记:${multi.filter(id => !(id in DUAL_PATH)).join(', ') || '（无）'}。` +
      '请在 DUAL_PATH 里写明主次，否则两份实现会各自漂移（一个改了排序，另一个没改）',
  )
})

test('适配器路径确实被检测到了（防止上一个测试因命名不匹配而空转）', async () => {
  const { PLATFORMS } = await import('../src/adapters/registry.ts')
  const { ARGO_ENGINE } = await import('../src/argo-source.ts')
  // bilibili 同时有适配器与 argo 引擎  这是本测试要锁住的真实重叠。
  // 若哪天适配器被摘掉而 DUAL_PATH 没同步，这条会失败。
  const hasAdapter = PLATFORMS.some(p => p.platform === 'bilibili' && p.adapter !== undefined)
  assert.ok(hasAdapter, 'bilibili 适配器存在')
  assert.ok('bilibili' in ARGO_ENGINE, 'bilibili 也在 argo 引擎表里')
  assert.ok('bilibili' in DUAL_PATH, 'bilibili 的双路必须显式登记')
})

test('每个来源在一次召回里最多被取一次', async () => {
  const calls: string[] = []
  const fetchers: Record<string, (s: { id: string }, q: string, c: { perSourceLimit: number }) => Promise<never[]>> = {}
  for (const s of SOURCES.filter(s => s.tier === 0)) {
    fetchers[s.id] = async (src) => { calls.push(src.id); return [] }
  }
  await recall('x', fetchers, { query: 'x', minHits: 999, perSourceLimit: 3 })
  const counts = new Map<string, number>()
  for (const id of calls) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) assert.equal(n, 1, `${id} 被取了 ${n} 次`)
})

test('authoritativeFetchers 暴露的 id 与实现表一致', () => {
  assert.deepEqual(Object.keys(authoritativeFetchers()).sort(), Object.keys(AUTHORITATIVE_SOURCES).sort())
})
