# 模板 9：`lefthook.yml`

来源：assets/source/skeletons.md 第 9 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

适配要求：宿主已有 husky/pre-commit 等则复用；pre-commit 可包含快速阻断检查。格式化不能把用户未暂存的其他改动混入本次提交，必须测试部分暂存文件。

<!-- source-section:start -->
## 9. `lefthook.yml`

```yaml
pre-commit:
  jobs:
    # 顺序执行(并行会让 whitespace 读到大修前的索引, 产生假失败)
    - name: <formatter>
      root: <子目录>/            # 让 {staged_files} 相对它解析, 别用 cd(会拼出 <子目录>/<子目录>/…)
      glob: "<子目录>/**/*.{ts,tsx,js,jsx,json}"
      run: node node_modules/<formatter>/bin/<tool> check --write --no-errors-on-unmatched {staged_files}
      stage_fixed: true          # 自动回填暂存区
    - name: whitespace
      run: git diff --cached --check   # 只检查, 不修

pre-push:
  parallel: true                 # 各条互不依赖, 受最慢那条支配
  jobs:
    - name: verify:<组>
      run: npm run verify:<组>    # 与本地/CI 跑同一条命令, 不另写一套
```

分工: **pre-commit 只做"快 + 能自动修"的事**(失败时人能自己改好再提交, 预算 <5s);
贵的(覆盖率、e2e、全部负向探针)在 push 与 CI 各付一次。markdown 通常**刻意不进** formatter
(会强按列宽 padding 表格)。

<!-- source-section:end -->
