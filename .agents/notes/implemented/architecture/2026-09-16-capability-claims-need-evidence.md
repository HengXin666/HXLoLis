# Agent Note: 能力声明必须指向实测  Telegram 搜索与第 1、2 层的实现归属

Status: implemented

- 影响: `components/HX-Sagasu/src/adapters/telegram.ts`、`components/HX-Sagasu/tests/registry-consistency.test.ts`

## Problem

上一轮修掉了"第 1、2 层登记了却没有实现"的静默伪装，但没有修**它的成因**，也没有核实那些来源**声称的能力**是否真实。这一轮去查，发现三件事，其中两件是同一个病。

**① Telegram 适配器把 `search` 写死为 `false`，理由是错的。**

代码里的注释写着"公开频道页**没有**搜索能力。宁可显式不支持，也不要伪造一个搜索"措辞很像一条负责任的决策。**但它从未被实测过。** 实测：

| 请求 | 结果 |
|---|---|
| `t.me/s/durov?q=telegram` | 200，20 条，**20/20 正文都含 telegram** |
| `t.me/s/durov?q=cryptocurrency` | 200，6 条（3 条正文含该词） |
| `t.me/s/durov?q=zzzznotfoundterm` | 200，**0 条** |
| `t.me/s/durov`（不带 q） | 200，20 条，post id 与带 q 的**不同** |

`?` 是**服务端过滤**。能力确实存在，只是**只有频道内搜索**：`t.me/s/?q=` 返回 302、`t.me/search?q=` 是空壳（9583 字节、0 条消息）。**没有全站搜索。**

**② 两个测试把这个错误固化成了"已验证的契约"。**

`adapters.test.ts` 有一条 `Telegram: search 显式不支持（不伪造搜索能力）`，`registry.test.ts` 有一条 `assert.equal(tg.capabilities.search, false, 'Telegram 公开频道页没有搜索能力，不能谎称有')`。

> **教训：把未验证的假设写进测试，测试就从"防线"变成了"错误的固化装置"**  它让后来的读者以为"这条已经验证过了"。这两条测试的措辞（"不能谎称有"）比代码注释更有误导性，因为测试通过意味着"有人检查过"。

**③ `registry-consistency.test.ts` 用一行 `continue` 掩盖了实现归属的缺失。**

```ts
for (const id of reg) {
  if (id === 'bilibili' || id === 'telegram-public' || id === 'argo:anysearch') continue // 非权威源
  assert.ok(impl.has(id), ...)
}
```

测试**知道**这三个来源不在 `AUTHORITATIVE_SOURCES` 里，却把"它们由谁实现"写成了**例外**而不是**归属**。结果：第 1、2 层整整 12 轮没有任何实现，而这条测试一直是绿的。

## Decision

**三条改动，都指向同一条规则：每一句"能/不能"都必须能指向一条实测证据。**

1. **实现 Telegram 频道内搜索**：`capabilities.search` 改为 `true`。查询语法是 `<频道名> <关键词>`这不是我们发明的抽象，而是**平台边界的直接映射**。纯关键词查询抛 `unsupported` 并在消息里说明"没有全站搜索、应该怎么写"。

   频道名按 **Telegram 自己的规则**校验（5-32 字符、字母数字下划线）。用 `{4,}` 时 `Rust 所有权` 会被当成频道名而静默接受，再去请求一个不存在的频道。

2. **把两条固化错误的测试改为断言真实能力**，并在注释里写明"此前断言的是未实测的假设、已被推翻"。**不删掉旧测试、不追加新测试，而是就地改写**  否则"曾经认为不支持"这件事会消失，下一个人会重新踩。

3. **用 `IMPL_OWNER` 表替换那行 `continue`**：每个来源必须**指名**它的实现归属（`authoritative` / `argo` / `adapter`）。断言随之变强：
   - 声明 `authoritative` 的必须在 `AUTHORITATIVE_SOURCES` 里有实现
   - 声明归 `argo`/`adapter` 的**不许**同时出现在 `AUTHORITATIVE_SOURCES` 里
   - `IMPL_OWNER` 里不许有孤儿键
   - **新增**：同一条来源不许被两个模块同时实现而无人察觉

## Alternatives considered

