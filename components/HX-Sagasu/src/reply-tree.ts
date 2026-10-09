/**
 * 把平铺的楼层重建为**回复树**。
 *
 * ## 为什么需要它（2026-09-18）
 *
 * `thread.ts` 一直在建这张关系（`parentId` 与 `quotedTurnId`，且区分
 * "平台给的"与"推断的"并标 `quoteInferred`），**但没有任何地方呈现它** 
 * CLI 与界面都按楼层顺序平铺。
 *
 * 实测（B站 `BV1GJ411x7h7`，11 楼）: **8 条有 `parentId` + `quotedTurnId`，
 * 且推断条数为 0**  平台直接给了事实，没有一条是猜的。
 *
 * **平铺会丢掉的东西**: "这句话是在回谁"。第 4 楼回的是第 1 楼还是第 2 楼，
 * 在平铺视图里完全看不出  而**引用链的价值正在于此**。
 *
 * ## 与 `resolve` 的分工
 *
 * `resolve` 回答"**提问里的指代词指向谁**"（"楼主"/"楼上"/"他"）；
 * 这里回答"**这条回复在回哪一条**"（既有事实的呈现）。
 * 两者都产出指向关系，但一个依赖问题文本，一个只依赖帖子结构。
 */
export interface ReplyNode {
  readonly id: string
  /** 楼层序号（1-based，与界面显示一致）。 */
  readonly index: number
  readonly author: string
  readonly text: string
  /** 直接回复的楼层 id；顶层帖为 undefined。 */
  readonly parentId?: string
  /** 引用的楼层 id（可能与 parentId 不同  引用是"引用了谁的话"，父是"挂在哪下面"）。 */
  readonly quotedTurnId?: string
  /** 引用关系是否是**推断**的（不是平台给的）。呈现时必须能区分。 */
  readonly quoteInferred: boolean
  readonly children: ReplyNode[]
}

export interface ReplyTree {
  readonly roots: ReplyNode[]
  /** 按楼层序的扁平视图，便于并排显示。 */
  readonly flat: ReplyNode[]
  /** 深度（根为 0）。 */
  readonly maxDepth: number
}

/**
 * 重建回复树。
 *
 * **孤儿处理**: `parentId` 指向不存在的楼层（被删、被截断、平台给错）时，
 * 该楼**挂到根**而不是被丢弃  丢掉会让它在树上消失，而"这条回复存在"是事实。
 * 但**在返回值里标出来**（`flat` 里能查到它的 parentId 指向未登记 id）。
 */
export function buildReplyTree(
  turns: readonly { id: string; parentId?: string; quotedTurnId?: string; author?: { name?: string } | string; normalizedText?: string; text?: string; quoteInferred?: boolean }[],
): ReplyTree {
  const nodes = new Map<string, ReplyNode>()
  const flat: ReplyNode[] = []
  turns.forEach((t, i) => {
    const author = typeof t.author === 'string' ? t.author : (t.author?.name ?? '(无名)')
    const n: ReplyNode = {
      id: t.id,
      index: i + 1,
      author,
      text: String(t.normalizedText ?? t.text ?? ''),
      quoteInferred: t.quoteInferred === true,
      children: [],
      ...(t.parentId !== undefined ? { parentId: t.parentId } : {}),
      ...(t.quotedTurnId !== undefined ? { quotedTurnId: t.quotedTurnId } : {}),
    }
    nodes.set(t.id, n)
    flat.push(n)
  })

  const roots: ReplyNode[] = []
  for (const n of flat) {
    // 父不存在（被删/被截断/平台给错）→ 挂根，**不丢弃**
    const parent = n.parentId !== undefined ? nodes.get(n.parentId) : undefined
    if (parent === undefined) roots.push(n)
    else parent.children.push(n)
  }

  // 深度：迭代算，避免深帖递归爆栈
  let maxDepth = 0
  const depthOf = new Map<string, number>()
  const queue: Array<[ReplyNode, number]> = roots.map(r => [r, 0])
  while (queue.length > 0) {
    const [n, d] = queue.shift()!
    depthOf.set(n.id, d)
    if (d > maxDepth) maxDepth = d
    for (const c of n.children) queue.push([c, d + 1])
  }
  return { roots, flat, maxDepth }
}

/** 把树渲染成**缩进文本**（CLI 用）。缩进即深度  一眼能看出谁在回谁。 */
export function renderTree(tree: ReplyTree, opts: { maxText?: number; maxNodes?: number } = {}): string[] {
  // id → 楼层序号的映射，用于把 quotedTurnId 显示成  const idxOf = new Map(tree.flat.map(n => [n.id, n.index]))
  const maxText = opts.maxText ?? 48
  const maxNodes = opts.maxNodes ?? 200
  const out: string[] = []
  // id → 楼层序号的映射，用于把 quotedTurnId 显示成「#N」而不是一串 id
  const idxOf = new Map(tree.flat.map(n => [n.id, n.index]))
  const walk = (n: ReplyNode, depth: number): void => {
    if (out.length >= maxNodes) return
    const indent = '  '.repeat(depth)
    const mark = depth > 0 ? '└ ' : ''
    // **推断的引用必须标出来**  不假装是事实
    // **引用与父级是两回事**: 父是'挂在哪条下面'，引用是'引用了谁的话'。
    // 实测 #10（老咸鱼A）父亲是 #7，而它引用的是 #9  只看树会以为它在回 #7。
    let q = ''
    if (n.quotedTurnId !== undefined && n.quotedTurnId !== n.parentId) {
      /**
       * 回复树  把"这句话在回谁"从平铺里捞出来
       * .agents/notes/implemented/architecture/2026-09-18-reply-tree.md
       */
      const qi = idxOf.get(n.quotedTurnId)
      q = ' → 引用 #' + (qi ?? '?') + (n.quoteInferred ? '(推断)' : '')
    } else if (n.quoteInferred) {
      q = ' (引用为推断)'
    }
    out.push(indent + mark + '#' + n.index + ' ' + n.author.slice(0, 12).padEnd(13) +
      n.text.replace(/\n/gu, ' ').slice(0, maxText) + q)
    for (const c of n.children) walk(c, depth + 1)
  }
  for (const r of tree.roots) walk(r, 0)
  return out
}
