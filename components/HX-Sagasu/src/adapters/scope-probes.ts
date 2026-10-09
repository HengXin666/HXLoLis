import { registerScopeProbe } from '../scope-resolve.ts'

/**
 * registerScopeProbe 的调用点。
 *
 * ## 为什么探测规则写在这里，而不是向适配器要
 *
 * `splitScopeQuery` 是 `makeTelegramAdapter()` 的**内部闭包**，没有对外暴露。
 * 两个选项:
 *   (a) 给 `ThreadAdapter` 加一个 `probeScope()` 方法  **契约变更**，
 *       要动所有适配器实现
 *   (b) 在这里注册一个探测函数，**复用同一条规则**
 *
 * **选 (b)，且明确记录它的风险**: 规则被写了**两遍**（一处在这里、一处在
 * `telegram.ts` 的 `splitScopeQuery`）。两处漂移会让"自动识别"与"实际解析"
 * 给出不同的频道名  而那是**静默的**（识别出的作用域让来源被调用，
 * 而调用时用的又是另一套规则）。
 *
 * **防漂移的手段**: 两侧的判据都是"Telegram 自己的规则"
 * **5-32 字符、只含字母数字下划线**（平台约束，不是我们的选择），
 * 且有测试锁住两侧对同一批输入的**一致结论**。
 *
 * 若将来 Telegram 改规则，两处都要改；这个注释就是提醒。
 
 * .agents/notes/implemented/architecture/2026-09-18-scope-producer.md
 */
const TELEGRAM_CHANNEL_RE = /^\s*(?:@|https?:\/\/t\.me\/s\/|t\.me\/s\/)?([A-Za-z0-9_]{5,32})\s+([\s\S]+)$/

registerScopeProbe('telegram-public', (query: string): string[] | null => {
  const m = TELEGRAM_CHANNEL_RE.exec(query)
  return m === null ? null : [m[1]!]
})
