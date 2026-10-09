/**
 * 平台接入登记表  **覆盖率的唯一事实来源**。
 *
 * 为什么需要它: "支持了 N 个平台"是最容易被高估的说法。已经踩过的坑（2026-09-16）:
 * argo 注册了 4 个知乎引擎，看起来覆盖 4 份，实际共用一个密钥、实际覆盖 1 份
 * （`api/v4/search_v3` 匿名调用 403，没有公开搜索 API）。
 *
 * 因此本表按**平台**登记，而不是按"引擎/接口数量"；且每个未接入的平台必须写明
 * **为什么**以及**需要什么条件才能接**。没有理由的"TODO"不算数  那种占位会在
 * 后来被当成"我们支持但有 bug"。
 */

import type { PlatformId } from '../types.ts'
import { makeBilibiliAdapter } from './bilibili.ts'
import { makeTelegramAdapter } from './telegram.ts'
import type { ThreadAdapter } from './adapter.ts'

/** 一个平台**现在能做什么**，以及不能做时的具体原因。 */
export interface PlatformStatus {
  platform: PlatformId
  /** 用户面向的平台名。 */
  label: string
  /** 已接入的适配器（未接入则没有）。 */
  adapter?: () => ThreadAdapter
  /**
   * `ready`        = 本机实测可用，有适配器
   * `blocked-dep`  = 缺外部依赖（凭证/CLI/服务）
   * `blocked-auth` = 需要登录态，无人值守场景不可用
   * `blocked-anti` = 有公开面但被风控挡住（直连被拒）
   * `no-endpoint`  = 平台没有可用的公开数据路径（不是我们没做，是做不到）
   * `todo`         = 路径已知且可行，尚未实现
   */
  state: 'ready' | 'blocked-dep' | 'blocked-auth' | 'blocked-anti' | 'no-endpoint' | 'todo'
  /** 判定依据（一手实测，不是推测）。 */
  evidence: string
  /** state ≠ ready 时，接上它需要什么。 */
  unlock?: string
}

