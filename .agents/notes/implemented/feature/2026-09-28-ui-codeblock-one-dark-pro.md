# Agent Note: 代码块用 shiki 加 One Dark Pro, 外壳色与语法色的来源是分开的

Status: implemented

- 影响: `components/HX-UI/src/layout/CodeBlock.tsx`（新建）、`docs/src/pages/CodeBlockPage.tsx`（新建）
- 上游: open-vetta（Apache-2.0）的 `packages/theme-ui/src/shared/SyntaxHighlightedCode.tsx`
- 外部: One Dark Pro 3.20.2（Binaryify/OneDark-Pro, MIT）、shiki 4.4.3 的 `@shikijs/themes/one-dark-pro`

## Problem

界面里要放代码，而代码的着色方式决定它看起来是否专业。可选项有三类：
正则近似匹配（highlight.js / prism）、编辑器同款语法引擎（shiki / VS Code 的 TextMate 语法）、
以及可编辑的编辑器内核（Monaco / CodeMirror）。

同时有一个外观问题：代码块的**外壳**（标题栏、行号列、边框）与**语法区**（token 着色）
如果各用一套颜色，接缝会露出来；但两者的权威来源并不是同一个。

## Decision

**用 shiki，主题写死为 One Dark Pro，且外壳色不从 shiki 包里取。**

### 为什么是 shiki

正则方案在嵌套与边缘写法上会错色  模板字符串里的插值、JSX 内的表达式、
泛型里的比较符，这些地方一旦着色错位就很显眼。shiki 直接跑 VS Code 的 TextMate 语法，
结果与编辑器一致。Monaco / CodeMirror 是**可编辑**内核，这个组件只需要**只读展示**，
引进来要多背一个编辑器运行时。

### 主题写死，不给调用方切

允许换主题等于允许每个使用方各自发明一套代码配色  那正是这套设计系统要消除的东西。
亮色页面里同样用深色代码块：这是常见且被接受的对照手法，不需要另配一套浅色语法色。
需要改外观时改 `CODE_THEME` 这一个常量。

### 外壳色与语法色的权威来源不同, 这一点必须记住

- **语法色可以信 shiki。** 已逐条实测：shiki 的 275 条 `tokenColors` 与官方
  `themes/OneDark-Pro.json` **完全相同**（顺序、`name`、scope 数组形态都一致）。
  渲染出的色值也吻合：keyword `#C678DD`、string `#98C379`、number `#D19A66`、
  comment `#7F848E` + italic、function `#61AFEF`、variable `#E06C75`、type `#E5C07B`。
- **UI 色不可以信 shiki。** shiki 的 `colors` 是官方 222 键的**裁剪子集**（只留 143 键），
  另有 5 键（`editorGroup.background`、`editorOverviewRuler.addedBackground` 等）是旧版残留，
  已不在官方定义里。所以 `ONE_DARK_PRO` 那组值取自官方 `editor.*` 项，不从包里读。

### 两处流传较广的错误写法, 不要"修"成它们

这两条都已实测渲染确认，写进源码注释就是为了拦住下一个想把它们"改对"的人：

- **注释色是 `#7F848E`，不是 `#5C6370`。** 官方只在 `comment markup.link`、
  `punctuation.definition.tag.xi`、`markup.quote.markdown` 三处用 `#5C6370`。
- **算术 / 比较 / 赋值算子走 `#56B6C2`，不是 `keyword.operator` 的 `#ABB2BF`。**
  实测 `=` `+=` `!==` `*` `>` 全为 `#56B6C2`；只有 `keyword.operator.new|instanceof|ternary`
  才是 `#C678DD`。凭 `keyword.operator` 这一条去推算术算子会推错。

### 缓存与降级照搬上游

- 高亮结果按 `[主题, 语言, 源码]` 缓存，上限 128 条。虚拟列表里条目滚出视窗会被卸载、
  滚回来重新挂载；没有缓存时每次重挂都要重跑 shiki，并且先渲染纯文本再换 HTML 
  高度变两次，列表跟着重测量两次，表现是往回滚时卡顿加跳动。
- 超过 30000 字符、单行超 2000 字符、或超 1000 行的代码**不跑高亮**，退回纯文本。
  完整内容仍可读可复制，比让一次超大粘贴卡住界面要好。

## Alternatives considered

**什么都不做，用 highlight.js 或 prism。** 最强的理由是它们体积小、同步返回、
无需异步等待，而且对常见语言"看起来也对"。否决它：这类方案是正则近似匹配，
在嵌套与边缘写法上会错色，而错色恰恰是最容易被一眼看出来的那种不专业。

**用 Monaco 或 CodeMirror。** 最强的理由是它们与 VS Code 完全同源，能顺带拿到
折叠、搜索、多光标。否决它：这个组件要的是只读展示，引编辑器内核要多背一个运行时，
而只读场景用不到它的任何独有能力。

**把主题做成 prop，允许调用方切。** 最强的理由是灵活，用浅色页面的人可以配浅色语法。
否决它：代码块的配色是这个组件的外观契约，一旦开放就退化成"每个使用方各自发明"，
而那正是这套设计系统存在的原因。

**从 shiki 包里读 UI 色，省得另查官方文件。** 最强的理由是一个数据源更简单，
不会出现两处不一致。否决它：实测 shiki 的 `colors` 比官方少 79 键并有 5 键旧版残留，
拿它当 UI 色的来源会在某些键上悄悄取到过期值。

**只做展示、不做标题栏与行号。** 最强的理由是上游就没有，保持最小实现。
否决它：文档与笔记场景里代码块需要标明语言、需要能复制、长代码需要行号定位，
这些是使用方提出的实际需求，不是装饰。

## Consequences

- 新增一个运行时依赖 `shiki`（含 `@shikijs/themes`）。它是按需加载语法的，
  但首次高亮某语言会异步运行  组件因此在加载期渲染纯文本，这是**有意的**，
  不是缺陷。
- 主题锁定意味着**不支持浅色代码块**。要支持就得同时确定一套浅色语法色，
  那是一个独立决策，现在没有做。
- 官方 One Dark Pro 有 5 个变体（默认 / darker / mix / flat / night-flat），
  shiki 的 `one-dark-pro` 对应**默认版**（`editor.background` 为 `#282c34`）。
  想换变体不能只改 `CODE_THEME`，darker 与默认之间有 22 个 UI 键的差异。
- 核实结论与实测数据写在 `CodeBlock.tsx` 的注释里，紧挨着会被误改的那两个常量 
  这是它们唯一被引用的位置。
