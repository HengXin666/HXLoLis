import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  crossrefSearch, arxivSearch, githubSearch, wikipediaSearch,
  hackernewsSearch, pubmedSearch, openalexSearch, authoritativeFetchers,
  AUTHORITATIVE_SOURCES, type HttpFetch,
} from '../src/authoritative.ts'
import {
  mdnSearch, ietfSearch, npmSearch, stackexchangeSearch, juejinSearch,
  extractRfcNumbers, stripRfcNumbers,
} from '../src/authoritative-tech.ts'
import { SOURCES } from '../src/recall.ts'
import { AdapterError } from '../src/adapters/adapter.ts'

/** 用采集自线上的真实响应做夹具。 */
const fx = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const okFetch = (body: string): HttpFetch => async () => ({ ok: true, status: 200, text: async () => body })
const failFetch = (status: number): HttpFetch => async () => ({ ok: false, status, text: async () => '' })

// ── RFC 编号精确查找: 持久标识符最纯粹的用法 ──────────────────

test('从查询里抽出 RFC 编号', () => {
  assert.deepEqual(extractRfcNumbers('RFC 9110 是什么'), ['9110'])
  assert.deepEqual(extractRfcNumbers('rfc8446'), ['8446'])
  assert.deepEqual(extractRfcNumbers('RFC-9110 与 RFC 8446 的关系'), ['9110', '8446'])
  assert.deepEqual(extractRfcNumbers('HTTP 语义'), [], '没有编号就不该编一个出来')
})

test('抽出编号后要剥掉疑问词，否则标题检索永远 0 条', () => {
  // 实测: 「RFC 9110 是什么」原样送 title__icontains 返回 0 条  标题里没有"是什么"
  assert.equal(stripRfcNumbers('RFC 9110 是什么'), '')
  assert.equal(stripRfcNumbers('RFC 9110 HTTP'), 'HTTP')
  assert.equal(stripRfcNumbers('HTTP 语义标准'), 'HTTP 语义标准')
})

test('RFC 编号走精确查找，不靠检索排序', async () => {
  const fetch: HttpFetch = async (url) => {
    assert.ok(url.includes('rfc-editor.org/rfc/rfc9110.json'), '必须直接取编号对应的文档')
    return { ok: true, status: 200, text: async () => JSON.stringify({ doc_id: 'RFC9110', title: 'HTTP Semantics', pub_status: 'INTERNET STANDARD', pub_date: '2022-06-01' }) }
  }
  const hits = await ietfSearch(fetch)('RFC 9110 是什么', 3)
  assert.equal(hits[0]!.title, 'RFC 9110: HTTP Semantics')
  assert.equal(hits[0]!.identity, 'ietf:rfc9110')
  assert.equal(hits[0]!.publisher, 'RFC Editor')
})

test('不存在的 RFC 编号是**合理的空结果**，不是"接口坏了"  但其它错误必须响亮', async () => {
  const notFound: HttpFetch = async () => ({ ok: false, status: 404, text: async () => '' })
  assert.deepEqual(await ietfSearch(notFound)('RFC 99999 是什么', 3), [],
    '对具体文档的 404 = 这个编号不存在（合理的空），必须与接口故障区分')
  const broken: HttpFetch = async () => ({ ok: false, status: 503, text: async () => '' })
  await assert.rejects(() => ietfSearch(broken)('RFC 9110 是什么', 3),
    '503 是接口故障，不许伪装成"没有这份文档"')
})

test('RFC 编号与标题检索可以叠加  编号精确命中在前', async () => {
  const fetch: HttpFetch = async (url) => {
    if (url.includes('rfc-editor.org')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ title: 'HTTP Semantics', pub_status: 'INTERNET STANDARD' }) }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ objects: [{ name: 'draft-x', title: 'HTTP 扩展', rfc: null }] }) }
  }
  const hits = await ietfSearch(fetch)('RFC 9110 HTTP', 3)
  assert.equal(hits[0]!.identity, 'ietf:rfc9110', '精确命中必须排在标题检索结果之前')
  assert.ok(hits.length >= 2)
})

test('登记为第 0 层的每个来源都必须有实现  声明与实现不允许脱节', () => {
  // 直接用**实际导出的实现表**做判据，而不是手抄一份名单 
  // 手抄的名单会随实现漂移，那正是这条测试要防的
  const implemented = new Set(Object.keys(AUTHORITATIVE_SOURCES))
  for (const s of SOURCES.filter(s => s.tier === 0)) {
    assert.ok(implemented.has(s.id), `第 0 层的 ${s.id} 登记了却没有实现`)
  }
  // 反向：有实现却没登记层级，同样不允许（会让它永远不会被召回）
  for (const id of implemented) {
    assert.ok(SOURCES.some(s => s.id === id), `${id} 有实现却没有登记层级`)
  }
})

