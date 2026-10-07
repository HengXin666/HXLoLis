# Agent Note: argo 检索通道必须绕开 npx，且引擎白名单只能列真实注册的工具名

Status: implemented

- 影响: `~/.dsh/profiles/web/cordis.patch.yml` (wide-research 行), `components/HX-Sagasu/scripts/install-argo.sh`

## Problem

宿主暴露给模型的三个检索工具（`argo_search` / `argo_fetch`、`web_search`、`wide_research`）在本机**全部不可用**，而它们的失效原因彼此独立，也都不是"搜索本身坏了"：

1. `argo_search` / `argo_fetch` → `EALLOWGIT`。插件 `@taxueseek/argo-dsh` 的默认入口是 `searchCommand: 'npx'` + `searchArgs: ['-y','github:taxueseek/argo']`；本机 npm 的 `allow-git=none` 让 npx 拒绝拉取 git 规格。
2. `web_search` → 落到宿主默认的 DeepSeek 端点并返回 `HTTP 402`。插件确实注册了 `id: 'argo'` 的 search provider，但因为同一条 npx 入口不可用，seam 实际没有生效。
3. `wide_research` → **创建即抛错**，连轨道都建不起来：`tools.restrict() names unknown global tools "mcp__argo__argo_search", …（13 个）`。插件的默认子代理白名单 `DEFAULT_CHILD_TOOLS` **双写** `mcp__argo__*` 与原生工具名，注释说这是为了"MCP 挂载与否两态自洽"；但宿主从未装载 MCP 形态（`cordis.patch.yml` 里 `mcp-argo` 一行是注释掉的），而 `tools.restrict()` 对未知工具名是**抛错，不是忽略**。"自洽降级"的假设不成立，实际是硬失败。

三者叠加的后果是：这个 DSH 会话里**所有联网检索都是死的**，而模型看到的只是"工具调用失败"，看不出是接线问题。

## Decision

**用稳定绝对路径替换 npx 入口，并把子代理白名单收敛到真正注册的原生面。**

1. 新增 `components/HX-Sagasu/scripts/install-argo.sh`：幂等地把 argo 落到 `~/.local/share/hx-sagasu/argo`。优先复用本机 `~/.npm/_npx/*/node_modules/argo-search` 已解开的包（零网络），回退 `npm pack`，两者都拿不到就**响亮失败并给出 git clone 指令**（不允许静默产出空目录那会让插件启动后才发现没有产物）。
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 增加 `wide-research` 覆盖行：`searchCommand: /usr/bin/python3`、`searchArgs: [<argo>/scripts/mcp_server.py]`。插件的 `resolveNativeSpawn` 对 `args[0].endsWith('mcp_server.py')` 特判为 `--call <tool> <json>` 单发形态，因此这一行同时修好 argo_search / argo_fetch / web seam 三条路径。
3. 同一条覆盖里显式写死 `childToolAllow: [argo_search, argo_fetch, web_search, web_fetch]`  只列`ctx.tools.register` 真正注册过的名字。

另新增 `components/HX-Sagasu/scripts/engine_truth.py`：对目标平台**真发一次请求**并按四态判定（ok / empty / anomaly / unavailable），把"依赖缺失"与"确实没有内容"分开。

## Alternatives considered

- **什么都不做，让使用者自己配 `ARGO_SEARCH_PYTHON` 环境变量**：插件源码支持这条路径（`searchCommand: process.env.ARGO_SEARCH_PYTHON || 'npx'`），零改动。否决理由：环境变量不在仓库里，换一台机器/换一个 shell 就静默退回 npx 并重新炸掉；profile patch 是跟着 profile 走的，才是可复现的接线。
- **开启 `mcp-argo` 那一行（挂载 14 个 MCP 工具）来满足白名单**：这样 `mcp__argo__*` 是真实工具名，`tools.restrict()` 不再报错。否决理由：那是**为了迁就一个错误的默认值而付每轮约 2.3K token** 的常驻开销（插件 README 自己测的数）。而且真正的修复是让白名单别再列不存在的名字。
- **直接改插件 dist 里的 `DEFAULT_CHILD_TOOLS`**：一处改完所有 profile 都受益。否决理由：`~/.dsh/profiles/*/node_modules` 是包管理器的产物，下次 `pnpm install`/升级即被覆盖；且改的是第三方包的私有实现。用户层 patch 是官方支持的覆盖点。
- **把 argo 仓库 submodule 化（对齐 `components/HX-Memory` 等既有做法）**：与仓库现有的组件管理模式一致，可 pin 版本。否决理由：HX-Sagasu 的组件目录现在只有脚本，还没有需要版本化的源码；为一个还没写代码的组件先建 submodule 是空转。**当适配器代码开始落地时这条要重新评估**。
- **trust `--list-engines` 的 `env_ready`/admission 字段，不做真发请求自检**：省事。否决理由：`admission` 在抽查的 27 个引擎上全为 `null`，`env_ready` 只跟踪环境变量`xiaohongshu` 依赖外部 `xhs` CLI 却报 `env_ready=true`，实测就是"有壳无实"。信任这些字段等于把"依赖缺失"当成"没有内容"。

## Consequences

- 生效后，宿主上三条检索通道共用同一个 argo 入口（`python3 mcp_server.py`），不再依赖 npm 的 git 能力。
- `wide_research` 的子代理只能调 `argo_search` / `argo_fetch` / `web_search` / `web_fetch`。**代价**：长尾取证工具（`argo_pdf` / `argo_screenshot` / `argo_crawl` / `argo_social_search` / `argo_evidence` 等）对子代理不可用它们本来也没被注册为原生工具，除非走 MCP 形态。这是"用最小白名单换 wide_research 能跑起来"的自觉取舍。
- `install-argo.sh` 安装的是一份**快照**，不会自动跟随上游更新；升级需要重跑脚本（或删目录后重跑）。
- profile patch 是**按 key 整体替换**：以后任何想覆盖 `wide-research` 的改动都必须把 `searchCommand` / `searchArgs` / `childToolAllow` 一起写全，否则会静默退回 npx 默认值并再次触发 EALLOWGIT。
- `engine_truth.py` 以非零退出码报告 anomaly：`wechat_sogou` 的"coverage 报 ok/returned=10 而 results=0"会被门禁抓住，不会被当成"没搜到"。

## Verification

- `bash components/HX-Sagasu/scripts/install-argo.sh` → 幂等（第二次运行直接退出 0），落点含 `scripts/mcp_server.py`；
- `python3 -c "import yaml; yaml.safe_load(open('~/.dsh/profiles/web/cordis.patch.yml'))"` → PASS，entries = `['hmr','wide-research']`；
- **模拟插件实际 spawn 的调用形态**：`/usr/bin/python3 <argo>/scripts/mcp_server.py --call argo_search '{"query":"HX-Sagasu","max_results":2}'` → 返回 MCP envelope 且 results 非空（这条是端到端判据，不是"配置看起来对"）；
- `python3 scripts/engine_truth.py` → 四态可分辨：`ok` B站/V2EX/HackerNews/anysearch，`anomaly` 微信公众号，`unavailable` X/小红书/知乎/Reddit（附外部依赖的逐项真值），`empty` 微博；
- 真值表落盘 `research-output/hx-sagasu/engine-status/2026-09-16.json`。
