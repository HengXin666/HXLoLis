# 本仓参数快照  起点, 不是终点

**快照: 2026-10-02 @ `79c9a5b`** (weuinevolveweb)

这些数字**只在上面那个日期与 commit 下成立**, 而且它们本来就该变(还债、拆分、加规则都会动它们)。
所以: 每个数都配了**重算命令**, 拿不准就重跑, 别信这张表。

用法只有一种  **照着这些数字的量级与口径, 去量目标仓的同类数字**:
"这个仓的文件行数 p90 是多少?" → 答案不可能是下面那个 300。下面这张表的唯一用途是告诉你
**"该量哪些维度、量出来的东西长什么样、当初用什么命令量的"**。

---

## 一、31 条门禁(逐条)

条数与分组: backend 15 / frontend 7 / notes 4 / risk 1 / guard 2 / gates 1 / e2e 1 = **31**。
真源是注册表, 重算: `node scripts/gates/shared/run.mjs --dry-run`

|#|group|label 写的是什么(≠命令复述)|判据/真源|有负向探针|
|-|-|-|-|-|
|1|backend|ruff check|linter 自身配置|棘轮覆盖|
|2|backend|ruff format --check|同上|—|
|3|backend|mypy|mypy 配置|—|
|4|backend|arch-check(行数 / 目录文件数 / `_` 前缀 / 中文命名 / 分层依赖)|`check_arch.py` 常量 + 白名单||
|5|backend|check-arch-debt(架构白名单条目只许降不许涨)|`arch-debt-baseline.json`||
|6|backend|check-api-surface(路由与请求/响应契约快照)|`api-surface.json`||
|7|backend|check-field-constants(字段名棘轮: 拦新增裸用)|`field-constants-baseline.json`||
|8|backend|check-config-catalog(配置目录与源码不漂移)|生成器 + diff||
|9|backend|check-local-imports(标准库/app.core 的 import 必须在模块顶部)|扫描式||
|10|backend|check-registration-wiring(router 必须被挂载 / 工具必须被导入)|扫描式||
|11|backend|check-docstrings(`@param`/`@returns` 必须匹配签名)|`docstring-baseline.json`||
|12|backend|check-inline-secrets(凭据只准出现在白名单文件里)|`ALLOWED_FILES` 3 条||
|13|backend|check-lint-ratchet(被 ignore 的 ruff 规则: 只拦新增)|`lint-ratchet-baseline.json`||
|14|backend|pytest(含覆盖率采集, 供 coverage 门禁读取)|`-n 4` 写死||
|15|backend|coverage(严格集合必须 100%)|`coverage-baseline.json`||
|16|frontend|biome ci|biome 配置|棘轮覆盖|
|17|frontend|tsc --noEmit|tsconfig|—|
|18|frontend|knip(死代码)|knip 配置|—|
|19|frontend|check-lint-ratchet(biome 的 warning 级规则: 只拦新增)|同上基线||
|20|frontend|arch-check(行数 `.tsx` / `.ts`, 目录文件数, 分层依赖)|`check-front-arch.mjs` 常量 + 白名单||
|21|frontend|api-surface(前端 URL ↔ 后端路由对账 + e2e mock 反向校验)|生成 + diff||
|22|frontend|vitest(单测: api 契约 / 展示件 / 数据 hook)|vitest 配置|—|
|23|notes|check-notes(决策记录格式)|闭集 + 骨架||
|24|notes|check-note-links(代码 ↔ 决策记录 双向链接 + 管辖闭合)|`note-citation-baseline.json`||
|25|risk|check-risk-surfaces(风险展示面登记: 漏一个界面就红)|`risk-surfaces.json`||
|26|notes|check-doc-budgets(注入上下文的体量预算)|`doc-budgets.manifest.json`||
|27|notes|check-defensive-patterns(事故规则 ↔ 测试/门禁 绑定)|`docs/defensive-patterns.md`||
|28|guard|check-gate-fingerprint(阈值/白名单指纹, 防静默放松)|`gate-fingerprint.json`|(接线探针)|
|29|guard|check-hooks(hook 可运行性冒烟 + lane 覆盖)|hook 脚本||
|30|gates|probe-gates(负向验证: 门禁真的会红)|自身|—|
|31|e2e|playwright e2e(mock 后端; `E2E_MODE=real` 才起真实后端)|playwright 配置||

