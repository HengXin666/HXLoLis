# 模板 4：指纹快照

来源：assets/source/skeletons.md 第 4 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

适配要求：快照应涵盖所有影响实际执行与严格度的字段及值（含 fastArgs / requires / produces）。原例只记部分字段存在性，照做会漏掉值变化。

<!-- source-section:start -->
## 4. 指纹快照

```json
{
  "version": 1,
  "algorithm": "sha256",
  "thresholds":  { "<常量名>": "<值>" },        // 各判据脚本里写死的阈值
  "whitelists":  { "<文件>": { "sha256": "<…>", "entries": ["<有效条目>"] } },
  "ratchets":    { "<基线文件>": { "sha256": "<…>", "entries": { "<键>": "<数>" } } },
  "relaxations": { "<linter 配置>": ["<生效的规则开关行>"] },
  "wiring":      { "run.mjs": ["<group|cmd|cwd|args|env|produces|requires|fastArgs=yes|no>"], "settings": ["<event|matcher|cmd>"] },
  "fingerprint": "<以上全部序列化后的 sha256>"
}
```

四类来源的回答:**thresholds / whitelists / ratchets / relaxations = "有多严"**, **wiring = "还跑不跑"**。
抽取口径的三条经验:

- **只抽"决定严格度"的字段, 不抽显示名**。改 `label` 文案、换个排版都不该动指纹;
  加一条豁免、删一条门禁、给某检查接上 `|| true` 必须 FAIL。
- `fastArgs` / `produces` / `requires` 只记**存在与否**, 不记内容  它们决定的是"这条在快档跑不跑"。
- 环境变量 `CHECK_..._ROOT` 让指纹脚本自己也能被指向临时目录(探针要用)。

`--update` 的语义是 **"承认这次变化", 不是"让门禁通过"**: 只负责重录, 不接受 `--tool` 这类局部开关
(局部重录 = 静默放松)。`SCHEMA_VERSION` 与文件里的 `version` 不一致要报错, 否则旧指纹会被当成有效。

<!-- source-section:end -->