test('新增的技术/中文来源都产出了带标识符的结果', async () => {
  const cases: Array<[string, () => Promise<Array<{ identity?: string; sourceId: string }>>]> = [
    ['mdn', () => mdnSearch(okFetch(fx('mdn.json')))('scope', 2)],
    ['ietf', () => ietfSearch(okFetch(fx('ietf.json')))('protocol', 2)],
    ['npm', () => npmSearch(okFetch(fx('npm.json')))('protocol', 2)],
    ['stackexchange', () => stackexchangeSearch(okFetch(fx('stackexchange.json')))('protocol', 2)],
    ['juejin', () => juejinSearch(okFetch(fx('juejin.json')))('protocol', 2)],
  ]
  for (const [name, run] of cases) {
    const hits = await run()
    assert.ok(hits.length > 0, `${name} 应当解析出结果`)
    assert.ok(hits[0]!.identity !== undefined, `${name} 的结果必须带持久标识符`)
  }
})

test('掘金: err_no ≠ 0 是失败而不是空结果', async () => {
  await assert.rejects(
    () => juejinSearch(okFetch('{"err_no":400,"err_msg":"bad"}'))('x', 2),
    (e: unknown) => e instanceof AdapterError && e.kind === 'api',
  )
})

test('IETF: RFC 编号与 Internet-Draft 被区分开（前者才是标准）', async () => {
  const hits = await ietfSearch(okFetch(`{"objects":[
    {"name":"rfc9110","title":"HTTP Semantics","rfc":"9110","std_level":"ps","time":"2022-06-01T00:00:00Z"},
    {"name":"draft-ietf-x-00","title":"Some Draft","rfc":null,"std_level":null,"time":"2024-01-01T00:00:00Z"}]}`))('x', 2)
  assert.match(hits[0]!.url, /rfc-editor\.org\/rfc\/rfc9110/)
  assert.match(hits[0]!.identity!, /^ietf:rfc9110$/)
  assert.match(hits[1]!.url, /datatracker\.ietf\.org\/doc\/draft-ietf-x-00/)
  assert.ok(hits[1]!.snippet!.includes('Internet-Draft'), '草稿不能被包装成标准')
})

test('Crossref: 真实响应解析出 DOI 作为身份', async () => {
  const hits = await crossrefSearch(okFetch(fx('crossref.json')))('transformer', 2)
  assert.ok(hits.length >= 1)
  assert.equal(hits[0]!.sourceId, 'crossref')
  assert.match(hits[0]!.identity ?? '', /^doi:/)
  assert.ok(hits[0]!.title.length > 0)
})

test('arXiv: Atom XML 被解析成带 arXiv 标识符的条目', async () => {
  const hits = await arxivSearch(okFetch(fx('arxiv.xml')))('protocol', 2)
  assert.ok(hits.length >= 1)
  assert.match(hits[0]!.identity ?? '', /^arxiv:/)
  assert.equal(hits[0]!.publisher, 'arXiv')
})

test('GitHub: 仓库 full_name 作为身份', async () => {
  const hits = await githubSearch(okFetch(fx('github.json')))('protocol', 2)
  assert.ok(hits.length >= 1)
  assert.match(hits[0]!.identity ?? '', /^github:/)
})

test('Wikipedia: pageid 作为身份，摘要里的高亮标签被清掉', async () => {
  const hits = await wikipediaSearch(okFetch(fx('wikipedia.json')))('协议', 2)
  assert.ok(hits.length >= 1)
  assert.match(hits[0]!.identity ?? '', /^wikipedia:zh:/)
  assert.equal(hits[0]!.snippet!.includes('<'), false)
})

test('Hacker News: objectID 作为身份（可长期引用）', async () => {
  const hits = await hackernewsSearch(okFetch(fx('hackernews.json')))('protocol', 2)
  assert.ok(hits.length >= 1)
  assert.match(hits[0]!.identity ?? '', /^hn:/)
})