- **保留 `search: false`，因为"频道内搜索"不算"搜索"**：可以把 `SearchHit` 的语义限定为"跨平台关键词搜索"，而频道内搜索确实不是那个东西。否决理由：**`SOURCES` 里的 `telegram-public` 是按"能回答查询的来源"登记的**，而"在 durov 频道里找 telegram 相关内容"确实是回答查询。把能力藏起来，代价是调用方**永远不知道这条路径存在**而它零成本、零凭证、已实测可用。
- **支持纯关键词搜索（返回一个需要用户先给频道的错误提示 / 或猜测频道）**：更贴近"搜索"的直觉。否决理由：**Telegram 网页面上不存在全站搜索**（302 / 空壳），猜频道会把"我们没做到"变成"平台给了结果"。如实拒绝并给出正确写法，比伪造一个降级体验诚实。
- **删掉那两条固化错误的测试，另写两条新的**：更"干净"，git 历史里也不会留下矛盾的断言。否决理由：**"曾经认为它不支持"这件事本身就是知识。** 就地改写 + 写明"此前是未实测的假设"能让后来者看到这个错误**长什么样**，从而识别同类错误。删掉它，等于把一次有价值的教训清出仓库。
- **只把 `continue` 改成断言 `impl.has(id)`**：更严格。否决理由：那会让三个来源立刻失败，而它们**确实有实现**（只是不在 `AUTHORITATIVE_SOURCES` 里）。严格但错误的断言会逼着人把它改回去。**`IMPL_OWNER` 表达的是"谁实现"这个此前无人回答的问题**，比"必须在这里实现"更准确。
- **给 juejin 的双路（原生 + argo）合并成一条**：消除重复实现，避免两条路漂移。否决理由：实测两条路**产出不同**原生 `juejinSearch` 返回 20 条高度相关结果（《Rust 所有权与借用：从堆栈开始建立心智模型》），argo 路径在缓存命中时会被拒。**原生优先、argo 备选**是有意义的分层，不是冗余。改为**显式登记双路**并加测试锁住"只有 juejin 允许双路"。
- **让 `splitScopeQuery` 接受任意长度 ≥1 的频道名**：更宽松，不会误拒。否决理由：Telegram 频道名真实下限是 5（官方规则）。宽松的近似会让 `Rust 所有权` 被解析为"频道 Rust、关键词 所有权"，请求一个不存在的频道并得到一个 `api` 错误**错误类型从"你写错了"变成了"频道不存在"，误导方向**。

## Consequences

- **Telegram 成为第 3 个实测可用的检索路径**（前两个：B站搜索、argo/掘金）。真网络实测：`durov telegram` → 3 条、`durov cryptocurrency` → 3 条、`durov zzzznotfound` → 0 条、`Rust 所有权` → 显式 `unsupported` 并说明正确写法。
- **`SOURCES` 里每个来源现在都有明确的实现归属**。新增来源时若忘了登记归属，测试立刻失败**这正是第 12 轮那个缺陷的成因被消除**。
- **`juejin` 的双路被显式锁定**。将来多出第二个重叠来源，测试会失败并要求明确主次。
- `telegram-public` 仍**未接进 `recall` 的取数层**它的适配器现在有 `search()` 了，但把 `ThreadAdapter` 包成 `SourceFetcher` 的桥接还没写。**本轮把"能力"补上了，"接线"还差一步。**
- `adapters.test.ts` 与 `registry.test.ts` 的旧断言被就地改写，**"曾经认为 Telegram 不能搜索"这个错误记录留在注释里**。
- **一条被推翻的自身判断（记在这里以免重犯）**：本轮我曾写下"\`authoritative-tech.ts\` 是工厂、\`authoritative.ts\` 是直接实现，两种调用约定并存"。**复核实测后这是错的**：两处的 `*Search` 全部是 `(doFetch: HttpFetch = realFetch)` 工厂，arity 皆为 0，无参调用一律返回 `function`，`AUTHORITATIVE_SOURCES` 的每个值也都是 `function`。**约定是统一的。** 我"误用"的原因是**没看清签名就传参**，不是 API 设计有问题  把它写成"设计缺陷"会让人去"修"一个不存在的问题，而真正的修法是**读签名**。

## Verification

- `bash components/HX-Sagasu/scripts/test.sh` → **145 tests / 145 pass / 0 fail**（净增 4 项：3 条 Telegram 搜索 + 1 条双路检测；另改写 2 条旧断言）
- **真网络实测**（不是夹具）：`makeTelegramAdapter().search('durov telegram', {limit:3})` → 3 条真实帖子；`durov zzzznotfound` → `[]`；`Rust 所有权` → `AdapterError(unsupported)` 且消息含"频道"
- **新夹具来自真实响应**：`tests/fixtures/telegram-search.html`（`t.me/s/durov?q=telegram`，20 KB，保留 3 个 data-post 块）
- **`IMPL_OWNER` 表在写入时立刻抓到一处遗漏**：11 个第 0 层来源没有登记归属 → 补齐后才转绿。**这条测试第一次运行就证明了自己有用。**
- **原生掘金实测 20 条**（《Rust 所有权与借用：从堆栈开始建立心智模型》等），确认双路的主次正确
- 三条 Telegram 搜索测试覆盖：真有命中、纯关键词显式拒绝、0 条是合法空数组
