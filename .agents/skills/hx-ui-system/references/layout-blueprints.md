# 布局蓝图

四种结构覆盖绝大多数"看起来像专业工具"的界面. 每份都给可抄的类名, 不是示意图

取自 open-vetta 的真实实现; 想逐行核对时读`ai-docs/002-程序语言/003-Web前端/002-OpenVetta界面设计系统拆解/` 的 `0x09` 与 `0x0A` 两节

## 一、应用外壳: 外留白 + 两块圆角面板

这是"像应用"与"像网页"的分界线. 不留那条缝, 界面会顶满窗口四边

```tsx
<div className="relative isolate flex h-screen w-screen flex-col overflow-hidden bg-background">
  <div className="relative z-10 flex min-h-0 flex-1 gap-2 p-2">   {/* 8px 留白 + 8px 面板间距 */}
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-border/40 bg-card/25 backdrop-blur-sm">
      <div className="h-11 shrink-0" />                           {/* 顶部留白 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2.5 pb-2.5">{nav}</div>
      <div className="border-t border-border/40 px-2.5 py-2">{footer}</div>
    </aside>
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/40">
      {content}
    </main>
  </div>
</div>
```

两个易错点

- 侧栏内部滚动的那层必须 `min-h-0 flex-1`, 而**它的子项**要用 `h-full` + `overflow-y-auto`. 子项若写 `flex-1`, 在纵向 flex 里只影响主轴尺寸, 撑不出滚动区  内容会直接溢出到可视区外被裁掉
- 主区面板**不要**加 `bg-card`. 它该是页面底色, 否则会挡住下面的纹理层

## 二、内容居中: 版心靠 max-width, 不靠栅格

```tsx
<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
  <h1 className="text-[20px] font-bold text-foreground">{title}</h1>
  <p className="mt-1.5 mb-6 text-[12px] text-muted-foreground">{desc}</p>

  <section className="mb-6">
    <h2 className="mb-3 text-[15px] font-semibold text-foreground">{sectionTitle}</h2>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">{cards}</div>
  </section>
</div>
```

整页只有**两个**间距值在重复: 分区之间 `mb-6`, 分区标题与内容 `mb-3`. 扫视时不会被打断, 这就是"整齐"的来源

## 三、两级导航: "展开"是选中态的表现

导航项可以带下级入口. 不要把"哪些组展开了"做成独立 state  那会引入"选中项藏在一个收起的组里"这类自相矛盾

```tsx
const expanded = expandable && (activeTab === item.key || activeParentKey === item.key)
```

选中即展开, 切走即收起. 深链直接进到某个下级入口时, 它所属的标签就是当前标签, 因此同样自动展开

布局上: 分组标题是一整行可点区域 (不是两个独立热区), 箭头只动 transform

```tsx
<span className={cn("icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 transition-transform duration-200",
                    expanded && "rotate-180")} />
```

下级项缩进 `ps-3.5`, 选中态用 `bg-accent/70`, 未选中 `text-muted-foreground`

## 四、分隔线是一条浮着的 1px 竖线

不要用两块面板的边框去拼分隔  那会得到两条线. 正确做法是一条独立的绝对定位元素

```tsx
<div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
  {/* bottom-11: 底部留 44px 不到底, 所以它是"浮着的分隔", 而不是把页面切成两半 */}
  <div className={cn("pointer-events-none absolute top-0 bottom-11 w-px bg-border",
                     narrow ? "left-14" : "left-[200px]")} />
  <nav className="flex shrink-0 flex-col">{sidebar}</nav>
  <div className="min-w-0 flex-1 overflow-y-auto">{content}</div>
</div>
```

## 五、选择器: 选中只改 1px 边框色

一组可选项 (主题 / 模式 / 装饰件) 的通用写法定成常量复用

```tsx
const SELECTION_ACTIVE = "border-primary/50 bg-primary/10";
const SELECTION_IDLE   = "border-border/60 hover:border-primary/40 hover:bg-accent/40";
```

**不要**在选中态再叠 `ring`: 同一根边框上 `border` + `ring-inset` 会变成约 2px 的双线, 而全局线条约定是 1px

选中徽标浮在卡片右上角, 用半透明 + 模糊保证压在任意底色上都读得清

```tsx
<span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-background/85 shadow-sm backdrop-blur-sm">
  <span className="icon-[solar--check-circle-linear] h-3.5 w-3.5 text-primary" />
</span>
```

## 六、预览卡: 不截图, 用真实色值实时画

需要"主题预览"这类卡片时, 不要准备图片. 用该主题的色值画一个**结构等价**的缩略模型  加一个主题就自动多一张预览, 且预览永远不可能与真实配色不一致

```tsx
const colors = [palette.primary, palette.accent, palette.ring, palette.chart1, palette.chart2];
<div style={{ background: palette.background }} className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border/60">
  {/* 氛围层: 五个圆被父层统一糊开 */}
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="relative aspect-square w-[180%]" style={{ filter: "blur(28px) saturate(115%)" }}>
      {BLOB_LAYOUT.map((b, i) => (
        <div key={i} className="absolute"
             style={{ left: b.left, top: b.top, width: b.w, height: b.h, transform: `rotate(${b.rotate}deg)` }}>
          <div className="h-full w-full rounded-full" style={{ background: colors[i] }} />
        </div>
      ))}
    </div>
  </div>
  {/* 迷你窗口: 三圆点标题栏 + 四条不同宽度的文字条 + 两个按钮块, 全用该主题的色值 */}
</div>
```
