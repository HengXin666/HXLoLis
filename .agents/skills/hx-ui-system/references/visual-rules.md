# 视觉规范 (可机械检查的那部分)

每一条都给出**禁令 + 替代写法**. 判据由 `scripts/check-ui-rules.ts` 强制, 违反即失败

来源: open-vetta `apps/desktop/DESIGN.md`, 那是可以逐条核对的硬规范; 同仓库另有`ai-docs/002-程序语言/003-Web前端/002-OpenVetta界面设计系统拆解/` 一篇拆解, 需要背景时读它

## 颜色只有一个来源

颜色只能来自 CSS 变量, 经 `@theme inline` 暴露成语义工具类. 组件里**禁止**出现色值

| 用途 | 写法 |
|---|---|
| 页面底 | `bg-background` `text-foreground` |
| 卡片面 | `bg-card` `bg-card/40` |
| 浮层面 | `bg-popover` |
| 主色 | `bg-primary` `text-primary` |
| 次要面 | `bg-secondary` `bg-muted` `bg-accent` |
| 次要文字 | `text-muted-foreground` |
| 边 / 输入 / 环 | `border-border` `bg-input` `ring-ring` |
| 危险 | `bg-destructive` `text-destructive` |

- alpha 只允许十档: `/5 /10 /15 /20 /25 /30 /40 /50 /60 /70 /80`. 随手写 `/37` 会毁掉跨组件的透明度一致性
- 需要透明混合写 `color-mix(in srgb, var(--primary) 10%, transparent)`, 不写内联 style 色值
- Tailwind 默认调色盘整组禁用. 只放行两种原色当语义色: 成功/运行 `bg-emerald-500/15 text-emerald-400`、警告/可更新 `bg-amber-500/15 text-amber-400`; 错误必须走 `destructive` token, 不用 `red-*`
- 业务标签 (自定义 / 实验 / Beta) 一律降级为 `bg-primary/10 text-primary` 或 `bg-accent/60 text-muted-foreground`

## 层级靠 1px 线和半透明底, 不靠阴影

卡片基线可以直接抄

```tsx
<div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm
                transition-colors duration-200 hover:border-primary/40 hover:bg-card/60" />
```

- hover 只换边框色与背景透明度, 不加阴影、不放大、不平移不超过 2px
- 阴影白名单: Popover / Dropdown / Dialog 用 `shadow-md` 或 `shadow-lg`; 拖拽元素 `shadow-lg`; Toast 用 `shadow-md`; **普通卡片、列表项、grid 卡一律无阴影**
- 禁止主色发光阴影 (`shadow-[0_4px_16px_-6px_var(--primary)]` 这种), 禁止任何 `shadow-[...]` 任意值
- 强调态用 ring 不用阴影: `ring-1 ring-inset ring-primary/30` + `bg-primary/10` + `border-primary/40`
- 所有线条 (border / ring / outline / divider) 统一 1px. 想加重分隔就改颜色深度, 不加粗

## 形状与密度

圆角按元素角色分档, 全部由一个 `--radius` 变量派生 (`calc(var(--radius) ± 2~4px)`)

| 元素 | 圆角 |
|---|---|
| 卡片 / 面板 / grid 卡 | `rounded-xl` |
| 列表项 / 输入框 / 常规按钮 | `rounded-lg` 或 `rounded-md` |
| 高度 ≤ 9 的小 chip | `rounded-lg` |
| pill / 标签 / segmented control / 圆形图标按钮 | `rounded-full` |
| Hero 或超大装饰容器 | `rounded-2xl` (全场只允许一处) |

禁止 `rounded-3xl` 及以上、禁止 `rounded-[Npx]`

字号只放行七档: `text-[10px]` `[11px]` `[12px]` `[13px]` `[14px]` `[15px]`, 再加 `text-[20px]+` 专供统计数字

间距按容器角色给死: 紧凑列表项 `px-3 py-2.5`; 标准卡片 `px-3.5 pt-3 pb-3`; 宽松卡片 / 设置面板 `p-4`; 页面外层 `px-8`; Popover 内菜单项 `px-2.5 py-1.5`

网格列数**不写死**, 一律自适应

```tsx
className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5"
```

写死 `grid-cols-3` 的后果是窗口一变窄就塌

## 动效上限全是数字

| 场景 | 值 |
|---|---|
| 卡片 hover 位移 | `{ y: -2 }` 是上限, 不允许叠 scale / rotate / shadow |
| 按钮 hover 缩放 | `1.04` 上限 |
| 按钮 tap 缩放 | `0.94` 下限 |
| 进入动画 | `opacity 0→1` + `y 8→0`, 时长 ≤ 0.5s |
| stagger | `0.04` ~ `0.06`, `delayChildren` ≤ `0.15` |
| spring (入场) | `{ stiffness: 280~320, damping: 26 }` |
| spring (按钮) | `{ stiffness: 380, damping: 22 }` |

禁止四件事: 装饰性持续旋转或弹跳; 卡片 hover 同时叠 `scale`/`rotate`/`shadow`; 入场动画长于 0.6s; 写 `transition-all`

`transition-all` 被禁的理由是它会把**你没想到的属性**一起拉长  焦点圈、边框颜色、布局尺寸本来该瞬时切换, 被它一网打尽之后全变成一致的拖沓. 按钮与链接只过渡三个属性: `color`、`background-color`、`border-color`

## 按钮只有一个来源

操作按钮必须用共享 `<Button>` + variant, 禁止手写 `<button>` 自拼 `rounded-full bg-gradient-to-* px-4 py-2` 这类样式. 语义映射: 主操作 `primary`, 次要 `outline` / `secondary` / `ghost`, 危险 `destructive`. 微调位置与间距只传 `className`, 不重写整套视觉
