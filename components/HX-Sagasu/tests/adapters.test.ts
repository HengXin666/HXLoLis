import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { makeBilibiliAdapter, flattenReplies, type BiliFetcher, type BiliReply } from '../src/adapters/bilibili.ts'
import { makeTelegramAdapter, parseChannelPage, stripHtml, type TgFetcher } from '../src/adapters/telegram.ts'
import { AdapterError, isUnavailable } from '../src/adapters/adapter.ts'
import { normalizeThread } from '../src/thread.ts'

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

function biliFetch(routes: Record<string, unknown>): BiliFetcher {
  return async (url) => {
    for (const [frag, body] of Object.entries(routes)) {
      if (url.includes(frag)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

test('B站: 真实响应的搜索能被解析（用采集自线上的夹具）', async () => {
  const a = makeBilibiliAdapter({ fetch: biliFetch({ 'search/all/v2': fx('bilibili-search.json') }) })
  const hits = await a.search('原神', { limit: 2 })
  assert.ok(hits.length >= 1)
  assert.equal(hits[0]!.platform, 'bilibili')
  assert.match(hits[0]!.url, /^https:\/\/www\.bilibili\.com\/video\/BV/)
  // 标题里的 <em class="keyword"> 高亮标签必须被清掉
  assert.equal(hits[0]!.title.includes('<'), false)
})

test('B站: 楼中楼被展平，父子关系与引用链来自平台（不是推断）', () => {
  const fixtures = fx('bilibili-replies.json') as { data: { replies: BiliReply[] } }
  const turns = flattenReplies(fixtures.data.replies, true)
  assert.ok(turns.length > fixtures.data.replies.length, '楼中楼必须被展开成独立楼层')
  const nested = turns.filter(t => t.parentId !== undefined)
  assert.ok(nested.length > 0, '夹具里应当有楼中楼')
  // 平台给的引用 = 事实, 绝不能标成推断
  assert.equal(nested[0]!.quotedTurnId !== undefined, true)
  const { thread } = normalizeThread({
    id: 'BV1', platform: 'bilibili', createdAt: 1,
    provenance: { kind: 'api', endpoint: 'x' }, turns,
  })
  assert.equal(thread.turns.some(t => t.quoteInferred === true), false,
    '来自平台的引用链不允许被标成 inferred')
})

test('B站: 关闭楼中楼时只保留顶层', () => {
  const fixtures = fx('bilibili-replies.json') as { data: { replies: BiliReply[] } }
  const flat = flattenReplies(fixtures.data.replies, false)
  assert.equal(flat.length, fixtures.data.replies.length)
})

test('B站: 风控码被判为 blocked，而不是"没有评论"', async () => {
  const a = makeBilibiliAdapter({ fetch: biliFetch({ 'x/v2/reply': { code: -412, message: '请求被拦截' } }) })
  await assert.rejects(
    () => a.thread('117257220919432', {}),
    (err: unknown) => err instanceof AdapterError && err.kind === 'blocked',
  )
})

test('B站: HTTP 失败抛 http 类错误（失败必须响亮）', async () => {
  const a = makeBilibiliAdapter({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) })
  await assert.rejects(() => a.thread('123', {}), (err: unknown) => err instanceof AdapterError && err.kind === 'http')
})

test('B站: bvid 会被解析成 aid 再取评论', async () => {
  const routes = {
    'x/web-interface/view': { code: 0, data: { aid: 999 } },
    'x/v2/reply': { code: 0, data: { replies: [] } },
  }
  const seen: string[] = []
  const base = biliFetch(routes)
  const a = makeBilibiliAdapter({
    fetch: async (u) => { seen.push(u); return base(u) },
  })
  await a.thread('BV1NVuC6dE95', {})
  assert.ok(seen.some(u => u.includes('bvid=BV1NVuC6dE95')))
  assert.ok(seen.some(u => u.includes('oid=999')), '评论请求必须用解析出来的 aid')
})

test('B站: 适配器不产 normalizedText  归一化只有一处实现', async () => {
  const a = makeBilibiliAdapter({ fetch: biliFetch({ 'x/v2/reply': fx('bilibili-replies.json') }) })
  const raw = await a.thread('117257220919432', {})
  for (const t of raw.turns) {
    assert.equal('normalizedText' in t, false, '适配器只取回结构，归一化归 L1')
  }
})

// ── Telegram ─────────────────────────────────────────────

test('Telegram: 真实频道页能被解析出消息', () => {
  const html = JSON.stringify(fx('telegram-channel.json'))
  const payload = fx('telegram-channel.json') as { messages: Array<{ post: string; html: string }> }
  assert.ok(payload.messages.length > 0)
  // 用页面原文重新解析（夹具存的是抽取后的 html 片段，这里验证抽取逻辑本身）
  const fake = payload.messages
    .map(m => `<div data-post="${m.post}"><div class="tgme_widget_message_text js-message_text">${m.html}</div><time datetime="2026-06-15T18:58:13+00:00"></time></div>`)
    .join('')
  const msgs = parseChannelPage(fake, 'durov')
  assert.equal(msgs.length, payload.messages.length)
  assert.match(msgs[0]!.post, /^durov\//)
  assert.equal(msgs[0]!.text.includes('<'), false, '正文必须去掉 HTML 标签')
  assert.equal(typeof html, 'string')
})

test('Telegram: 频道不存在与页面结构变化被区分开（两者都不是空数组）', () => {
  const notFound = '<html><div class="tgme_page_icon"></div><div class="tgme_page_title">If you have Telegram</div></html>'
  assert.throws(() => parseChannelPage(notFound, 'nope'), /不存在或不可公开访问/)
  const changed = '<html><body>completely different markup</body></html>'
  assert.throws(() => parseChannelPage(changed, 'x'), /可能改了 HTML/)
})

test('Telegram: 只有频道页但确实没有消息时才返回空', () => {
  const emptyChannel = '<html><div class="tgme_channel_info">频道</div></html>'
  assert.deepEqual(parseChannelPage(emptyChannel, 'quiet'), [], '真跑过且确实没消息 → 空数组，这是合法结果')
})

// ── Telegram 频道内搜索（2026-09-16 实测更正）──────────────────────
//
// 本文件此前断言 search 必须 `unsupported`，理由是"公开频道页没有搜索能力"。
// **那个理由是未实测的假设，且已被推翻**: t.me/s/<channel>?q=<term> 是服务端过滤，
// 实测 "telegram" 20/20 命中、"zzzznotfoundterm" 0 条、post id 与不带 q 时不同。
// 所以旧测试断言的**不是**"我们不能伪造搜索"，而是"我们坚信不存在搜索" 
// 前者是契约，后者是未经验证的信仰。删掉信仰，留下契约。

test('Telegram: 频道内搜索真的工作（用真实响应的夹具，不是构造的）', async () => {
  const html = readFileSync(new URL('./fixtures/telegram-search.html', import.meta.url), 'utf8')
  const a = makeTelegramAdapter({ fetch: async () => ({ ok: true, status: 200, text: async () => html }) })
  const hits = await a.search('durov telegram', { limit: 5 })
  assert.ok(hits.length >= 1, '频道内搜索必须返回命中')
  assert.equal(hits[0]!.platform, 'telegram')
  assert.ok(hits[0]!.url.startsWith('https://t.me/durov/'), 'url 必须指向具体帖子: ' + hits[0]!.url)
  assert.equal(a.capabilities.search, true)
})

test('Telegram: 纯关键词必须显式拒绝并说明平台边界（没有全站搜索）', async () => {
  const a = makeTelegramAdapter({ fetch: async () => ({ ok: true, status: 200, text: async () => '' }) })
  await assert.rejects(() => a.search('Rust 所有权', {}), (err: unknown) => {
    assert.ok(err instanceof AdapterError, '必须是 AdapterError 而不是静默失败')
    assert.equal(err.kind, 'unsupported')
    // 错误信息必须告诉调用方**怎么写才对**，否则它只是一个拒绝
    assert.match(err.message, /频道/)
    return true
  })
})

test('Telegram: 0 条命中是合法的空数组（搜了、真的没有）', async () => {
  // 实测: ?q=zzzznotfoundterm 返回 200、18710 字节、仍含 tgme_widget_message 结构。
  // 它**能**与"频道不存在"区分，所以"没有结果"可以诚实地是 []。
  const empty = '<div class="tgme_channel_info"></div>'
  const a = makeTelegramAdapter({ fetch: async () => ({ ok: true, status: 200, text: async () => empty }) })
  assert.deepEqual(await a.search('durov zzzz', {}), [])
})

test('Telegram: 适配器返回的结构可以直接进 L1 归一化', async () => {
  const payload = fx('telegram-channel.json') as { messages: Array<{ post: string; html: string }> }
  const fake = payload.messages
    .map(m => `<div data-post="${m.post}"><div class="tgme_widget_message_text">${m.html}</div><time datetime="2026-06-15T18:58:13+00:00"></time></div>`)
    .join('')
  const fetcher: TgFetcher = async () => ({ ok: true, status: 200, text: async () => fake })
  const a = makeTelegramAdapter({ fetch: fetcher })
  const raw = await a.thread('durov', {})
  const { thread } = normalizeThread(raw)
  assert.ok(thread.turns.length > 0)
  assert.equal(thread.platform, 'telegram')
  assert.ok(thread.turns.every(t => t.text.length > 0))
  assert.equal(thread.turns[0]!.timestamp !== undefined, true, 'datetime 必须被解析成时间戳')
})

test('stripHtml 处理 Telegram 正文里的换行与实体', () => {
  assert.equal(stripHtml('第一行<br>第二行'), '第一行\n第二行')
  assert.equal(stripHtml('a &amp; b &lt;c&gt;'), 'a & b <c>')
})

test('stripHtml 丢掉截断留下的标签残片  残片混进正文就会变成"证据"', () => {
  // 我们对超长正文做截断，所以这是真实会发生的形态（线上抓取时实测遇到过）
  const truncated = '正文最后一句话<tg-emoji emoji-id="5307819226910700816"><i class="emoji" style="back'
  const out = stripHtml(truncated)
  assert.equal(out, '正文最后一句话')
  assert.equal(out.includes('<'), false)
  // 正常闭合的标签不受影响
  assert.equal(stripHtml('前<tg-emoji emoji-id="1">😀</tg-emoji>后'), '前😀后')
})

test('失败分类能被上层用于四态判定', () => {
  assert.equal(isUnavailable(new AdapterError('bilibili', 'blocked', 'x')), true)
  assert.equal(isUnavailable(new AdapterError('telegram', 'unsupported', 'x')), false, '不支持 ≠ 不可用')
  assert.equal(isUnavailable(new Error('random')), false)
})
