# 模板 2：一条判据(门禁脚本)骨架

来源：assets/source/skeletons.md 第 2 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

<!-- source-section:start -->
## 2. 一条判据(门禁脚本)骨架

```js
// scripts/gates/<lang>/check_<x>.mjs
//
// 拦什么: <一句话, 与 run.mjs 的 label 同源>
// 判据真源: <阈值常量 / 生成器 / 配置开关>  这里就是真源, 别在文档里抄第二份
// 豁免语义: <白名单文件路径 + 条目语法 + "陈旧条目 = FAIL">
// 扫描根: 环境变量 CHECK_X_ROOT(默认仓库根)  探针靠它把夹具指到临时目录
// 只读模式: --check 只校验不写; --list 只报告恒 exit 0
// 决策记录: <本仓记录位置 + 相对路径>

const ROOT = process.env.CHECK_X_ROOT ?? process.cwd()

// 退出码: 0 = PASS / 1 = FAIL / 2 = 用法错(部分脚本另有 3 = 扫描或导出失败)
// 状态行: `ok  ` / `OVER` / `BAD ` / `MISS`(体量类), 逐行 width 对齐, 便于人一眼扫
// 失败信息必须可操作: 打印修复动作(如"拆到 impl/ 子目录"), 而不是只说"不符合规范"
```

Python 侧(需要 `ast` 时): 用 Python 脚本 + `ast`，**不要用正则**分析语法结构 
字符串里的 `fetch(`、注释里的示例代码都会变成误报。头部注释按同样六行写。

<!-- source-section:end -->
