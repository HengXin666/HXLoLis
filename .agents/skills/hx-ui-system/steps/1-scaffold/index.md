# 1 scaffold  把令牌落成文件

## 只做这一件事

建工程骨架, 把 `assets/` 里的两个文件放进项目并跑通. **不做页面, 不写组件. **

## 产物

- `src/tokens.css` (拷自 `assets/tokens.css`)
- `src/styles.css` (拷自 `assets/styles.css`, 它 import 上面那份)
- Vite + React 19 + Tailwind 4 的配置

## 依赖

只装必要的: `react` `react-dom` (运行时); `vite` `@vitejs/plugin-react` `tailwindcss` `@tailwindcss/vite` (构建). 再加组件原语与类名合并: `radix-ui` `class-variance-authority` `clsx` `tailwind-merge`

**没有 `postcss.config.js`, 也没有 `tailwind.config.js`**  Tailwind 4 的配置全部写在 CSS 里. 看到这两个文件说明用了旧的搭建方式, 删掉

## 过关条件

跑 `vite build` 通过, 且一个用 `bg-card` / `text-muted-foreground` 的测试元素能算出真实颜色

验证方式 (不要靠肉眼): 起 dev server, 用浏览器读 `getComputedStyle`. `--primary` 若能读到具体色值、卡片能算出 `box-shadow: none` 与 `1px` 边框, 才算真的接上了

## 实际做法

```bash
cp assets/tokens.css src/
cp assets/styles.css src/     # 内含 @import "tailwindcss" 与 @theme inline 映射
```

`src/main.tsx` 里 import `./styles.css`. `index.html` 的根元素写 `data-mode="dark"`  暗色是默认
