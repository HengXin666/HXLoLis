# 2 surface  搭具体页面

## 只做这一件事

用 `references/layout-blueprints.md` 的结构搭页面. **不定契约, 不碰后端. **

## 先读

`references/visual-rules.md` (写任何 `className` 之前) 与 `references/layout-blueprints.md` (选结构)

## 产物

应用外壳 + 至少一个内容区. 外壳是"像应用"与"像网页"的分界线, 必须先立住

```tsx
<div className="relative isolate flex h-screen w-screen flex-col overflow-hidden bg-background">
  <div className="relative z-10 flex min-h-0 flex-1 gap-2 p-2">
    <aside className="... rounded-xl border border-border/40 bg-card/25">{nav}</aside>
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/40">
      {content}
    </main>
  </div>
</div>
```

那条 8px 外留白与 8px 面板间距不能省. 省掉之后侧栏与主区贴成一块, 圆角也就白设了

## 过关条件

`node ../hx-ui-system/scripts/check-ui-rules.ts src` 零 ERROR

## 两个高频错误

- 纵向 flex 里的滚动容器: 容器自己写 `min-h-0 flex-1`, **它的子项**写 `h-full overflow-y-auto`. 子项若写 `flex-1`, 在纵向 flex 里只影响主轴尺寸, 撑不出滚动区, 内容会溢出被裁
- 主区面板不要加 `bg-card`: 它该是页面底色, 否则会挡住下面的纹理 / 光晕层
