/**
 * 从查询里**识别作用域**  让 `ctx.scope` 有生产者。
 *
 * ## 为什么需要它（2026-09-18）
 *
 * 上轮修好了作用域的**判据**（`recall.ts` 从"字面包含 channel"改为"有没有提供"），
 * 但 `ctx.scope` **仍然没有生产者**  机制对了，而没人传。实测后果：
 * 用户写 `durov telegram`（合法的频道作用域查询），如果调用方没显式传
 * `ctx.scope`，Telegram 仍被判 `not-applicable` 而**从不被调用**。
 *
 * ## 判据：**来源声明需要作用域 + 查询里能解析出该作用域** → 自动填
 *
 * 这里刻意**不做更聪明的推断**（不从历史、不从上下文猜频道名）：
 * 只在"来源明确声明需要"且"查询里确实有"时填。**猜错会让查询发到别人的频道。**
 *
 * ## 为什么由平台自己解析
 *
 * 频道名的**格式规则是平台的**  Telegram 是 "5-32 字符、只含字母数字下划线"，
 * 而这个规则写在适配器的 `splitScopeQuery` 里。**在这里重写一遍就会漂移。**
 * 所以本模块只做"要不要问平台"的判断，具体解析交给适配器。
 */

/** 平台自己实现的"能否从查询里解析出作用域"。 */
export type ScopeProbe = (query: string) => string[] | null

/**
 * 已登记的作用域探测函数。
 *
 * **为什么要注册而不是自动发现**: 探测必须用**平台的真实规则**（见文件头），
 * 而那只有适配器知道。自动发现（如按命名约定找函数）会让"哪个平台支持作用域"
 * 变成一个隐式约定  而本项目的教训是**隐式约定会漂移**。
 */
const PROBES: Record<string, ScopeProbe> = {}

export function registerScopeProbe(sourceId: string, probe: ScopeProbe): void {
  PROBES[sourceId] = probe
}

/** 清空（测试用）。 */
export function clearScopeProbes(): void {
  for (const k of Object.keys(PROBES)) delete PROBES[k]
}

export interface ScopeResolution {
  /** 自动识别出的作用域。空数组 = 没识别到。 */
  readonly scope: string[]
  /** 每个来源识别到了什么（供审计）。 */
  readonly found: ReadonlyMap<string, string[]>
}

/**
 * 为需要作用域的来源，从查询里识别作用域。
 *
 * @param query 用户查询原文
 * @param needsScope 哪些来源**声明了**需要作用域（`searchScope !== 'none'`）
 */
export function resolveScope(
  query: string,
  needsScope: readonly string[],
): ScopeResolution {
  const found = new Map<string, string[]>()
  const scope: string[] = []
  for (const sourceId of needsScope) {
    const probe = PROBES[sourceId]
    if (probe === undefined) continue  // 没有探测器 → 不猜
    let parsed: string[] | null = null
    try {
      parsed = probe(query)
    } catch {
      // **探测失败不抛**  它只是"这次没识别出来"，不是故障。
      // 抛出去会让一个平台的格式问题毁掉整次召回。
      parsed = null
    }
    if (parsed === null || parsed.length === 0) continue
    found.set(sourceId, parsed)
    for (const s of parsed) if (!scope.includes(s)) scope.push(s)
  }
  return { scope, found }
}