export const PLATFORMS: readonly PlatformStatus[] = [
  {
    platform: 'bilibili',
    label: 'B站',
    adapter: () => makeBilibiliAdapter(),
    state: 'ready',
    evidence:
      '2026-09-16 实测：search/all/v2 返回 200（注意 search/type 直连 412）；' +
      'x/v2/reply 返回真实评论含楼中楼；搜索/详情/评论三条路径均通',
  },
  {
    platform: 'telegram',
    label: 'Telegram',
    adapter: () => makeTelegramAdapter(),
    state: 'ready',
    evidence:
      '2026-09-16 实测：t.me/s/durov 返回 200、服务端渲染 HTML，抽出 4 条消息含 durov 头像 URL 与时间戳。' +
      '**但 2026-09-18 复核: 本机到 t.me 的连接被阻断**  DNS 能解析（t.me → 149.154.167.99），' +
      '而 HTTP 三次请求全部超时；同期 example.com 与 developer.mozilla.org 均 HTTP 200（对照成立）。' +
      '适配器代码本身没问题（裸查询正确地报了"不适用"而非失败）。' +
      '**这是网络可达性问题，不是代码问题**  换网络环境后应重测。',
    unlock: '搜索能力需要 MTProto 用户会话（凭证边界之外，不在本项目范围）',
  },
  {
    platform: 'xiaohongshu',
    label: '小红书',
    state: 'blocked-dep',
    evidence:
      '2026-09-16 实测：argo 的 xiaohongshu 引擎因 xhs CLI 缺失而**整脚本崩溃**（rc=1），' +
      '却被上游吞成 "no-results"。已加依赖预检（apply_patches.py P1）使其显式失败',
    unlock: '安装并配置 xhs CLI（外部依赖）；或走登录态浏览器采集',
  },
  {
    platform: 'zhihu',
    label: '知乎',
    state: 'blocked-dep',
    evidence:
      '2026-09-16 实测：api/v4/search_v3 匿名请求 403  **知乎没有公开匿名搜索 API**；' +
      'argo 的 4 个 zhihu 引擎共用一个 ARGO_ZHIHU_ACCESS_SECRET；' +
      '2026-09-18 复核: 其 4 个变体（zhihu/zhihu_global/zhihu_user/zhihu_hot）' +
      '各用两条查询实测**全部 0 条**，四个一致失败排除了"单个引擎配置错"，' +
      '直连端点仍 403。',
    unlock: '申请知乎开放平台凭证，或走登录态浏览器',
  },
  {
    platform: 'x',
    label: 'X.com',
    state: 'blocked-dep',
    evidence:
      '2026-09-16 实测：api.fxtwitter.com/2/search 返回 404（该搜索端点不存在；/2/status/<id> 仍可用）；' +
      '3 个 nitter 实例不可达。此前"fxTwitter 能做搜索"的判断被推翻',
    unlock: '装 tw CLI（需 X 账号凭证），或复用 cf-register 的 CDP 栈做登录态浏览器采集',
  },
  // ── 2026-09-18 补充: argo 引擎侧的实测结论 ──────────────────────
  //
  // 此前这些平台的判定只基于**我们自建的直连适配器**。本轮把 argo 的 140 个引擎
  // 按平台名探了一遍，得到**同一结论但更硬的证据**  而且发现 argo 的失败
  // **极其不诚实**，值得单独记下来。
  {
    platform: 'weibo',
    label: '微博',
    state: 'blocked-anti',
    evidence:
      '2026-09-18 实测：argo 有 weibo 引擎（CLI 型，调 scripts/social_engines/weibo_engine.py，' +
      '直连 m.weibo.cn/api/container/getIndex）。**2026-09-19 复核: 该端点确实返回 HTTP 200 / 9380B，但**内容是 HTML 登录页而非 JSON**（不带 Referer 也是 HTML） 只看状态码会误判为"通了"。**端点返回 HTTP 200 + 10KB 内容，但内容是 ' +
      'Sina Visitor System 访客验证页（HTML 而非 JSON）** → json.load 抛异常 → 引擎吞掉 → 上层看到 0 条。' +
      '实测多组查询（热搜/微博 明星/原神 剧情）全部 0 条，MCP 与 CLI 两条路径一致。' +
      '**关键: 它不是"没有结果"，是被风控  而它把这两件事报成了同一个样子。**',
    unlock: '需要带 Cookie 的登录态（m.weibo.cn 的访客票据），或改用 CDP 登录态浏览器',
  },
  {
    platform: 'reddit',
    label: 'Reddit',
    state: 'blocked-anti',
    evidence:
      '2026-09-18 实测：argo 有 reddit 引擎（scripts/social_engines/reddit_engine.py），' +
      '**返回 0 条**（查询 rust / python / 原神 剧情 均 0）。Reddit 自 2023 起对未认证 ' +
      'JSON 端点限流严格，publicapi 路径需要 OAuth。',
    unlock: '注册 Reddit OAuth app（免费但需账号）拿 client_id/secret',
  },
  {
    platform: 'wechat',
    label: '微信公众号',
    state: 'blocked-anti',
    evidence:
      '2026-09-18 实测：argo 有 wechat_sogou 引擎（搜狗微信入口），**返回 0 条**（查询 美食 亦 0）。' +
      '搜狗微信搜索页有验证码墙，且该入口近年持续收紧。',
    unlock: '需要 sogou 的会话票据，稳定性差；argo 另有一个 RSS 派生的 wechat 路径待评估',
  },
  {
    platform: 'tieba',
    label: '百度贴吧',
    state: 'blocked-anti',
    evidence:
      '2026-09-16 实测：桌面版 f?kw= 返回 403；移动版 /mo/q/m?kw= 同样 403（带浏览器 UA）；**2026-09-19 复核 5 个端点: 4 个 403 + c/f?kw 返回 200 但 0 字节空壳**  结论不变',
    unlock: '需要带 Cookie 的登录态会话，或改用反检测浏览器采集',
  },
  {
    platform: 'heybox',
    label: '小黑盒',
    state: 'blocked-anti',
    evidence:
      '2026-09-16 实测：站点 200 但是 SPA；从主 bundle（index-8QE9Vskv.js，约 2MB）里挖出**真实端点** ' +
      'api.xiaoheihe.cn/bbs/app/api/general/search/v1（web 版同路径 /web） 返回 200 JSON 但 ' +
      'status=failed、msg=「请求失败了」，即端点存在但被**签名校验**挡住（bundle 里加载 jsencrypt，' +
      '签名方案应为 hkey/nonce/_time 组合）。此前猜的 /bbs/app/feeds/search 返回 404 已被取代',
    unlock: '复现其 hkey 签名算法（需逆向 bundle 里的 jsencrypt 使用点），或用浏览器渲染取数',
  },
  {
    platform: 'discord',
    label: 'Discord',
    state: 'blocked-auth',
    evidence: '服务端公开面只有邀请页，消息读取必须走 Bot Token 或用户 Token',
    unlock: '注册一个 Discord Bot 并加入目标服务器（需要服务器管理员授权）',
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    state: 'blocked-anti',
    evidence:
      '2026-09-16 实测：yt-dlp 2026.08.19 已装（1752 extractor）但**五个 player_client 全部被拒**' +
      '（web_safari / tv / android_vr / mweb / web_embedded / ios 均返回 ' +
      '「Sign in to confirm you』re not a bot」） 本机出口 IP 被 YouTube 判定为机器人。' +
      '「工具已安装」不等于「能力可用」，这正是此前反复踩的坑',
    unlock: '提供登录态 cookies（--cookies-from-browser / --cookies）或换出口 IP；' +
      '注意评论抽取另有 --write-comments 的不稳定性与限流',
  },
]

