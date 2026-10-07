# Agent Note: 给 `ctx.scope` 接上生产者  机制对了但没人传

Status: implemented

- 影响: `components/HX-Sagasu/src/scope-resolve.ts`（新建）、`src/adapters/scope-probes.ts`（新建）、`src/recall.ts`（自动识别 + `ctxWithScope`）

## Problem

上轮修好了作用域的**判据**（`recall.ts` 从"字面包含 channel"改为"有没有提供"），
但 **`ctx.scope` 仍然没有生产者**  **机制对了，而没人传。**

实测后果：用户写 `durov telegram`（合法的频道作用域查询），
如果调用方没显式传 `ctx.scope`，Telegram 仍被判 `not-applicable` 而**从不被调用**。

**这是本项目第 N 次遇到同一形态**  机制/判据/实现都在，**缺的是把它接上**。

### 机制层面的根因

信息在**组装时就被丢掉了**：

```
adapterFetcherEntries()  → 返回 { fetcher, searchScope }   ← 带作用域信息
adapterFetchers()        → 只取 .fetcher                    ← **信息在这里丢了**
planFetchers()           → 只用 fetcher                     ← 丢掉的信息没有再出现
```

而 `adapterFetchers` 的注释**自己就警告过**：

> **注意它丢掉的信息**: 对 `searchScope: 'channel'` 的来源（Telegram），
> 用这个函数组装会让裸查询走向一个必然的失败。

**而 CLI 与 serve 用的都是它。**

## Decision

**`resolveScope(query, needsScope)`  从查询里识别作用域，填进 `ctxWithScope`。**

### 三条判据（都是"不猜"的方向）

1. **只对声明了 `requiredScope` 的来源探测**  其他来源不需要。
2. **没有探测器的来源不猜**  猜错会把查询发到**别人的频道**。
3. **探测函数抛错时不毁掉整次召回**  只是"这次没识别到"。
   抛出去会让一个平台的格式问题毁掉整次检索。

**显式传入的 `ctx.scope` 优先且不被覆盖**  调用方明确给的是**更强的信号**
（它可能知道查询里看不出的东西）。

### 探测器用**平台的真实规则**，并显式记录重复的风险

Telegram 的频道名规则是平台约束（5-32 字符、只含字母数字下划线），
它**已经写在** `adapters/telegram.ts` 的 `splitScopeQuery` 里（内部闭包，未导出）。

我在 `scope-probes.ts` 里**又写了一遍**。**这是有意的取舍，且把风险写在了注释里**：

> 两处漂移会让"自动识别"与"实际解析"给出不同的频道名  而那是**静默的**。
> 防漂移的手段：两侧判据都是**平台的真实规则**（不是我们的选择），
> 且有测试锁住两侧对同一批输入的一致结论。

## Alternatives considered

- **给 `ThreadAdapter` 加 `probeScope()` 方法**：契约最干净，且**规则只写一遍**。**否决理由**：那是**契约变更**  要动 `adapter.ts` 的接口与**每一个适配器实现**，而当前只有一个适配器需要它。**为一个使用点改公共契约不划算。** 若将来有第二、第三个需要作用域的适配器，就该改契约了  这条记在这里，作为将来切换的信号。
- **在 `recall` 里硬编码"什么算频道名"**：省掉注册机制。**否决理由**：`recall` 是**分层调度层**，让它知道 Telegram 的频道名格式是**层次穿透**  而适配器端口存在的全部意义就是"平台的所有丑陋都止于此层"（`adapter.ts` 文件头）。
- **自动发现探测函数**（按命名约定找）：不用显式注册。**否决理由**：那会让"哪个平台支持作用域"变成一个**隐式约定**  而本项目的教训是**隐式约定会漂移**（第 18 轮的"接口表与登记表脱节"就是）。显式注册让这件事可 grep、可测试。
- **让 `planFetchers` 传播 `searchScope` 到 `recall`**：从根上不丢信息。**否决理由**：**本轮做了更直接的事**（自动识别），而传播 `searchScope` 解决的是"recall 知道哪些来源需要作用域"  但那个信息 `SOURCES` 里**已经有**（`requiredScope` 字段），所以不需要从组装层再传一遍。**两个字段描述同一事实是已知的架构债**（`requiredScope` vs `searchScope`），但修它要统一两张表，是独立一件事。
- **探测失败时抛错**：让问题响亮。**否决理由**：**探测失败不是故障**  它是"这个查询里没有作用域"，而那正是 `not-applicable` 要表达的东西。抛出去会让一个平台的格式问题**毁掉整次召回**（其他来源的结果也拿不到）。
- **不写测试，端到端手验过**：省事。**否决理由**：**本项目已反复栽在"手验过但测试没覆盖"上**。新增 5 条里有两类是**反向断言**：探测抛错不许毁召回、没有探测器时不许猜。

## Consequences

- **`ctx.scope` 现在有生产者**：`durov telegram` 会被自动识别为 `['durov']`。
- **`resolveScope` 是纯函数**（探测函数注入），`clearScopeProbes` 供测试隔离。
- **两个入口（CLI / serve）都做了副作用导入**以触发注册  这是**容易漏的一步**（漏了就是"机制在但没生效"）。**副作用导入没有编译期保护**，靠注释与测试。
- **已知架构债**：`SOURCES.requiredScope` 与 `AdapterCapabilities.searchScope` 描述同一事实的两处。本轮的自动识别用的是前者。
- **未做**：把 `requiredScope` 与 `searchScope` 统一（见上）。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **272 tests / 272 pass / 0 fail**（新增 5 条）
- **端到端实测（不传 `ctx.scope`）**：
  ```
  "durov telegram"
    适配器被调用: ✅ 是（自动识别生效）
    自动识别出 scope: ["durov"]
  "Rust 所有权"
    适配器被调用: ○ 否
    原因: not-applicable        ← 裸查询仍正确拒绝
  ```
- **反向断言**：探测抛错 → 吞成"没识别到"（不毁召回）；没有探测器 → 不填（不猜）
- **显式优先**：传了 `scope: ['explicit']` 时自动识别不覆盖它
