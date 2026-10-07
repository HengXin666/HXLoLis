# Agent Note: 复刻上游界面靠 vendored 源码 + 假宿主, 而不是照着重画

Status: implemented

- 影响: `components/HX-VettaMirror/`（新建）、`ai-docs/002-程序语言/003-Web前端/002-OpenVetta界面设计系统拆解/ui-mirror.html`（新建）
- 上游: **open-vetta（Apache-2.0）** 的 `packages/ui` + `packages/theme-ui` + `packages/theme-sdk`
- 相关: [2026-09-27-vetta-ui-design-system-package](2026-09-27-vetta-ui-design-system-package.md)、[2026-09-27-vetta-ui-embedded-via-sidecar](2026-09-27-vetta-ui-embedded-via-sidecar.md)

## Problem

前一轮交付的是 `components/HX-VettaUI`  从上游规范**重实现**的一套组件。它能用, 但它像而不是是: 布局比例、图标密度、动效细节都要靠我对文档的理解去猜, 猜不准就没法复刻。

用户的诉求很直接: **要一个确定的、可以逐像素核对的原版预览**。

## Decision

**把上游前端源码整包 vendor 进来, 写一个假宿主喂数据, 让它的组件原样渲染。**

### 为什么这条路成立

上游把界面切成三层: 数据层 / UI 抽象层(model) / UI 实现层(组件)。实测 `packages/theme-ui` 里
**零处** import `@shared/*`、`@domains/*`、`window.vetta`、`jotai`  组件只吃 model, 不知道数据从哪来。
所以只要构造一份形状正确的 model, 脱离 Electron 也能原样跑。

这是"复刻"与"照着重画"的分界: 渲染出的每个像素都出自上游源码, 本仓库一行没改它的组件。

### 三个包都不发布, 只能拷源码

`packages/ui`、`theme-ui`、`theme-sdk` 的 `package.json` 都是 `"main": "./src/index.ts"`,
没有 dist、没有 npm 制品。`scripts/sync-vendor.sh` 负责从 `ref/open-vetta` 或 GitHub 拉取,
并带上 `LICENSE` / `NOTICE` / commit 记录。

### 必须深导入, 否则产物爆炸

`theme-ui` 的 `exports` 有 30 个子路径。从 `index.ts` 整体导入会把整棵依赖树
(shiki / codemirror / three) 拉进产物: 实测 **487 KB → 10.8 MB**。深导入到具体文件后回落。

### 素材必须保留 alpha, 而这条链上有三个静默陷阱

白鼬的透明存在 VP9 流内 (stream tag `alpha_mode=1`), 压缩时连着踩了三次:

1. **默认解码器会丢掉 alpha。** `ffmpeg -i in.webm ...` 读不到那条流, 重编码出来 alpha 全 255,
   界面上就是一个黑方块; 而 `ffprobe` 依然报 `pix_fmt=yuv420p` 一切正常。必须 `-c:v libvpx-vp9` **放在 `-i` 之前**。
2. **重编码要显式保留 alpha 平面**: `-vf "scale=...,format=yuva420p"`。
3. **验证只能用浏览器读像素。** `alphaextract` 抽帧同样看不见这条流; 唯一可信的判据是
   `canvas.drawImage(video)` 后数 `alpha==0` 的像素占比 (原始约 0.80, 压缩后应接近)。

### 内嵌仍是上一轮那条侧车路线

沿用 `#ppt` + 自包含单文件。三个新增约束:

- 动态 import 要关掉 (`build.rollupOptions.output.inlineDynamicImports`), 否则会拆出
  `/assets/xxx.js` 外部引用, 内嵌后 404。
- 单文件构建脚本对未内联资源**直接退出非零**, 不留"警告但照常产出"。
- 素材路径在源码里必须是**完整字面量**, 不能模板串拼接  否则打包后只剩碎片, 内联脚本认不出。

## Alternatives considered

**继续完善 HX-VettaUI (重实现那条路)。** 最强的理由是它已经完全可控: 代码是本仓库的,
不依赖上游快照, 也不受上游改版影响。否决它的原因: 它永远只能是"像", 而用户明确要的是
"确定"  重实现意味着每个溢出、每个间距都是我猜的, 猜错的地方用户无法自行核对。

**直接跑上游 Electron 应用。** 最强的理由是那是 100% 原始形态, 连交互都是真的。
否决它的原因: 它需要 bun + 完整 monorepo 安装 + Electron 运行时, 而且产物是一个需要
本地启动的桌面程序, 无法嵌进笔记给读者看。

**只放官方截图。** 最强的理由是零构建、零维护、绝对准确。否决它的原因: 截图是死的,
看不到交互态 (会话切换、工具调用块折叠), 也无法作为"可复现"的凭据。

**把整棵 theme-ui (457 文件) 都复刻。** 最强的理由是完整。否决它的原因: 设置页 / 文件树 /
技能页都依赖大量与观感无关的宿主数据, 造假数据的成本远超收益, 且本次要证明的是
"主界面能被原样复刻", 侧边栏 + 新会话页 + 对话流已经覆盖。

## Consequences

- `components/HX-VettaMirror` 与 `components/HX-VettaUI` **并存**: 前者是保真复刻 (预览用),
  后者是可复用包 (落地用)。它们服务不同目的, 不要合并, 也不要因为"重复"删掉任一个。
- 上游更新后跑 `npm run sync-vendor` 即可刷新; vendor 目录已 gitignore, 不进版本管理。
- 本次只复刻主界面三块 (侧边栏 / 新会话首屏 / 对话流), 其余区域用假数据成本过高, 未做。
- 假宿主 (`src/fake-host.ts`) 是唯一需要随上游 model 契约演进的部件; 它一旦报
  "Theme host does not provide ... capability", 说明上游加了新的宿主能力。
- 这条链上三个 alpha 陷阱与深导入那条实测数据, 都已写进 `scripts/sync-vendor.sh` 的注释与
  笔记正文, 避免下次重踩。