export interface Coverage {
  ready: number
  total: number
  /** 按状态分组的平台名，便于直接印在报告里。 */
  byState: Record<PlatformStatus['state'], string[]>
}

/** 覆盖率必须由**登记表**算出，不允许各处手写数字。 */
export function coverage(): Coverage {
  /**
   * 平台判定的复核  从"单查询探测"到"多变体多查询"
   * .agents/notes/implemented/architecture/2026-09-18-platform-recheck.md
   * 引擎与平台的**可达性**复核  两个"标着可用但其实不可用"
   * .agents/notes/implemented/architecture/2026-09-18-reachability-recheck.md
   * 私域平台可达性复核  以及一次「只看状态码」的误读
   * .agents/notes/implemented/architecture/2026-09-19-platform-recheck.md
   */
  const byState = { ready: [], 'blocked-dep': [], 'blocked-auth': [], 'blocked-anti': [], 'no-endpoint': [], todo: [] } as unknown as Record<PlatformStatus['state'], string[]>
  for (const p of PLATFORMS) byState[p.state].push(p.label)
  return {
    ready: PLATFORMS.filter(p => p.state === 'ready').length,
    total: PLATFORMS.length,
    byState,
  }
}

/** 取一个**已接入**平台的适配器。未接入时抛错并带上解锁条件，而不是返回 null。 
 * .agents/notes/implemented/architecture/2026-09-18-platform-visibility.md
 */
export function getAdapter(platform: PlatformId): ThreadAdapter {
  const entry = PLATFORMS.find(p => p.platform === platform)
  if (entry === undefined) throw new Error(`未知平台: ${platform}`)
  if (entry.adapter === undefined) {
    throw new Error(`平台 ${entry.label} 尚未接入（${entry.state}）。依据: ${entry.evidence}。解锁条件: ${entry.unlock ?? '未记录'}`)
  }
  return entry.adapter()
}
