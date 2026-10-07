# GitHub Actions 适配骨架

原第 10 节只描述 CI 职责, 其 version/stages 不是 Actions 格式. 以下是合法结构起点, 假设目标项目已存在 npm run verify: backend/frontend/gates 三个命令; 实施前换成当前项目实际入口、包管理器及 Node 版本, 缺一端就移除相应 job 与聚合条件. 依赖安装步骤按锁文件补齐, 不能运行不存在的命令或保留空 job

~~~yaml
name: quality
on:
  pull_request:
  push:
permissions:
  contents: read
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # 在此按项目锁文件安装后端及验证工具依赖
      - run: npm run verify:backend
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # 在此按项目锁文件安装前端依赖
      - run: npm run verify:frontend
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # 在此按项目锁文件安装探针工具依赖
      - run: npm run verify:gates
  quality:
    if: always()
    needs: [backend, frontend, gates]
    runs-on: ubuntu-latest
    steps:
      - name: Require all selected checks
        env:
          BACKEND: ${{ needs.backend.result }}
          FRONTEND: ${{ needs.frontend.result }}
          GATES: ${{ needs.gates.result }}
        run: |
          test "$BACKEND" = success
          test "$FRONTEND" = success
          test "$GATES" = success
~~~

全量骨架不做路径过滤, 因此任何 skipped/cancelled/failure 都不算通过. 若引入动态 lane, 先给每个预期跳过的 job 建可判定的原因, 再调整聚合; 测试前端单改、后端单改、两端混合、共享配置变更及 job 失败/取消/异常跳过. 不要把顶层 paths 过滤造成未生成的必需检查当通过

需要时加 merge_group 事件以支持目标仓 merge queue; 只有证据表明正在使用才配置. 用户确认后才修改托管端 ruleset/branch protection, 将聚合项设必需; 只落 YAML 不宣称托管端已强制. 不得为不可信 PR 使用带写权限的凭据执行其代码