只有一条门禁带 `env`(架构检查的白名单路径), 只有一条带 `fastArgs`/`produces`(pytest),
只有一条带 `requires`(coverage)  这三个字段都是**按需**的, 不是每条都要填。

**注意 groups 的分工**: `gates`(探针)不在任何 Stop lane 里, 只在 CI 与手动跑;
`risk` 只属于默认全量, 没有独立 lane。

## 二、阈值常量

|常量|值|位置|
|-|-|-|
|`MAX_LINES`(后端单文件)|300|`scripts/gates/backend/check_arch.py:46`|
|`MAX_PY_PER_DIR` / `MAX_PY_PER_DIR_IMPL`|5 / 15|同行 52 / 54|
|`MIN_PY_PER_DIR`|1(下限已取消)|行 51|
|`MAX_LINES_TS` / `MAX_LINES_TSX`|300 / 500|`scripts/gates/frontend/check-front-arch.mjs:63/65`|
|`MAX_TS_PER_DIR`|10|行 67|
|`DEEP_IMPORT_MIN_DEPTH`|3(仅 WARN)|行 69|
|`MAX_SKILLS` / `MAX_SKILL_DESCRIPTION_BYTES`|30 / 600|`scripts/gates/shared/check-doc-budgets.mjs:51/53`|
|ruff 被棘轮冻结的规则|10 条(`ANN201 ANN202 B007 B905 E402 E741 F841 RUF012 SIM108 UP031`)|`check-lint-ratchet.mjs:64-75`|
|覆盖率严格集合|49 个文件(逐文件 100%)|`coverage-baseline.json`|
|内联凭据白名单|3 个文件(各带理由)|`check-inline-secrets.mjs:59-74`|

重算: `grep -n 'MAX_LINES\|MAX_PY_PER_DIR\|MAX_TS_PER_DIR' scripts/gates/backend/check_arch.py scripts/gates/frontend/check-front-arch.mjs`

**这些数一个都不该被抄走。** 换个仓库, `MAX_LINES` 可能是 800(p90 就长这样),
`MAX_TS_PER_DIR` 可能根本不该装(目录数不是问题)。算法见 `../references/gate-catalog.md` 的「阈值怎么算」。

## 三、基线 / 清单文件

|文件|顶层字段|形状|重算|
|-|-|-|-|
|`lint-ratchet-baseline.json`|`biome{}` `ruff{}`|工具 → 规则名 → 存量条数|`node …check-lint-ratchet.mjs --tool=ruff`|
|`arch-debt-baseline.json`|`backend{}` `frontend{}`|白名单 key → 类别(`files/private/dirs/layer`) → 条目数|`node …check-arch-debt.mjs`|
|`coverage-baseline.json`|`strict[]`|文件路径数组|`node -e "console.log(require('./scripts/gates/backend/coverage-baseline.json').strict.length)"`|
|`note-citation-baseline.json`|`orphans[]`|孤儿 Note 路径数组(只减不增)|`cat` 该文件|
|`docstring-baseline.json`|映射|文件 → 存量缺失数|`node …check-docstrings.mjs`|
|`field-constants-baseline.json`|`registry_size` `files{}`|`registry_size` 是登记字段总数|同上|
|`api-surface.json`|`paths{}` `schemas{}`|路由 → method → 参数/请求体/响应|`node …check-api-surface.mjs`|
|`risk-surfaces.json`|`surfaces[]`|每项 `{file, source: canonical\|exempt, reason}`|`node …check-risk-surfaces.mjs`|
|`doc-budgets.manifest.json`|路径 → 字节上限|见第七节|`node …check-doc-budgets.mjs --list`|

