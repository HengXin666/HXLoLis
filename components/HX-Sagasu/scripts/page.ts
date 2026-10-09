/**
 * 界面本体  原生 HTML/CSS/JS，一段模板字符串。
 *
 * 单独成文件而不是内联进 serve.ts: 它是**显示逻辑**，与服务端职责无关，
 * 而且这样改样式不需要碰任何服务端代码。
 *
 * 配色与字体系统无关（不引任何 CDN） 本机可用即可，**离线也能跑**。
 
 * .agents/notes/implemented/architecture/2026-09-17-coverage-count-must-rank.md
 * .agents/notes/implemented/architecture/2026-09-18-learning-from-argo.md
 * .agents/notes/implemented/architecture/2026-09-18-platform-visibility.md
 * .agents/notes/implemented/architecture/2026-09-18-thread-on-ui.md
 * .agents/notes/implemented/architecture/2026-09-19-dead-event-wired.md
 */
export const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HX-Sagasu 分层检索</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --line: #30363d; --fg: #e6edf3;
    --dim: #8b949e; --accent: #58a6ff; --ok: #3fb950; --bad: #f85149; --warn: #d29922;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.6 ui-sans-serif, -apple-system, "Segoe UI", "Noto Sans CJK SC", sans-serif; }
  header { padding: 20px 24px 12px; border-bottom: 1px solid var(--line); position: sticky; top: 0;
    background: rgba(13,17,23,.92); backdrop-filter: blur(8px); z-index: 10; }
  h1 { margin: 0 0 4px; font-size: 17px; font-weight: 600; letter-spacing: .3px; }
  .sub { color: var(--dim); font-size: 12px; }
  form { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
  input, select, button { font: inherit; border-radius: 6px; border: 1px solid var(--line);
    background: var(--panel); color: var(--fg); padding: 8px 12px; }
  input[name=q] { flex: 1 1 320px; min-width: 0; }
  button { background: var(--accent); color: #04121f; border-color: transparent; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  main { padding: 16px 24px 64px; max-width: 1100px; margin: 0 auto; }
  .tier { border: 1px solid var(--line); border-radius: 10px; margin-bottom: 12px;
    background: var(--panel); overflow: hidden; transition: border-color .3s; }
  .tier.active { border-color: var(--accent); }
  .tier-head { padding: 10px 14px; display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid var(--line); font-weight: 600; }
  .tier-body { padding: 8px 14px 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dim); flex: none; }
  .tier.active .dot { background: var(--accent); animation: pulse 1s infinite; }
  .tier.done .dot { background: var(--ok); }
  .tier.skip .dot { background: var(--warn); }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
  .src { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px;
    animation: slide .35s ease-out; }
  @keyframes slide { from { opacity: 0; transform: translateX(-6px) } to { opacity: 1; transform: none } }
  .src .name { color: var(--fg); min-width: 132px; }
  .src.pending .name { color: var(--dim); }
  .src .ms { color: var(--dim); font-size: 12px; }
  .src .badge { font-size: 11px; padding: 1px 7px; border-radius: 99px; border: 1px solid var(--line); }
  .badge.ok { color: var(--ok); border-color: var(--ok); }
  .badge.bad { color: var(--bad); border-color: var(--bad); }
  .badge.na { color: var(--warn); border-color: var(--warn); }
  .reason { color: var(--dim); font-size: 12px; padding: 6px 0 0; }
  .hits { margin-top: 4px; }
  .hit { padding: 10px 0; border-top: 1px solid var(--line); animation: fade .4s ease-out; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
  .hit .t { color: var(--accent); text-decoration: none; font-weight: 600; }
  .hit .t:hover { text-decoration: underline; }
  .hit .u { color: var(--dim); font-size: 12px; word-break: break-all; }
  .hit .s { color: var(--fg); opacity: .82; font-size: 13px; margin-top: 3px; }
  .sig { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .sig span { font-size: 11px; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--line); }
  .sig span.pass { color: var(--ok); border-color: rgba(63,185,80,.4) }
  .sig span.fail { color: var(--bad); border-color: rgba(248,81,73,.4) }
  .verdict { margin: 14px 0; padding: 12px 14px; border-radius: 10px; background: var(--panel);
    border: 1px solid var(--line); font-size: 13px; }
  .verdict b { color: var(--accent); }
  .empty { color: var(--dim); font-size: 12px; padding: 3px 0; }
.blk { font-size: 11px; color: #8b949e; margin: 2px 0 3px; }
.blk i { color: #6e7681; font-style: normal; }
.blk.empty { color: #6e7681; }

.plat-head { font-size: 12px; color: #8b949e; margin: 10px 0 6px; }
.plat-head b { color: #e6edf3; }
.plat-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 6px; }
.plat { border: 1px solid #30363d; border-radius: 6px; padding: 6px 8px; font-size: 11px; }
.plat.ok { border-color: #238636; }
.plat.no { opacity: .72; }
.pname { color: #e6edf3; margin-right: 6px; }
.pstate { color: #8b949e; font-size: 10px; }
.pev { color: #6e7681; margin-top: 3px; line-height: 1.35; }
.pun { color: #d29922; margin-top: 3px; line-height: 1.35; }

#thread { margin-top: 14px; }
.thread-form { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.thread-form input { flex: 1 1 160px; min-width: 120px; }
.thread-form input.narrow { flex: 0 0 90px; min-width: 70px; }
.tmeta { font-size: 11px; color: #8b949e; margin-bottom: 6px; }
.turns { max-height: 320px; overflow: auto; border: 1px solid #30363d; border-radius: 6px; padding: 4px 8px; }
.turn { font-size: 12px; padding: 3px 0; border-bottom: 1px solid #21262d; }
.turn.op { background: rgba(35,134,54,.08); }
.tidx { color: #6e7681; margin-right: 6px; font-size: 11px; }
.tauth { color: #58a6ff; margin-right: 6px; }
.tauth i { color: #3fb950; font-style: normal; font-size: 10px; }
.ttxt { color: #c9d1d9; display: inline; }
.tans { margin-top: 8px; font-size: 13px; color: #e6edf3; }
.ttgt { margin-top: 6px; padding: 6px 8px; border-left: 3px solid #3fb950; background: rgba(63,185,80,.06); font-size: 12px; }
.tamb { margin-top: 6px; padding: 6px 8px; border-left: 3px solid #d29922; background: rgba(210,153,34,.08); font-size: 12px; color: #d29922; }
.role { color: #8b949e; font-size: 11px; }
.conf { color: #6e7681; font-size: 11px; }
.why { color: #8b949e; font-size: 11px; margin-top: 2px; line-height: 1.4; }
.qt { color: #c9d1d9; margin: 3px 0 0 10px; font-size: 12px; border-left: 2px solid #30363d; padding-left: 6px; }
</style>
</head>
<body>
<header>
  <h1>HX-Sagasu 分层检索</h1>
  <div class="sub">第 0 层权威公域 → 第 1 层垂直社区 → 第 2 层搜索引擎兜底 · 进度为实际执行顺序，不是事后动画</div>
  <form id="f">
    <input name="q" placeholder="想查什么？例如：GPT 文生图 提示词怎么写" autocomplete="off" autofocus>
    <input name="scope" placeholder="作用域（如 Telegram 频道名）" style="flex:0 1 220px" autocomplete="off">
    <select name="tier"><option value="2">允许降到第 2 层</option><option value="1">最高第 1 层</option><option value="0">只查第 0 层</option></select>
    <button type="submit">检索</button>
  </form>
</header>
<main>
  <div id="out"><div class="empty">输入查询后回车。检索过程会逐步出现慢的来源是真的慢。</div></div>
  <div id="platforms"></div>
  <div id="thread">
    <div class="thread-form">
      <input id="tref" name="tref" placeholder="帖子引用，如 bilibili:BV1GJ411x7h7">
      <input id="task" name="task" placeholder="问帖子里的一句话，如 楼主后来改口了吗">
      <input id="tat" name="tat" class="narrow" placeholder="游标楼层">
      <button type="button" id="tgo">问帖</button>
    </div>
  </div>
</main>
<script>
const out = document.getElementById('out')
const form = document.getElementById('f')
const TIER_NAME = { 0: '第 0 层 · 权威公域', 1: '第 1 层 · 垂直社区', 2: '第 2 层 · 搜索引擎兜底' }
let es = null

function tierBox(tier) {
  let box = document.getElementById('t' + tier)
  if (box) return box
  box = document.createElement('section')
  box.className = 'tier'
  box.id = 't' + tier
  box.innerHTML = '<div class="tier-head"><span class="dot"></span><span>' + (TIER_NAME[tier] || ('第 ' + tier + ' 层')) +
    '</span><span class="ms" data-role="meta"></span></div><div class="tier-body"></div>'
  out.appendChild(box)
  return box
}
function body(box) { return box.querySelector('.tier-body') }
function meta(box, text) { box.querySelector('[data-role=meta]').textContent = text }

// startedAt = 这条来源**进入队列**的时刻（来自 source-started 事件）。
// 有它才能区分「慢」与「排队」 见 source-started 分支里的注释。
function addSource(tier, sourceId, state, detail, startedAt) {
  const box = tierBox(tier)
  const b = body(box)
  let row = b.querySelector('[data-src="' + sourceId + '"]')
  if (!row) {
    row = document.createElement('div')
    row.className = 'src pending'
    row.dataset.src = sourceId
    row.innerHTML = '<span class="dot" style="background:#484f58"></span><span class="name">' + sourceId + '</span><span data-role="st"></span>'
    b.appendChild(row)
  }
  const st = row.querySelector('[data-role=st]')
  if (state === 'pending') { st.innerHTML = '<span class="ms">查询中…</span>'; return }
  row.classList.remove('pending')
  const isFail = state !== 'ok'
  const cls = state === 'ok' ? 'ok' : (state === 'not-applicable' ? 'na' : 'bad')
  const label = state === 'ok' ? (detail.hits + ' 条') : (state === 'not-applicable' ? '不适用' : '失败')
  // **两个耗时并列显示**（见 source-started 分支的注释）:
  //   - elapsedMs 是**从这一层开始算**的（含排队）
  //   - waited 是**进入队列到落定**的墙钟差
  // 两者差距大 = 它在排队；差距小 = 它自己慢。**这是用户最想分清的一件事。**
  var timing = '' + detail.elapsedMs + 'ms'
  if (typeof startedAt === 'number') {
    var total = Date.now() - startedAt
    var queued = total - detail.elapsedMs
    // 只在意排队占大头的情形  否则这条附加信息会成为噪声
    timing = (queued > 1000 && queued > detail.elapsedMs)
      ? detail.elapsedMs + 'ms <span style="opacity:.6">(排队 ' + queued + 'ms)</span>'
      : detail.elapsedMs + 'ms'
  }
  st.innerHTML = '<span class="badge ' + cls + '">' + label + '</span> <span class="ms">' + timing + '</span>'
  if (isFail && detail.failure && detail.failure.message) {
    const r = document.createElement('div')
    r.className = 'reason'
    r.textContent = detail.failure.message.slice(0, 160)
    row.appendChild(r)
  }
}

function renderHits(hits) {
  let sec = document.getElementById('hits')
  if (sec) sec.remove()
  sec = document.createElement('section')
  sec.id = 'hits'
  sec.className = 'tier done'
  let html = '<div class="tier-head"><span class="dot"></span><span>命中 ' + hits.length + ' 条</span></div><div class="tier-body hits">'
  for (const h of hits) {
    const url = String(h.url || '')
    // **证据块标签**（2026-09-18 读 argo 后加）: 这条内容里到底有什么可被吸收的东西。
    // 读 argo 源码学到的一课  只显示"有/没有内容"看不出质量差异，
    // 要显示"有什么内容": 数字/定义/对比/步骤/披露。
    var blocks = ''
    var b = h.blocks
    if (b) {
      var tags = []
      if (b.hasNumbers) tags.push('数字')
      if (b.hasDefinition) tags.push('定义')
      if (b.hasComparison) tags.push('对比')
      if (b.hasHowto) tags.push('步骤')
      if (b.hasDisclosure) tags.push('披露')
      if (b.isQaFormat) tags.push('问答套壳')
      var d = Math.round(b.density * 100) / 100
      if (tags.length) blocks = '<div class="blk">证据块: ' + tags.join(' / ') + ' <i>密度 ' + d + '</i></div>'
      else blocks = '<div class="blk empty">无可吸收证据块 <i>密度 ' + d + '</i></div>'
    }
    html += '<div class="hit"><a class="t" href="' + url + '" target="_blank" rel="noopener">' +
      esc(String(h.title || '(无标题)')) + '</a><div class="u">[' + h.sourceId + '] ' + esc(url) + '</div>' +
      blocks +
      (h.snippet ? '<div class="s">' + esc(String(h.snippet).slice(0, 320)) + '</div>' : '') + '</div>'
  }
  sec.innerHTML = html + '</div>'
  out.appendChild(sec)
}

// ── 平台可用性面板（2026-09-18 加）────────────────────────────────
//
// **为什么它必须存在**: 目标的第 (2) 项是"支持私域/垂直社区平台接入"，
// 而当前的现实是 **12 个平台里 2 个可用**。这个事实此前**只写在代码注释里** 
// 于是界面上"这个平台搜不到"和"这个平台不可用"长得一模一样。
//
// **而它们是完全不同的两件事**: 前者是结果问题（换个词再试），
// 后者是能力问题（这条路我们没走通，且已经知道为什么）。
// 把后者画出来，人才不会把时间浪费在重走已经走过且失败的路上。
async function loadPlatforms() {
  const box = document.getElementById('platforms')
  if (!box) return
  let data
  try {
    const res = await fetch('/api/platforms')
    data = await res.json()
  } catch (e) {
    box.innerHTML = '<div class="plat-head">平台可用性: 读取失败（' + esc(String(e.message)) + '）</div>'
    return
  }
  const c = data.coverage || {}
  let html = '<div class="plat-head">平台可用性 <b>' + c.ready + '/' + c.total + '</b> 可用</div><div class="plat-list">'
  for (const p of (data.platforms || [])) {
    const cls = p.state === 'ready' ? 'ok' : 'no'
    // **证据与解锁条件一起显示**: 判定必须能追溯到某次测量，
    // 且必须写明接上它需要什么  否则下一个人只会重走一遍。
    html += '<div class="plat ' + cls + '">' +
      '<span class="pname">' + esc(p.label) + '</span>' +
      '<span class="pstate">' + esc(p.state) + '</span>' +
      '<div class="pev">' + esc(String(p.evidence).slice(0, 240)) + '</div>' +
      (p.unlock ? '<div class="pun">接上它需要: ' + esc(p.unlock) + '</div>' : '') +
      '</div>'
  }
  box.innerHTML = html + '</div>'
}


// ── 对话语义面板（2026-09-18 加）──────────────────────────────────
//
// **为什么要有它**: 目标第 (3) 项的四个子能力（错别字容错 / 帖子-回复结构 /
// 引用链 / 多轮上下文）此前**只在 CLI 上可用**。而界面是本项目唯一"让人看见"的地方 
// 平台可用性就是靠面板才变得可见的。
//
// **界面上要能看出三件事**:
//   1. 哪些楼层是楼主的（引用链的落点）
//   2. 提问解析到了谁、依据是什么（**依据要显示**，否则没法判断对错）
//   3. 没解析出来时**为什么** + 怎么消歧（"楼上"需要阅读游标）
async function loadThread() {
  const box = document.getElementById('thread')
  if (!box) return
  const ref = (document.getElementById('tref') || {}).value || ''
  const ask = (document.getElementById('task') || {}).value || ''
  const at = (document.getElementById('tat') || {}).value || ''
  if (!ref.includes(':')) {
    box.innerHTML = '<div class="reason">引用格式必须是 &lt;平台&gt;:&lt;id&gt;，如 bilibili:BV1GJ411x7h7</div>'
    return
  }
  box.innerHTML = '<div class="reason">读取中…</div>'
  const params = new URLSearchParams({ ref })
  if (ask !== '') params.set('ask', ask)
  if (at !== '') params.set('at', at)
  let d
  try {
    const res = await fetch('/api/thread?' + params.toString())
    d = await res.json()
  } catch (e) {
    box.innerHTML = '<div class="reason">读取失败: ' + esc(String(e.message)) + '</div>'
    return
  }
  if (d.error) { box.innerHTML = '<div class="reason">' + esc(d.error) + '</div>'; return }

  let html = '<div class="tmeta">' + esc(d.ref) + ' · ' + d.turns.length + ' 层' + (d.cursor ? ' · 阅读游标 第 ' + d.cursor + ' 楼' : '') + '</div>'
  html += '<div class="turns">'
  for (const t of d.turns) {
    html += '<div class="turn' + (t.isOp ? ' op' : '') + '"><span class="tidx">#' + t.index + '</span>' +
      '<span class="tauth">' + esc(t.author) + (t.isOp ? ' <i>楼主</i>' : '') + '</span>' +
      '<div class="ttxt">' + esc(String(t.text).slice(0, 200)) + '</div></div>'
  }
  html += '</div>'

  if (d.question) {
    html += '<div class="tans"><b>问:</b> ' + esc(d.question) + '</div>'
    for (const tg of (d.targets || [])) {
      // **依据必须显示**  只说"解析到某人"没法判断它是否对
      html += '<div class="ttgt"><span class="role">' + esc(tg.role) + '</span> = <b>' + esc(tg.who) +
        '</b> <span class="conf">conf ' + tg.confidence + '</span><div class="why">' + esc(tg.reason) + '</div>'
      for (const x of tg.turns) html += '<div class="qt">' + esc(String(x.text).slice(0, 140)) + '</div>'
      html += '</div>'
    }
    for (const a of (d.ambiguous || [])) {
      // **报出问题必须同时报出解法**
      html += '<div class="tamb">「' + esc(a.token) + '」' + esc(a.reason) +
        '<div class="why">候选: ' + esc(a.candidates.slice(0, 6).join(', ')) + '</div>' +
        '<div class="why">→ 在上面填「阅读游标」的楼层号即可消歧</div></div>'
    }
    if (d.topic) html += '<div class="why">话题词: ' + esc(JSON.stringify(d.topic)) + '</div>'
  }
  box.innerHTML = html
}

function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function renderVerdict(result) {
  const v = result.verdict || {}
  let html = '<div class="verdict"><b>为什么停在这里：</b>' + esc(result.stoppedBecause || '') +
    '<div class="sig">'
  for (const s of (v.signals || [])) {
    html += '<span class="' + (s.ok ? 'pass' : 'fail') + '">' + (s.ok ? '✓ ' : '✗ ') + esc((s.name || s.id || '?') + ' ' + (s.detail || '')) + '</span>'
  }
  html += '</div></div>'
  const div = document.createElement('div')
  div.innerHTML = html
  out.insertBefore(div, document.getElementById('hits'))
}

form.addEventListener('submit', ev => {
  ev.preventDefault()
  if (es) es.close()
  out.innerHTML = ''
  const fd = new FormData(form)
  const btn = form.querySelector('button')
  btn.disabled = true
  const pending = new Map()
  es = new EventSource('/api/search?' + new URLSearchParams(fd).toString())

  es.addEventListener('unwired', e => {
    const items = JSON.parse(e.data)
    const box = tierBox(0)
    const d = document.createElement('div')
    d.className = 'reason'
    d.textContent = '⚠ 未接线的来源：' + items.map(x => x.sourceId).join('、')
    body(box).appendChild(d)
  })

  es.addEventListener('recall', e => {
    const ev = JSON.parse(e.data)
    if (ev.kind === 'tier-start') {
      const box = tierBox(ev.tier); box.classList.add('active')
      meta(box, ev.sources.length + ' 个来源并发查询')
      for (const s of ev.sources) { pending.set(s, ev.tier); addSource(ev.tier, s, 'pending') }
    } else if (ev.kind === 'source-started') {
      // **记下进入时刻**（2026-09-19 接上  这条事件此前服务端发了、页面不收）。
      //
      // 它的用途正是 RecallEvent 注释里写的那个: 与 elapsedMs 配合，
      // **区分「这个来源慢」与「这个来源在排队」**。
      // elapsedMs 是**从这一层开始算**的，它把排队时间也算进去了 
      // 实测某个来源 elapsedMs=33028 而真实网络耗时只有 975ms。
      started.set(ev.sourceId, ev.at)
    } else if (ev.kind === 'source-settled') {
      const state = ev.failure ? ev.failure.kind : 'ok'
      const st = started.get(ev.sourceId)
      addSource(ev.tier, ev.sourceId, state, ev, st)
      started.delete(ev.sourceId)
      pending.delete(ev.sourceId)
    } else if (ev.kind === 'tier-end') {
      const box = tierBox(ev.tier)
      box.classList.remove('active'); box.classList.add('done')
      meta(box, ev.outcome.hits + ' 条 · ' + ev.outcome.elapsedMs + 'ms')
    } else if (ev.kind === 'tier-skipped') {
      const box = tierBox(ev.tier)
      box.classList.add('skip')
      meta(box, '未运行')
      body(box).innerHTML = '<div class="reason">' + esc(ev.reason) + '</div>'
    } else if (ev.kind === 'done') {
      renderVerdict(ev.result)
      renderHits(ev.result.hits)
      btn.disabled = false
      es.close()
    }
  })
  es.addEventListener('error', e => {
    const box = tierBox(0)
    const d = document.createElement('div'); d.className = 'reason'; d.style.color = 'var(--bad)'
    try { d.textContent = '错误：' + JSON.parse(e.data).message } catch { d.textContent = '连接中断' }
    body(box).appendChild(d)
    btn.disabled = false
  })
  es.onerror = () => { btn.disabled = false }
})
// 页面加载即拉平台可用性  它不依赖查询，是**静态现实**。
loadPlatforms()
var tgo = document.getElementById("tgo"); if (tgo) tgo.addEventListener("click", loadThread)
  // **进入时刻表**  source-started 填, source-settled 用(见事件分支注释)。
  var started = new Map()
</script>
</body>
</html>`
