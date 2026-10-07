---
name: hx-ui-system
description: 用 open-vetta 那套设计语言从零搭一个 React + TypeScript 前端界面, 并把前后端契约层与界面规范变成可失败的机械门禁。产出设计令牌、Tailwind 4 桥接层、应用外壳与设置页布局、契约三层对偶 (通道常量 / 前端 api 层 / 后端路由), 以及两个校验脚本。用于用户说「我要做一套这种风格的界面」「怎么规范才能做出跟这个一样的 UI」「帮我搭个前端脚手架」「前后端接口怎么定契约」「UI 规范怎么落到门禁里」「设计令牌怎么组织」「主题换肤怎么做」「设置页那种布局怎么搭」时。
license: MIT
metadata:
  author: Heng_Xin
  version: "1.0"
---

# hx-ui-system

把"看着像专业工具"的界面拆成**可执行的文件**与**会失败的检查**

背景与逐行拆解在`ai-docs/002-程序语言/003-Web前端/002-OpenVetta界面设计系统拆解/`  只在需要理解"为什么这么定"时读它; 动手时按下面的步骤走即可

## 三条不可违反的原则

1. **只写文字规范等于没写. ** 每个约束都要有对应的机械检查. 模型每次只会挑一部分遵守, 而违反时没有任何反馈  这是"看起来按规范做了、实际处处漏"的根因
2. **颜色只有一个来源. ** 组件里出现任何色值 (hex / rgb / 默认调色盘) 都是错. 令牌改一行就该全站换肤; 做不到说明分层破了
3. **契约两边都要 import 同一份定义. ** 前端与后端各写一份通道名, 改一处漏一处, 而且编译期发现不了

## 步骤

| # | 步骤 | 只关心 | 契约 |
|---|---|---|---|
| 1 | scaffold | 把令牌、桥接层、外壳结构落成文件 | `steps/1-scaffold/index.md` |
| 2 | surface | 用蓝图搭具体页面 (外壳 / 列表 / 设置页) | `steps/2-surface/index.md` |
| 3 | contract | 定前后端契约: 通道、载荷、校验、广播 | `steps/3-contract/index.md` |
| 4 | gate | 接上两条门禁并确认它们**真的会失败** | `steps/4-gate/index.md` |

每一步只做一件事. 第 1 步不做页面, 第 2 步不定契约  混在一起会让"该看哪份参考"变得不可判断

## 参考 (按需读, 不要一次全读)

- `references/visual-rules.md`  什么时候读: 写任何带 `className` 的代码之前. 禁令与替代写法, 每条都有机械判据
- `references/layout-blueprints.md`  什么时候读: 搭应用外壳、列表页、设置页或选择器卡片时. 六份可直接抄的结构
- `references/contract-pattern.md`  什么时候读: 定前后端接口时. 三层对偶、通道命名、运行时校验、广播、状态放哪
- `references/node-ts-server.md`  什么时候读: 后端用 Node 直接跑 \`.ts\` 而不过构建步骤时. 有一条只在运行期暴露的硬约束, 不知道就会得到"类型检查全绿、服务起不来"

## 资产 (直接拷进项目)

- `assets/tokens.css`  什么时候用: 第 1 步. 设计令牌, 不依赖 Tailwind, 任何项目都能用
- `assets/styles.css`  什么时候用: 第 1 步. Tailwind 4 的 `@theme inline` 桥接层, 把变量接成工具类

## 脚本 (门禁, 会失败)

- `scripts/check-ui-rules.ts`  什么时候跑: 每次改完带 `className` 的代码. 查硬编色值、默认调色盘、超过 1px 的线条、越档圆角、`transition-all`、自定义阴影、绕过 api 层直接 fetch. `node scripts/check-ui-rules.ts src`, 退出码 1 = 有违规
- `scripts/check-contract.ts`  什么时候跑: 改动契约或 api 层之后. 查契约单边引用、手写通道字符串、缺运行时校验. `node scripts/check-contract.ts .`, 退出码 1 = 有违规

两个脚本都**必须真跑一次**. 只看它们"写好了"不算  一个永远通过的检查器等于没有检查器. 第 4 步给了制造违规样本的验证方法