## 四、白名单现状与语法

|文件|当前条目|语法|
|-|-|-|
|`scripts/gates/backend/arch_whitelist.txt`|**0 条**(全是注释  债务已还完)|`path` / `path::func` / `dir:path` / `layer:path::module` / `layer:path`|
|`scripts/gates/frontend/frontend-arch-whitelist.txt`|**12 条**, 全是 `layer:`|加上 `path\|N`(行数豁免必须带登记上限)|

重算: `grep -vc '^\s*\(#\|$\)' scripts/gates/backend/arch_whitelist.txt scripts/gates/frontend/frontend-arch-whitelist.txt`

**方向性结论**(不随重构漂, 值得记住的是形状而不是数字): 两份白名单都在**按颗粒度**而不是按文件豁免;
行数类豁免已全部清零(那批文件各拆到上限以内), 剩下的只有 `layer:` 分层豁免。

## 五、指纹的 5 组来源

|组|回答|来源|
|-|-|-|
|`thresholds`|多严|两个 arch 检查的 8 个阈值常量名+值|
|`whitelists`|多严|两份白名单的**有效条目集**(去注释/空行/排序)sha256 + 条目|
|`ratchets`|多严|六份基线(去说明文字后)|
|`relaxations`|多严|linter/类型检查配置里**生效**的规则开关(`tool.ruff.lint`、`tool.mypy`、biome 的 `linter.rules`)|
|`wiring`|**还跑不跑**|注册表 + 三份 settings + lefthook + CI 的"决定跑不跑"字段|

重算: `npm run verify:guard`;有意放松时 `node scripts/gates/shared/check-gate-fingerprint.mjs --update`。

## 六、自证

|项|数|重算|
|-|-|-|
|探针条数|**101**(违规组 + 控制组)|`npm run verify:gates`|
|其中接线探针|4(删注册表一行 / 摘 Stop 注册 / CI 接 `|| true` / 只改 label 必须 PASS)|读 `probe-gates.mjs` 的 wiring 段|
|事故规则|**33** 条 = 绑测试 18 + 绑门禁 5 + 显式无门禁 10|`node scripts/gates/shared/check-defensive-patterns.mjs`|

## 七、文档体量预算(实测)

|对象|实测 / 上限(字节)|重算|
|-|-|-|
|`CLAUDE.md`|11 / 200|`node scripts/gates/shared/check-doc-budgets.mjs --list`|
|`AGENTS.md`|6884 / 7300||
|`backend/AGENTS.md`|6276 / 6700||
|`frontend/AGENTS.md`|6789 / 7100||
|`docs/AGENTS.md`|2317 / 2450||
|技能条数|27 / 30|同上|

口径: **UTF-8 字节**, 不是 `wc -w`(中文没有空格, 后者会把整段中文数成几十个 word, 等于放过十几倍增长)。

## 八、重算命令总表

```bash
node scripts/gates/shared/run.mjs --dry-run                    # 门禁条数/分组/真实参数
npm run verify:gates                                           # 探针条数与结果
node scripts/gates/shared/check-doc-budgets.mjs --list         # 注入上下文的体量实测
node scripts/gates/shared/check-lint-ratchet.mjs --tool=ruff   # 被关掉规则的水位
node scripts/gates/shared/check-defensive-patterns.mjs         # 事故规则三类计数
grep -vc '^\s*\(#\|$\)' scripts/gates/{backend/arch_whitelist.txt,frontend/frontend-arch-whitelist.txt}
git log --since='6 months ago' --name-only --pretty=format: | sort | uniq -c | sort -rn | head -30   # churn
git ls-files '*.py' '*.ts' '*.tsx' | xargs wc -l | sort -rn | head -20                                # 体积热点
```
