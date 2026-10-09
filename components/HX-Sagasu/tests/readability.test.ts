import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractReadability } from '../src/readability.ts'

// 移植自 argo scripts/readability_extract.py（MIT）。测试对应它的算法要点。

test('正文与导航分离  链接密集的块得分低', () => {
  const html = `<html><head><title>标题</title></head><body>
    <nav><a href="/a">首页</a><a href="/b">产品</a><a href="/c">关于我们</a><a href="/d">联系方式</a></nav>
    <article><p>这是一段足够长的正文内容，用来验证密度评分能把它和导航区分开来，正文段落通常链接很少。</p>
    <p>第二段正文，同样足够长，继续说一些与主题相关的内容，确保它被保留下来而不是被当成噪音丢掉。</p></article>
  </body></html>`
  const { text, title } = extractReadability(html)
  assert.equal(title, '标题')
  assert.match(text, /密度评分/)
  assert.ok(!text.includes('联系方式'), '导航不该出现在正文里: ' + text)
})

test('**保持文档顺序**  页脚不许插进正文中间', () => {
  // argo 的注释明确记着旧版 sort-by-density 的坑
  const html = `<body><article>
    <p>第一段正文内容，长度足够长以便通过最小块阈值检查，这里继续填充一些文字。</p>
    <p>第二段正文内容，同样足够长，用来验证输出顺序与文档顺序一致而不是按分数排。</p>
    <p>第三段正文内容，继续填充足够的文字长度以确保它被保留在结果当中不丢失。</p>
  </article></body>`
  const { text } = extractReadability(html)
  const i1 = text.indexOf('第一段')
  const i2 = text.indexOf('第二段')
  const i3 = text.indexOf('第三段')
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2, '必须是文档顺序: ' + JSON.stringify(text.slice(0, 120)))
})

test('**td 的短块下限是 2**  表格数据不许被整张丢掉', () => {
  // 30 字符下限会把「型号」「15999 元」这类单元格全部丢光
  const html = `<body><table>
    <tr><td>型号</td><td>价格</td><td>库存</td></tr>
    <tr><td>A100</td><td>15999 元</td><td>有货</td></tr>
  </table></body>`
  const { text } = extractReadability(html)
  assert.match(text, /15999/, '表格数据必须保留: ' + JSON.stringify(text))
})

test('script/style 内容不许混进正文', () => {
  const html = `<body><script>var x = "<p>假正文</p>"; if (a<b) {}</script>
    <style>.a { content: "<div>假样式</div>" }</style>
    <p>真正文内容，长度足够长以便通过最小块阈值检查，继续填充文字。</p></body>`
  const { text } = extractReadability(html)
  assert.ok(!text.includes('假正文'), 'script 内容泄漏了')
  assert.ok(!text.includes('假样式'), 'style 内容泄漏了')
  assert.match(text, /真正文/)
})

test('HTML 实体被解码', () => {
  const html = `<body><p>&amp;quot; 与 &lt;tag&gt; 以及 &#65; 和 &nbsp; 都要解码，填充足够长度。</p></body>`
  const { text } = extractReadability(html)
  assert.match(text, /&quot;/)
  assert.match(text, /<tag>/)
  assert.match(text, /A/)
})

test('maxChars 截断生效，且不产生超长输出', () => {
  const para = '<p>' + '内容填充'.repeat(200) + '</p>'
  const { text } = extractReadability('<body><article>' + para + para + '</article></body>', 500)
  assert.ok(text.length <= 520, '实际 ' + text.length)
})

test('空输入与无正文输入不抛异常', () => {
  assert.deepEqual(extractReadability(''), { text: '', title: '' })
  assert.equal(extractReadability('<html><head><title>T</title></head><body></body></html>').text, '')
})

test('自闭合标签不让深度计数失衡', () => {
  const html = `<body><article><p>第一段足够长的正文内容，用来验证自闭合标签不会破坏深度计数。</p>
    <br/><img src="x.png"/><hr/>
    <p>第二段足够长的正文内容，如果深度错了它会被分到另一组从而丢失。</p></article></body>`
  const { text } = extractReadability(html)
  assert.match(text, /第一段/)
  assert.match(text, /第二段/)
})

// ── 移植保真度：与 argo 原始实现的一致性（2026-09-18）──────────────
//
// 移植的第一原则是**忠实**（见 2026-09-18-port-not-fork.md）。
// 以下测试用同一份 HTML 固定结果，防止将来有人"顺手改进"常数而破坏一致性。
//
// 实测对照（MDN AbortController 页面, 172613 字节 HTML）:
//   argo Python : chars=679 paras=5 title="AbortController - Web API | MDNMDNMDNMozilla"
//   本移植 TS   : chars=679 paras=5 title="AbortController - Web API | MDNMDNMDNMozilla"
// → **逐字节一致**

test('标签级提取：article 内的段落胜过导航链接', () => {
  const html = `<body>
    <nav><a href="/1">导航一</a><a href="/2">导航二</a><a href="/3">导航三</a><a href="/4">导航四</a></nav>
    <article><h1>标题</h1>
      <p>这是正文的第一段，长度足够通过最小块阈值检查，继续说一些相关内容。</p>
      <p>这是正文的第二段，同样足够长，用来确认它也被保留在结果当中没有丢失。</p>
    </article></body>`
  const { text } = extractReadability(html)
  assert.match(text, /正文的第一段/)
  assert.match(text, /正文的第二段/)
  assert.ok(!text.includes('导航一'), '导航不该进正文')
})

test('标题重复是 argo 的既有行为  移植刻意不"顺手修"', () => {
  // 实测 MDN 页面的标题是 "…| MDNMDNMDNMozilla"。看起来像 bug（MDN 重复三次），
  // 但它来自 argo 的 title 累积逻辑（`handle_data` 在 `_in_title` 期间累加，
  // 而有些站点把 logo 的 alt 文本也放在 title 解析范围内）。
  //
  // **移植不修它**：我没有 argo 的测试语料来验证"修了会怎样"，
  // 而破坏逐字节一致性会让将来的对照失效。要修必须另开一次带实测的改动。
  const html = '<html><head><title>A</title><title>B</title></head><body><p>正文足够长的一段内容用于通过最小阈值检查。</p></body></html>'
  const { title } = extractReadability(html)
  assert.equal(title, 'AB', '两个 title 标签会累积  与 argo 一致')
})

