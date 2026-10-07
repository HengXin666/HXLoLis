# 交付物全集: 一套红线系统由什么组成

下面是一套**跑起来之后**的目录形状。它是从 weuinevolveweb 抽出来的,所以路径带本仓的习惯,
但分组与职责是可搬的:**每件东西只回答一个问题**, 缺了它对应的那个问题就没人回答。

`<...>` 是占位符; `<repo>` = 仓库根。

```
<repo>/
├── scripts/gates/
│   ├── shared/                     # 与具体语言无关的总线与元门禁
│   │   ├── run.mjs                 # 门禁总线: 唯一注册表 + 唯一入口
│   │   ├── hook-lanes.mjs          # lane 表: 哪种改动跑哪组门禁
│   │   ├── hook-input.mjs          # hook 入参读取(有超时, 绝不无限等 stdin)
│   │   ├── hook-guard.mjs          # PreToolUse: 拦不可逆命令
│   │   ├── hook-format.mjs         # PostToolUse: 清理 + 格式化(不阻断)
│   │   ├── hook-stop.mjs           # Stop: 只跑本轮落在的那条 lane
│   │   ├── probe-gates.mjs         # 负向探针: 证明每条判据真的会红
│   │   ├── check-gate-fingerprint.mjs  # 元: 口径一变就 FAIL, 逼你显式承认
│   │   ├── gate-fingerprint.json   # 指纹快照(两组来源)
│   │   ├── check-hooks.mjs         # 元: hook 冒烟 + lane 覆盖校验
│   │   ├── check-lint-ratchet.mjs  # 棘轮: 被关掉的 lint 规则只拦新增
│   │   ├── lint-ratchet-baseline.json
│   │   ├── check-arch-debt.mjs     # 棘轮: 白名单条目数只许降
│   │   ├── arch-debt-baseline.json
│   │   ├── check-doc-budgets.mjs   # 元: 注入上下文的体量预算
│   │   ├── doc-budgets.manifest.json
│   │   ├── check-notes.mjs         # 决策记录骨架 + 闭集
│   │   ├── check-note-links.mjs    # 决策记录 ↔ 代码 双向对账 + 管辖闭合
│   │   ├── note-citation-baseline.json
│   │   └── check-defensive-patterns.mjs  # 事故规则必须被测试/门禁钉住
│   ├── <lang-A>/                   # 按被检对象分, 不是按检查手段分
│   │   ├── check_arch.py           # 架构与分层(用该语言的解析器, 不用正则)
│   │   ├── arch_whitelist.txt      # 豁免(双向校验 + 登记上限)
│   │   └── <其它判据 + 各条基线>.json
│   └── <lang-B>/
├── .agents/settings.json           # agent hook 注册(每个 runtime 一份)
├── .claude/settings.json
├── lefthook.yml                    # pre-commit / pre-push
├── .ci.yml                         # CI: 完整矩阵
├── .agents/notes/                  # 决策记录(取代 docs/adr)
│   ├── README.md
│   └── {proposed,implemented,rejected,archived}/{architecture,bug-fix,feature,process,testing,simplification}/
└── docs/
    ├── <导览>.md                    # 这套东西的导览: 几道关卡 / 每道拦什么 / 靠什么不烂
    └── defensive-patterns.md       # 事故规则表: 每条必须带"证据"与"钉住"
```

## 六个分组, 各回答一个问题

### ① 总线: 门禁定义只有一份

|件|作用|缺了会怎样|最小形态|
|-|-|-|-|
|`run.mjs`|注册表 + 入口; 所有检查点共用|劈成"本地一套、CI 一套", 两边结论不一致|见 `skeletons.md` 1|
|`hook-lanes.mjs`|按路径前缀把改动分到一条 lane|改了东西却一条门禁都不跑, 且运行时看不出来|见 `skeletons.md` 7|

### ② 判据: 什么算违规

判据按**被检对象的语言**分目录, 不按检查手段分。共用书写约定(退出码 / 状态行 / 只读模式 /
扫描根可被环境变量覆盖)见 `skeletons.md` 2。

|件|作用|缺了会怎样|最小形态|
|-|-|-|-|
|`check_*`|一条一条确定性检查|规则停在文字级, 实际强度 0|见 `skeletons.md` 2|
|`*_baseline.json`|棘轮: 冻结存量水位, 只拦新增|只能选"全仓清零"(一个巨大的修 lint PR)或"不装"|见 `skeletons.md` 5|
|`*whitelist.txt`|豁免, 带双向校验与登记上限|豁免永远生效, 没人敢删|见 `skeletons.md` 6|
|`api-surface.json` 等快照|契约不漂移|对外表面与代码各说各话|生成器 + diff|

### ③ 自证: 凭什么信它

|件|作用|缺了会怎样|最小形态|
|-|-|-|-|
|`probe-gates.mjs`|对每条判据构造故意违规 + 控制组|永远 PASS 的门禁与正确的门禁在 CI 上是同一个绿色|见 `skeletons.md` 3|
|`gate-fingerprint.json`|口径一变就 FAIL, 逼你 `--update` 承认|放松一条门禁只需改一个数字, review 里毫不起眼|见 `skeletons.md` 4|

指纹必须分**两组**(`../references/self-defense.md` 有完整论证): 第一组管"有多严", 第二组管"还跑不跑"。
只做第一组 = 从注册表删掉一行, 门禁在全部检查点上同时消失而指纹照样绿。

### ④ 接线: 什么时候跑

|件|作用|缺了会怎样|最小形态|
|-|-|-|-|
|`settings.json`(每 runtime 一份)|agent hook 注册|判据存在但从不执行|见 `skeletons.md` 8|
|`lefthook.yml`(或等价)|pre-commit / pre-push|提交路径上没有任何检查和自动修|见 `skeletons.md` 9|
|`.ci.yml`|完整矩阵, 含最贵的那档|最贵的东西没人跑|见 `skeletons.md` 10|
|`check-hooks.mjs`|hook 冒烟 + lane 覆盖校验|hook 静默失效的表现和"没发现问题"完全一样|见 `skeletons.md` 7|

### ⑤ 记录: 为什么这么定

|件|作用|缺了会怎样|最小形态|
|-|-|-|-|
|`.agents/notes/**`|决策记录, 骨架/闭集/双向引用由门禁强制|半年后没人知道某条门禁为什么存在, 也没人敢删|见 `skeletons.md` 11|
|`defensive-patterns.md`|把"翻过的车"变成可执行约束|同样的车翻第二遍|见 `skeletons.md` 12|

### ⑥ 导览与预算: 让它自己能读、自己不会烂

|件|作用|缺了会怎样|最小形态|
|-|-|-|-|
|`docs/<导览>.md`|几道关卡 / 每道拦什么 / 靠什么不烂|新人(和 agent)不知道去哪看真源|见 `skeletons.md` 14|
|`doc-budgets.manifest.json`|注入上下文的文字有字节上限|喂给模型的文字每轮都付一次, 且原来没人管|见 `skeletons.md` 13|

## 三条跨交付物的不变量

1. **判据真源只有一份**。导览不抄门禁清单(抄了一定会漂), 白名单/基线不被复制。看现状跑 `--dry-run`。
2. **凡"显式登记的清单"必须只减不增**: 孤儿基线 / 豁免 / 依赖白名单  靠机制, 不靠自觉,
   且清单本身进指纹。
3. **扫描根可被环境变量覆盖**是每个判据脚本的硬约束, 不是洁癖  它是探针唯一的输入通道
   (见 `../references/gate-bus.md` 的「硬约束」)。
