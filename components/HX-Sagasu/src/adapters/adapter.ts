/**
 * 适配器端口（L0）。**平台的所有丑陋都止于此层**  L2 以上只看见统一 Thread/Turn。
 *
 * 对齐已确认规则「语义能力抽象为端口，换实现不改业务代码」: 适配器是端口的实现，
 * 新增一个平台 = 新增一个实现，不改任何上层代码。
 *
 * 一条贯穿全部适配器的契约: **失败必须响亮**。
 *
 * 背景（2026-09-16 实测）: argo 的 `safe_search` 装饰器与 CLI builder 的 `_run`
 * 把引擎异常与非零退出**统一吞成空结果**，导致"外部 CLI 没装"被伪装成"该查询没有
 * 内容"，而调用方完全无法区分。HX-Sagasu 不允许重犯: 适配器拿不到数据时抛
 * `AdapterError`，由上层显式呈现为"该平台不可用/依赖缺失"，而不是一个空洞的 []。
 */

import type { PlatformId, RawThreadInput } from '../types.ts'

export interface AdapterCapabilities {
  /** 支持关键词搜索。 */
  search: boolean
  /**
   * 搜索需要的**作用域**。缺省 `'none'` = 可以直接吃用户的原始查询。
   *
   * 存在的理由（2026-09-16 实测倒逼）: Telegram 只有**频道内**搜索
   * （`t.me/s/<channel>?q=<term>`），没有全站搜索。把一个裸查询"Rust 所有权"
   * 交给它，结果是**每次召回都失败一次**  而它其实不是坏了，是**不适用于这个查询**。
   *
   * 这两者必须区分: "失败"会进入 failures 并训练人忽略失败；"不适用"只是这一层
   * 这次用不上它。声明作用域让召回层能**预先**判定，而不是靠调用后读错误信息。
   */
  searchScope?: 'none' | 'channel'
  /** 支持按 ref 取整个对话线程。 */
  thread: boolean
  /** 是否需要用户登录态（决定它能否在无人值守场景使用）。 */
  requiresAuth: boolean
  /** 是否需要拟人化请求头（UA/Referer 等）才能避免风控。 */
  politeHeaders: boolean
}

export interface AdapterContext {
  /** 结果条数上限。 */
  limit?: number
  /** 请求超时（毫秒）。 */
  timeoutMs?: number
  /** 调用方标识，进 provenance 之外的审计日志。 */
  caller?: string
}

export interface SearchHit {
  platform: PlatformId
  /** 平台内稳定 id（B站是 bvid）。 */
  id: string
  title: string
  url: string
  createdAt?: number
}

/**
 * 适配器统一接口。**注意 `thread` 返回的是 RawThreadInput** 
 * 适配器只负责"原样取回结构"，归一是 L1 的事（`thread.ts`）。
 * 适配器里不允许出现 normalizedText: 归一化只有一处实现。
 */
export interface ThreadAdapter {
  readonly platform: PlatformId
  readonly capabilities: AdapterCapabilities
  search(query: string, ctx: AdapterContext): Promise<SearchHit[]>
  /**
   * 平台适配器止于 L0，覆盖率由登记表算出而不是手写
   * .agents/notes/implemented/architecture/2026-09-16-platform-adapters-l0.md
   */
  thread(ref: string, ctx: AdapterContext): Promise<RawThreadInput>
}

/** 适配器失败的分类。**四态判定依赖它**  不同类别要给出不同的行动建议。 */
export type AdapterFailureKind =
  | 'network'      // 连不上/超时
  | 'http'         // 非 2xx
  | 'api'          // 接口返回业务错误码
  | 'auth'         // 缺登录态/凭证
  | 'blocked'      // 被风控/封禁
  | 'parse'        // 响应结构与预期不符
  | 'unsupported'  // 该平台不支持此操作

export class AdapterError extends Error {
  readonly kind: AdapterFailureKind
  readonly platform: PlatformId
  readonly detail?: string

  constructor(platform: PlatformId, kind: AdapterFailureKind, message: string, detail?: string) {
    super(`[${platform}/${kind}] ${message}`)
    this.name = 'AdapterError'
    this.platform = platform
    this.kind = kind
    if (detail !== undefined) this.detail = detail
  }
}

export function adapterError(
  platform: PlatformId,
  kind: AdapterFailureKind,
  message: string,
  detail?: string,
): AdapterError {
  return new AdapterError(platform, kind, message, detail)
}

/**
 * 判断某个来源对当前查询**是否适用**。
 *
 * 与"可用性"是两件事: 不可用 = 没接线/缺凭证/被风控；不适用 = 接好了、这次用不上
 * （如需要频道作用域的 Telegram 遇到裸查询）。把不适用当成失败会污染 failures，
 * 而 failures 的意义是"去看看哪里坏了"。
 
 * .agents/notes/implemented/architecture/2026-09-16-applicability-is-not-failure.md
 */
export function isApplicable(searchScope: 'none' | 'channel' | undefined, scope: readonly string[] | undefined): boolean {
  if ((searchScope ?? 'none') === 'none') return true
  return scope !== undefined && scope.length > 0
}

/** 四态中属于"拿不到"的那些  与"真跑过但没有内容"严格区分。 */
export function isUnavailable(err: unknown): boolean {
  return err instanceof AdapterError && err.kind !== 'unsupported'
}
