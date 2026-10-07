# Agent Note: 界面设计系统独立成包  HX-VettaUI 的边界与那三条不许改的约束

Status: implemented

- 影响: `components/HX-VettaUI/`（新建）、`HXLoLi/ai-docs/002-程序语言/003-Web前端/002-OpenVetta界面设计系统拆解/`（新建）
- 上游: **open-vetta（Apache-2.0）** 的 `apps/desktop/DESIGN.md` 与 `apps/desktop/src/renderer/styles.css`

## Problem

需要一套能复用的界面视觉，但手上没有。从 open-vetta 拆来的规范里有一批取值与写法
（`@theme inline` 桥接、卡片零阴影、1px 全局线条、`steps(16)` 动画调度）是**成体系互相支撑**的，
拆一半就会互相打架：改掉 1px 线条而保留零阴影，卡片就失去唯一的分层手段；
去掉 `@theme inline` 而保留 token 变量，组件里的 `bg-primary/10` 就没有来源。

同时它必须能被搬进别的项目，那些项目**不一定用 Tailwind v4**。

## Decision

**独立成 `components/HX-VettaUI/`，自成一个 npm 包，带可运行的演示页。**

### 为什么独立成包而不是放进 HXLoLi 站点

HXLoLi 是 Docusaurus 站点，它的 `src/` 里放的是站点自己的组件（导航、主题切换、笔记渲染）。
把这套设计系统放进去会造出一个**单向依赖**：站点组件依赖设计系统，而设计系统
反过来无法被任何非站点项目使用。放在 `components/` 下与 HX-Sagasu 同层，则是**平级**的。

### 三层必须拆开，因为它解决的是三种不同的人

| 层 | 内容 | 谁要 | 依赖 |
|---|---|---|---|
| 令牌 | `src/tokens.css` | 只想换配色的人 | **零** |
| 桥接 | `src/styles.css` | 想写 `bg-primary/10` 的人 | Tailwind v4 |
| 组件 | `src/components/` | 想直接用的人 | React 19 + radix-ui |

关键是 `tokens.css` **不 import Tailwind**。这一条让"搬不进 Tailwind v4 项目"这个限制
只降到桥接层，令牌层对任何项目都可用。

### 三条不许改的约束

**一、令牌是唯一事实源。** 组件里出现 hex、`rgb()`、`hsl()` 或 Tailwind 默认调色盘，
就等于把换肤能力砍掉。改成 `color-mix(in srgb, var(--x) N%, transparent)`。

**二、卡片默认零阴影。** 这条与"所有线条 1px"是**配套的一对**：去掉阴影之后，
分层只剩边框与半透明底色两个手段，而 1px 是这两个手段能成立的前提（更粗的边框
会把"安静"直接破坏掉）。改一条必须同时改另一条。

**三、指示动画走 `steps(16)` 调度器，不写 CSS 关键帧。**
`src/lib/live-animations.ts` 用 Web Animations API 挂动画，并把 `startTime` 锁到文档时间线原点。
改成 CSS 关键帧能跑、看起来一样，但会丢掉"全页同拍"这个性质  指示器开始各转各的。
CSS 侧只写静止态（相位 0 的外观必须是正常外观），这也是减少动态偏好下能零分支降级的原因。

### 桌面端那一组单独放

macOS 毛玻璃、窗口拖拽区、原生光标都依赖 Electron 宿主选项，因此收进 `src/desktop/`
并一律带 `:root[data-platform="mac"]` 前缀。纯 Web 环境不打这个标记，整组不命中。

## Alternatives considered

**什么都不做，直接把上游仓库当参考。** 最强的理由是它零维护成本，我们只需要读文档。
否决它的原因:规范说的是"应该怎样"，而真正会被复制的是一行行类名  上游的类名散在
数百个组件里，每次要用都得回去翻，而规格文件里那些数值（`0.04~0.06` 的 stagger、
`280~320` 的 stiffness）本来就该以代码形式存在。

**把令牌内联进站点已有的 Tailwind 配置。** 最强的理由是 HXLoLi 已经在用 Tailwind，
增量最小、无需新构建链。否决它的原因:那样产出的东西与站点绑死，正是上面
"单向依赖"要避免的形状；而且站点的 Tailwind 配置是给内容页用的，
把桌面客户端的令牌混进去会让两边都难以独立演进。

**只做一份 `tokens.css`，不做组件。** 最强的理由是复用门槛最低、维护面最小，
且文档里的类名示例已经够用。否决它的原因:交付里最贵的那部分恰恰是**组件约束**
（按钮不许手写、Dialog 宽度为什么用单条 max-width），这些只在有可运行组件时
才会被真正遵守；一份没有实现的 token 文件无法证明它自己好用。

**把桌面端那几条也塞进主分组。** 最强的理由是使用者只需要引一个文件，心智负担小。
否决它的原因:纯 Web 使用者会引入一堆永不生效的规则，而毛玻璃那条依赖
`--sidebar-vibrancy-tint` 这类只在 Electron 下有意义的变量，混在一起会让人
误以为纯 Web 也能还原毛玻璃。

## Consequences

- 新增一条构建链（Vite 8 + Tailwind v4）。仓库的其余部分仍无 `package.json` 约束，
  这一包自带 `package.json` 与 `node_modules`（已 gitignore），不污染其它组件。
- 演示页是**视觉回归的落点**：改令牌后看它，比读测试更能发现感官层面的破坏。
  亮暗两态都要看，因为亮色不是暗色的反相（主色从 `rgb(99,102,241)` 压到 `rgb(79,70,229)`）。
- 上游为 Apache-2.0，允许商用与再分发，复现物中已保留出处标注。
- 本次只搬了 token 与组件分层，**没有搬主题运行时**（三档能力、props 契约、manifest）。
  上游那两者之间是有契约的，只搬一半意味着这半边的稳定性由我们自己承担。
- 与上游的偏差如实记在笔记的 `.hx-info.md` 与盲审报告里，未把推断写成事实。