test('PubMed: 标题必须是 esummary 给的真实标题，不许退回 id', async () => {
  // 这条契约**被实测推翻过**: 早先的实现只发 esearch，把 title 设成「PubMed <id>」，
  // 理由是省一次请求。覆盖度判据落地后这被证明是错的  标题里没有任何查询词，
  // 覆盖度对它永远是 0，用户看到的是一串 PubMed 24558651。
  // esummary 支持一次传多个 id，代价是「每次检索多 1 个请求」而非「每个 id 一个」。
  const fetch: HttpFetch = async (url) => {
    if (url.includes('esearch')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { idlist: ['24558651', '25191335'] } }) }
    }
    assert.ok(url.includes('esummary'), '必须用 esummary 取真实标题')
    assert.ok(url.includes('24558651,25191335'), '多个 id 必须一次批量取，不许逐个请求')
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          result: {
            '24558651': { title: 'Rust fungi and global change.', pubdate: '2014 Feb', source: 'New Phytol', articleids: [{ idtype: 'doi', value: '10.1111/nph.12570' }] },
            '25191335': { title: 'Effector proteins of rust fungi.', pubdate: '2014', source: 'Front Plant Sci' },
          },
        }),
    }
  }
  const hits = await pubmedSearch(fetch)('protocol', 2)
  assert.equal(hits.length, 2)
  assert.equal(hits[0]!.title, 'Rust fungi and global change.', '标题来自 esummary，不是 id')
  assert.equal(hits[0]!.identity, 'pmid:24558651', '标识符不受标题改动影响')
  assert.equal(hits[0]!.publisher, 'New Phytol')
  assert.ok(hits[0]!.snippet?.includes('doi:10.1111/nph.12570'))
})

test('PubMed: 拿不到摘要时退回 id 作标题，但不丢这条结果', async () => {
  const fetch: HttpFetch = async (url) => {
    if (url.includes('esearch')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { idlist: ['999'] } }) }
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ result: {} }) }
  }
  const hits = await pubmedSearch(fetch)('x', 1)
  assert.equal(hits.length, 1, '摘要缺失是降级，不是丢弃')
  assert.equal(hits[0]!.title, 'PubMed 999')
})

test('PubMed: esearch 返回 0 条时不再发第二次请求', async () => {
  let calls = 0
  const fetch: HttpFetch = async () => {
    calls++
    return { ok: true, status: 200, text: async () => JSON.stringify({ esearchresult: { idlist: [] } }) }
  }
  assert.deepEqual(await pubmedSearch(fetch)('zzzz', 3), [])
  assert.equal(calls, 1, '没有 id 就不要白发一次摘要请求')
})

test('OpenAlex: 请求 URL 必须带 mailto（不带会 429）', async () => {
  let seen = ''
  const spy: HttpFetch = async (u) => { seen = u; return { ok: true, status: 200, text: async () => fx('openalex.json') } }
  await openalexSearch(spy)('protocol', 2)
  assert.ok(seen.includes('mailto='), 'OpenAlex 不带 mailto 会返回 429，这是实测约束')
})

test('失败契约: HTTP 失败与坏 JSON 都必须抛错，绝不返回空数组', async () => {
  await assert.rejects(
    () => crossrefSearch(failFetch(503))('x', 2),
    (e: unknown) => e instanceof AdapterError && e.kind === 'http',
  )
  await assert.rejects(
    () => crossrefSearch(okFetch('not json'))('x', 2),
    (e: unknown) => e instanceof AdapterError && e.kind === 'parse',
  )
  await assert.rejects(
    () => crossrefSearch(async () => { throw new Error('socket hang up') })('x', 2),
    (e: unknown) => e instanceof AdapterError && e.kind === 'network',
  )
})

test('空结果是合法结果  与失败严格区分', async () => {
  const empty = await crossrefSearch(okFetch('{"message":{"items":[]}}'))('x', 2)
  assert.deepEqual(empty, [], '真跑过且确实没内容 → 空数组')
})

test('authoritativeFetchers 的签名能被 recall 直接使用', async () => {
  const f = authoritativeFetchers({ fake: async (q, n) => [{ sourceId: 'fake', title: q, url: 'u' }] })
  const hits = await f.fake!({ id: 'fake' }, 'q', { perSourceLimit: 1 })
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.title, 'q')
})

// ── 限流不是故障（2026-09-18 读 argo 配额感知后加）──────────────

test('403/429 的报错必须能被人认出是限流，不是服务故障', async () => {
  const { githubSearch } = await import('../src/authoritative.ts')
  const fake = async () => ({ ok: false, status: 403, text: async () => '' })
  await assert.rejects(
    () => githubSearch(fake as never)('x', 3),
    (err) => {
      const m = String(err.message)
      assert.match(m, /403/)
      assert.match(m, /限流|配额/, '必须点明是配额问题  否则用户会以为源坏了')
      return true
    },
  )
})

test('真故障（500）不许被说成限流', async () => {
  const { githubSearch } = await import('../src/authoritative.ts')
  const fake = async () => ({ ok: false, status: 500, text: async () => '' })
  await assert.rejects(
    () => githubSearch(fake as never)('x', 3),
    (err) => {
      assert.match(String(err.message), /500/)
      assert.doesNotMatch(String(err.message), /限流|配额/, '5xx 是服务端故障，不能误导成配额')
      return true
    },
  )
})
