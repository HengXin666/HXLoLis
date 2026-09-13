# Open-Source Agent Memory Systems — Landscape Survey (Sept 2026)

**Purpose:** decision support for integrating an AI agent's knowledge base.
**Method:** primary GitHub metadata via `gh api` (Sept 5–6, 2026; rate limit ample), README deep-reads of each repo, vendor docs/blogs fetched and read, plus third-party landscape articles cross-checked. All star counts are live GitHub numbers pulled 2026-09-05/06; all claims marked *self-reported* are vendor-published benchmarks, not independently reproduced.

---

## 0. Executive summary

- **The category is hot and consolidating fast.** Five projects sit at 25–65k stars; three of the five biggest (Mem0, OpenViking, TencentDB Agent Memory) shipped major algorithm/platform rewrites **between April and September 2026**.
- **Two architectural tribes emerged in 2026:** (1) *hierarchical memory with tiered loading* (L0/L1/L2/L3 style — OpenViking, TencentDB Agent Memory, Mem0 v3, MemPalace) built to **cut tokens**, and (2) *temporal/knowledge-graph memory* (Graphiti/Zep, cognee) built for **relations + "when was X true"** questions.
- **A third, pragmatic tribe is winning for personal knowledge:** local **Markdown-file + SQLite-index** systems with wikilink graphs — Basic Memory, ReMe (ex-MemoryScope), Flowix, Memmy, ai-memory, akita-style memdir — because humans can read/edit the KB and it is **workspace-agnostic** (MCP server reachable by any agent).
- **Retrieval-trigger consensus is forming but not uniform** (see §Synthesis-b). Three distinct "when to recall" patterns dominate: search-on-demand tool calls (Mem0, LangMem, Basic Memory, TencentDB), session-boundary auto-injection (Codex Memories, agentmemory, OpenViking integrations), and always-in-context core memory blocks (Letta).
- **The user-facing question — "a PERSONAL knowledge base shared across many AI tools, with link/双链-style relations, not just top-k" — is best answered by the Markdown+wikilink+graph family** (Basic Memory, ReMe, Memmy, Flowix), with Graphiti/cognee as the heavyweight structured-graph alternative. Details and reasoning in §Synthesis-c.

---

## 1. Project-by-project classification

### 1.1 Mem0 — mem0ai/mem0 (★64,770 · Apache-2.0 · created 2023-06 · active: pushed 2026-09-04)
URLs: <https://github.com/mem0ai/mem0>, research: <https://mem0.ai/research>, v3 migration: <https://docs.mem0.ai/migration/oss-v2-to-v3>

**What it stores.** Memories as discrete extracted "facts" (memory objects), scoped by `user_id` / `agent_id` / `run_id`; **ADD-only** in the April 2026 v3 rewrite — it deliberately stopped doing UPDATE/DELETE in OSS. Entities are extracted and **entity-linked across memories** ("entity linking… for retrieval boosting"). Storage backend is a vector DB (Qdrant/pgvector/etc.); **graph memory was removed from OSS and is now Platform-only** ("Graph memory moved to Platform… built-in, always-on Mem0 Platform feature") — a notable open-sourcing regression for anyone wanting relations from Mem0.

**Retrieval trigger.** **Search-on-demand.** The canonical pattern is explicit `memory.search(query, user_id=…, top_k=…)` in the hot path (README sample: "Retrieve relevant memories… before generating response"). Nothing is auto-injected; the host app decides when to search. Write is explicit `memory.add(messages)`.

**Linking.** Entity matching adds a third signal (semantic + BM25 + entity) fused by scoring; v3 OSS has no graph of memory-to-memory edges anymore. "Layered memories" in the v3 sense = per-user/session/agent scoping + a L0→…→hierarchy in extraction — see the v3 release notes (single-pass hierarchical extraction, temporal reasoning, memory decay).

**Cost/latency (self-reported).** LoCoMo 92.5, LongMemEval 94.4, BEAM-1M 64.1, BEAM-10M 48.6; mean ~6.9k tokens per retrieval call vs 25k+ full-context; latency p50 ~0.9–1.1s on their managed platform (proprietary optimizations — OSS users should expect "directionally similar" numbers per their own caveat). Median retrieval latency held flat "+1ms" via fire-and-forget decay ranking.

**Activity.** Very high; v3 rewrite shipped ~April 2026; CLI/agent-skills surface added 2026 (mem0 CLI, skills). YC S24 company.

**Verdict:** The default choice for per-user conversational personalization (assistant memories), but graph/relations and auto-recall are not its strong suit in OSS — it's an on-demand fact store.

### 1.2 Zep / Graphiti — getzep/graphiti (★30,627 · Apache-2.0) and getzep/zep (★4,890, now examples-only repo)
URLs: <https://github.com/getzep/graphiti>, <https://arxiv.org/abs/2501.13956> (paper), <https://www.getzep.com> (managed platform)

**What it stores.** A **temporal (bi-temporal) knowledge graph**: Entities (nodes), Facts/Relationships (edges) with **validity windows** ("Kendra loves Adidas as of March 2026"), **Episodes** (raw ingested data) as provenance root for every derived fact, optional prescribed ontology via Pydantic. Backends: Neo4j, FalkorDB (or embedded FalkorDB-Lite), Amazon Neptune; Kuzu **deprecated** (upstream unmaintained). Graphiti is the OSS engine; **Zep** = the managed platform on a proprietary Context Graph Engine (sub-200ms retrieval claims); **Zep Community Edition was deprecated (2025) and moved to legacy/** — self-hosting now means Graphiti, not full Zep.

**Retrieval trigger.** Explicit hybrid search: semantic embeddings + BM25 keyword + **graph traversal**, with **graph-distance reranking** of results ("reranking search results using graph distance"). *When* to fire retrieval is up to the caller — Graphiti provides the query primitives (search episodes → search relationships/nodes). Its edge over Mem0 is that **temporal facts self-invalidate**: when a new episode contradicts an old fact, the old edge is invalidated, not deleted — so "recall on episode match" works: query what's true now or as-of any date. (This is the closest to the prompt's "temporal graph recall on episode match" framing.)

**Linking.** Yes — that's the entire point: entity→relation→entity triplets with provenance; graph traversal is a retrieval signal and a reranker.

**Cost/latency.** Ingestion is LLM-heavy (entity/edge extraction + dedup via structured output; concurrency default low to avoid 429s). Retrieval is sub-second, no LLM in the loop. Paper claims up to 18.5% accuracy gains over baseline on LongMemEval and −90% latency vs baseline implementations; the agentmemory README cites Graphiti's published LongMemEval at 63.8% (strongest published temporal-query results) but notes graph build is async so **fresh facts can lag** ingestion.

**Verdict:** The most principled relational + temporal option — if you need "what did we decide, when, and why (provenance)", this is it; operational cost is real (graph DB + LLM ingestion pipeline).

### 1.3 cognee — topoteretes/cognee (★30,504 · Apache-2.0)
URLs: <https://github.com/topoteretes/cognee>, docs <https://docs.cognee.ai>, paper <https://arxiv.org/abs/2505.24478>

**What it stores.** ECL pipeline: **E**xtract → **C**ognify → **L**oad, turning documents/conversations into a knowledge graph plus vector embeddings plus session cache. Backends pluggable: graph = Kuzu/Ladybug (default), Neo4j, Neptune, or a Postgres graph store (demo); vectors = LanceDB default, pgvector, Qdrant/Chroma/Weaviate/Milvus via adapters; sessions in Redis or SQL. In 1.0 the whole layer can run on **one Postgres** (pgvector + graph-in-Postgres demo). Stores Markdown-flavored knowledge + **procedural skills** (SKILL.md files).

**Retrieval trigger.** Explicit `remember` / `recall` / `forget` / `improve` API; **auto-routing** recall picks the search strategy; session memory (fast cache) first, graph fall-through; a no-LLM "skill gate" auto-appends procedural skills for procedural questions. A feedback flag (`AUTO_FEEDBACK`) adds one LLM call per answered query to self-tune memory ("improve" / learn from conversation signals).

**Linking.** Yes — graph of documents/cognified entities; retrieval can walk structure, not just top-k similarity.

**Cost/latency.** Tuned for quality over raw latency (their own docs); BEAM 100K 0.79, BEAM 10M 0.67 (self-reported). LLM-dependent ingestion cost; embedded local defaults keep ops light.

**Verdict:** Graph RAG + memory platform with a genuinely useful "session fast-path + graph long-term" two-tier design; heavier than Basic Memory/ReMe for a purely personal KB, but a good fit when ingesting large corpora (docs/code) into a queryable graph.

### 1.4 Letta (MemGPT) — letta-ai/letta (★24,630 · Apache-2.0 · landing page) / letta-ai/letta-code (★3,215 · active 2026-09-06)
URLs: <https://github.com/letta-ai/letta>, <https://github.com/letta-ai/letta-code>, memory-blocks post <https://www.letta.com/blog/memory-blocks>

**Important 2026 structural note:** the original Letta V1 server was **retired**; the monorepo is now a landing page and the active project is **Letta Code** — a stateful *agent harness* (CLI/desktop/cloud) rather than a memory-as-a-service layer. Architecture continuity: **memory blocks** remain the core abstraction.

**What it stores / memory model.** (a) **Memory blocks** — labeled, persisted, individually editable units (human/persona/knowledge/skills), each with a size limit, compiled into the context window on each LLM call; agents edit their own blocks via memory tools. (b) **Archival memory** — long-tail recall outside context. (c) Messages/identities/agents in DB + **MemFS** (all context tracked via git; syncable to a GitHub repo). Multi-agent shared blocks enable shared knowledge bases and sleep-time compute.

**Retrieval trigger.** **Agentic self-edit** — the *agent decides* what to write into (and read from) its blocks through tools; no external vector search needed for core memory (it's always in context); archival search is agent-invoked. **Sleeping agents/dreaming**: "periodic dreaming with `/sleeptime`", skill learning, `/doctor` memory audits — background consolidation inspired by their sleep-time-compute paper (arXiv 2504.13171).

**Linking.** Weak — blocks are labels, not a typed graph; memory organization is mostly self-authored text and skills. No wikilink/graph semantics.

**Cost/latency.** Context-window-centric design (only core blocks always in context) is inherently token-frugal, but you adopt a whole **runtime** to get memory; framework lock-in is high ("must use Letta" — agentmemory comparison). Not a drop-in library.

**Verdict:** The reference implementation of *self-editing agent memory + sleep-time consolidation*, but as of 2026 it is an agent platform (Letta Code), not an embeddable memory layer; overkill if you already have an agent harness.

### 1.5 ByteDance OpenViking — volcengine/OpenViking (★35,724 · **AGPL-3.0** · created 2026-01-05 · pushed 2026-09-06)
URLs: <https://github.com/volcengine/OpenViking>, <https://openviking.ai>, benchmark post <https://blog.openviking.ai/post/openviking-benchmark-results/>, paper: VikingMem arXiv:2605.29640 (VLDB 2026), AGPL analysis <https://ibl.ai/blog/openviking-agpl-license-agent-memory-token-costs>

**What it stores.** A **"context database"**: memories, resources (docs/web), and skills unified under a filesystem paradigm (`viking://` URIs, directories, `ls`/`tree`/`find`/grep). Every entry is processed on write into **three tiers**: L0 abstract (~100 tokens), L1 overview (~2k tokens), L2 full details. Session commits asynchronously extract user prefs and agent experience into long-term memory ("sessions become memory"). Integrations for Claude Code, Codex, OpenClaw, Hermes, Cursor, TRAE, OpenCode, pi, MCP clients, LangChain/LangGraph.

**The "~91% cost reduction" — HOW, precisely (verified).** It is the **top of a range, not a blanket number**. Their own published LoCoMo benchmark: token use dropped **34.3%–91.0% depending on the agent integration** (OpenClaw −91.0%, Hermes −34.3%, Claude Code −63.2%) vs each agent's *native* memory; accuracy rose from 24–57% native to 80–83%; latency fell 58–66%. Mechanism: **tiered loading (read L0/L1 summaries first; descend to L2 only as needed)** + **directory-recursive retrieval** (vector search locates the highest-scoring *directory*, then drills down layer by layer so results arrive with surrounding context) + not re-ingesting full prior context each session. A separate **91.00% HotpotQA** top-20 accuracy number is likely the source of confusion between the two "91%"s (ibl.ai makes exactly this point). The Red Hat/OpenShift and many blog write-ups repeat "91%" as a headline; treat it as *max observed token saving across three integrations*, self-published against self-selected baselines.

**Retrieval trigger.** Integrations "inject OpenViking recall into your agent's context" — pre-fetch at session/task start via their plugin/hook/MCP wiring (session-boundary recall), plus on-demand `ov find` semantics + session-memory commit hooks; observable retrieval trajectories for debugging.

**Linking.** Weak-moderate: directory hierarchy + context types, not a typed relation graph; wikilink/双链 not present.

**Cost/latency.** Purpose-built to cut tokens (tiered L0–L2), demonstrated −34→−91% input tokens, retrieval 0.19–0.23s (HotpotQA top-20). AGPL-3.0 (main project; CLI/examples Apache-2.0) — strong copyleft with network clause; commercial editions exist (SaaS on Volcano Engine, self-managed). **AGPL is the fact enterprise adopters flag first** (ibl.ai).

**Verdict:** Impressive, fast-moving context/memory engine from ByteDance with real token-efficiency engineering — but AGPL licensing and its directory-not-graph model make it a poor fit for a *linked personal knowledge base*; fine for an agent-context cache.

### 1.6 Tencent Agent Memory — TencentCloud/TencentDB-Agent-Memory (★25,991 · "NOASSERTION" (README says MIT) · created 2026-04-07 · pushed 2026-09-03; Tencent/TencentDB-Agent-Memory redirects here)
URLs: <https://github.com/TencentCloud/TencentDB-Agent-Memory>, MarkTechPost write-up <https://www.marktechpost.com/2026/05/23/tencent-open-sources-tencentdb-agent-memory-a-4-tier-local-memory-pipeline-for-ai-agents/>, trending badge trendshift.io/repositories/29310

**Note on the claims in the prompt:** "Tencent Agent Memory (github.com/Tencent/AgentMemory?)… ~19k stars claimed, new 'memory brain'." Verified: the repo is under **TencentCloud**, exists as **TencentDB-Agent-Memory**, hit ~19k quickly after April 2026 launch and is at **~26k now** (Yahoo/MarkTechPost: "tops 20,000 GitHub stars in 90 days" — consistent). So ~19k was accurate for an earlier date.

**What it stores.** Four **"memory assets"**, not flat chat logs: (1) **Chat Memory** — layered L0 Conversation → L1 Atom → L2 Scenario → L3 Persona; (2) **Skills** — versioned executable procedures with trigger boundaries + validation; (3) **Wiki** — doc pages with a **link graph** (Karpathy-LLM-wiki-inspired); (4) **CodeGraph** — code symbols/call graphs/impact paths. Storage is **heterogeneous**: facts/logs/traces in DBs (default local SQLite + sqlite-vec; optional TCVDB), while personas/scenes/skills/wiki live as **human-readable Markdown files** under `~/.openclaw/memory-tdai/`. "Symbolic short-term memory": verbose tool logs offloaded to `refs/*.md` files while a compact **Mermaid task-canvas** stays in context; agent reasons over the symbol graph, greps node_id to fetch raw text.

**Retrieval trigger.** Two-layer: **memory-hub "loadout"** — agents are *equipped* with specific assets (fixed binding + ACL, private/team/restricted/agent visibility) — and **on-demand tool calls** (`tdai_memory_search`, `tdai_conversation_search`, `/v3/tools/list`, `/v3/tools/call`). Defaults: L1 extraction every 5 turns; persona generated every 50 memories; recall top-5 with 5s timeout (skips injection on timeout rather than blocking). Runs as **proxy** — point your agent's base URL at the proxy for zero-code integration (Claude Code, Codex, CodeBuddy, WorkBuddy, Hermes, OpenClaw, DeepSeek Harness listed). BM25 (jieba + English) + vector fused via RRF.

**Linking.** **Yes, strongly** — Wiki link graph + CodeGraph call/impact graph; and asset→agent binding is itself a governance graph. 双链-style: Wiki pages support link-graph drill-down.

**Cost/latency (self-reported).** PersonaMem 48%→76%; on long-horizon agent runs: WideSearch pass rate 33→50% with −61.4% tokens; SWE-bench 58.4→64.2% with −33.1% tokens; latency bounded by 5s recall timeout design. Requires Node ≥22.16; heavier Docker stack (core + hub + proxy).

**Verdict:** The most *productized "team brain"* — layered chat memory + skills + wiki-link-graph + code graph, all shareable across agent frameworks with governance. License claim is MIT on README badge but GitHub API reports NOASSERTION (license file is a Tencent corporate header) — verify before commercial embedding.

### 1.7 LangMem / langmem-sdk — langchain-ai/langmem (★1,646 · MIT)
URLs: <https://github.com/langchain-ai/langmem>

**What it stores.** Memory units in any LangGraph `BaseStore` (InMemory, AsyncPostgres, etc.); namespace-organized (e.g. `("memories",)`), with embeddings for search. Supports both *semantic memories* (facts from conversations) and *procedural memories* (skills/optimization of agent behavior via prompt refinement).

**Retrieval trigger.** Two documented modes, and this is its key design point: (1) **"in the hot path"** — agent tools `create_manage_memory_tool` / `create_search_memory_tool` let the agent itself decide when to store/search during a conversation; (2) **background memory manager** — automatic extraction, consolidation, and updating of agent knowledge off the hot path. Hot-path quickstart shows injecting memories without the agent explicitly searching.

**Linking.** Not a graph; namespace + vectors. Consolidation merges/updates stored memories over time (LangGraph store keys).

**Cost/latency.** Library-light; whatever store you bring. No auto-injected context beyond what the agent searches.

**Verdict:** The cleanest *integration-first* memory toolkit for LangGraph agents; dual hot-path/background design is a useful template. Small ecosystem; LangChain-centric.

### 1.8 Others

#### Memary — MemaryAI/MemaryAI (★19, MIT; original kingjulio823888/memary is 404/gone)
The well-known 2024 Memary (human-memory-inspired: episodic/semantic/procedural, graph + vector, streamlit demo, ~3k stars then) has **vanished from its original path**; the only surviving "MemaryAI/MemaryAI" is a **19-star re-upload from Dec 2024** (pushed once, 1 fork). Status: effectively **abandoned/archived**. Mention only as historical; do not build on it.

#### A-Mem — agiresearch/A-mem (★1,167 · MIT · last pushed 2025-12) (+ WujiangXu/A-mem ★957, code for NeurIPS 2025 paper)
**What it stores:** Zettelkasten-style **notes** (markdown) with structured attributes/tags, stored in ChromaDB (vectors) + a relational store; **linking is the point** — on add, an LLM generates a note, analyzes existing memories for relevant connections and **establishes meaningful links** (A-MEM "agentic memory evolution"). NeurIPS 2025 paper "A-Mem: Agentic Memory for LLM Agents" (arXiv 2502.12110). **Trigger:** explicit `add_note`/search + automatic memory evolution (linking/refinement) on add/update. Research-grade; single-digit activity since late 2025. **Verdict:** academic precursor; the *Zettelkasten-linking* idea lives on in better-maintained projects (Basic Memory, ReMe).

#### ReMe (formerly MemoryScope) — agentscope-ai/ReMe (★3,418 · Apache-2.0; topics include `memoryscope`; the old agentscope-ai/MemoryScope path is 404)
Alibaba's AgentScope team project, **v4 as of 2026 with MemoryScope folded into the ReMe line** (README links to a `memoryscope_branch`). Positioning: "**A local-first, self-evolving personal knowledge base for AI agents**… QwenPaw and DeepSeek Harness can share the same workspace". **What it stores:** memory-as-files — `session/` (jsonl sources) → `daily/` (dated facts/cards, `interests.yaml`) → `digest/` (long-term: `personal/`, `procedure/`, `wiki/` markdown with frontmatter + **wikilinks**); rebuildable `metadata/` index (BM25 + optional vectors + **wikilink graph**). **Trigger:** capture→index→consolidate→recall loop — `auto_memory` (hook), `auto_resource`, `auto_index` (watcher), **`auto_dream`** (background consolidation of the latest 2-day window into digest nodes: create/corroborate/refine/correct), `proactive` (exposes interest topics the host agent may mention). Recall = BM25 + optional vector (RRF) + **wikilink-neighbor expansion**; line-level with bounded neighbors. **Benchmarks (self-published):** LongMemEval-cleaned-s 89.4% overall, BEAM 100K 66.1 / 1M 65.0. Native agent integrations incl. DeepSeek Harness plugin, Claude Code, Codex. **Verdict:** the strongest current *Markdown-wikilink, multi-agent personal KB* with a real consolidation loop; very close to the prompt's ideal use case.

#### Memmy — MemTensor/memmy-agent (★1,270 · MIT · created 2026-07, very active)
"A personal AI agent & **local memory hub for all AI agents**… all AI remember the same you"; supports Claude Code, Codex, OpenClaw, Hermes, DeepSeek Harness, Cursor, WorkBuddy, OpenCode, Pi. Desktop app + CLI/TUI; remembers project background/preferences and relays state across tools ("switch tools without losing context"). MIT, local-first data security. New but fast-rising; a peer of Memmy = MemTensor.

#### Flowix — text2future/flowix (★397 · MIT · 2026-05)
"Notes for you, Memory for your agents… **The Markdown notebook where your words become durable context for AI agents**" — Markdown notes, mind maps, multi-agent via MCP + CLI (Codex/Claude Code/OpenCode/Hermes/Flowix agent); bundles a DeepSeek Harness plugin (dsh-flowix-memory). Human-first notebook that doubles as agent memory; small but exactly on-theme for "markdown memory for agents".

#### memdir — artiebits/memdir (★11, no license detected, 2026)
A library ("works with any LLM that supports tool calling") organizing memory in 3 tiers: system-prompt `memories.md` (always in context, curated facts) → sliding window recent messages → SQLite archive; exposes `memory_write`/`memory_delete` tools the model calls "at the right moments". Persistent identity/SOUL.md angle. Tiny, unlicensed, single-author.

#### OpenMemory — mem0ai/openmemory (★34 · MIT · created 2026-07)
**Careful:** the prompt's "mem0-like OpenMemory MCP server" does **not** exist under mem0ai under that name/function. mem0ai's OpenMemory is a **session-porting CLI/TUI** that moves conversation sessions between coding harnesses (Claude Code ↔ Codex ↔ OpenCode; "Codex's Import from Claude Code is uni-directional… OpenMemory is omni-directional") — context *migration*, not a memory server. The several "OpenMemory MCP server" wrappers on GitHub are third-party, mostly tiny (★0–20), typically mem0-under-MCP.

#### Basic Memory — basicmachines-co/basic-memory (★3,868 · AGPL-3.0 · very active; cloud product $15/mo)
See §1.9 below — key candidate.

#### MemPalace — MemPalace/mempalace (★58,870 · MIT · created 2026-04 — remarkable velocity)
Local-first AI memory; **verbatim** conversation storage (no summarization/extraction/paraphrase); semantic search over ChromaDB (pluggable backends); structured index where people/projects = *wings*, topics = *rooms*, original content = *drawers*; MCP server; claims 96.6% R@5 raw on LongMemEval, "zero API calls". Also publishes an active benchmark/comparison culture. **Verdict:** the fastest-rising *simple/verbatim* memory layer; good if you distrust lossy summarization; relations are minimal (hierarchy, not graph).

#### agentmemory — rohitg00/agentmemory (★28,084 · Apache-2.0 · 2026)
"#1 persistent memory for AI coding agents" — coding-agent-native memory with **12 lifecycle hooks** (SessionStart/UserPromptSubmit/Pre+PostToolUse/Stop/SessionEnd…) silently capturing tool activity → SHA-256 dedup → privacy filter → 4-tier consolidation (Working/Episodic/Semantic/Procedural) with decay (Ebbinghaus), contradiction detection, auto-eviction; triple-stream BM25+vector+graph retrieval (RRF); ~1900 tokens/session injection (self-reported −92% vs built-ins); 95.2% R@5 LongMemEval-S self-measured; local SQLite + iii-engine, 0 external DBs, keyless mode (BM25 only, free local embeddings optional). Very coding-agent-specific but a strong design reference for hook-driven auto-capture.

#### ai-memory — akitaonrails/ai-memory (★5,841 · MIT · 2026)
Rust single-binary **cross-agent/cross-machine long-term memory** for coding CLIs: 20+ harnesses feed one shared memory; plain-markdown git-backed wiki as source of truth with rebuildable index (no vector store to babysit); typed handoffs (owned/claimed once); zero-LLM default path; multi-user auth + audit log. Directly on-theme for workspace-agnostic shared memory.

#### hermes-agent — NousResearch/hermes-agent (★242k · MIT)
"The agent that grows with you" — the flagship agent that *is* the memory+skills substrate many of the above integrate with; worth listing as the integration target/ecosystem hub rather than a memory library.

#### Codex "long-term memory" approaches (incl. B站 BV1bNti6XEZx)
OpenAI Codex (★121k) native memory model is two layers: **AGENTS.md** (static, user-maintained, layered discovery global→repo→cwd, 32KiB cap) and **Memories** (~/.codex/memories/): background async summarization of sessions (idle ≥6h → consolidation; two models: what-to-remember + merge-with-existing; 256-rollout bound; 30-day aging; secret redaction; read/write switches). The B站 video "给Codex装上长期记忆，新开会话不用从零开始了" (BV1bNti6XEZx, published 2026-09-04, ~4.2 min, by 码里奥Ziho, ~8k views) is exactly this theme — bolting a persistent memory onto Codex so new sessions don't start from zero. Mem0's blog ("Codex CLI Memory: How It Works + What Mem0 Adds") documents the native mechanism and positions Mem0 as the add-on. Also: agents.md spec is now under the Linux Foundation's Agentic AI Foundation (cross-tool AGENTS.md convergence), and Hindsight (vectorizeio, per third-party blog ~19.6k stars, one-Docker-command Postgres memory) targets Codex/Claude persistent memory.

### 1.9 Basic Memory — basicmachines-co/basic-memory (detail) (★3,868 · **AGPL-3.0** · Python · SQLite)
**What it stores:** **structured Markdown files that humans and LLMs both read/write** — each file = an Entity with frontmatter (title/type/permalink/tags), an **`## Observations`** list (categorized facts `[method] Pour over…`, tags, context), and **`## Relations`** — wikilink relations that form the graph (`- relates_to [[Coffee Bean Origins]]`, `requires [[…]]`; bare `[[…]]` indexes as links_to). Plus a local **SQLite index** (rebuildable), optional Postgres/Milvus. Works with Obsidian/VS Code — you can edit by hand and the AI sees your changes. MCP server with content/search/**build_context** (graph navigation of memory:// URLs)/schema tools; CLI; cloud sync optional ($15/mo).

**Retrieval trigger:** pure MCP on-demand — the agent calls `search_notes` / `read_note` / `build_context` when needed (multi-hop: read a note → follow relations → surface related knowledge); no background consolidation, no auto-injection (agent decides). Optional cross-encoder reranking.

**Verdict:** The cleanest *双链/relations-native, human-readable, agent-shared* personal KB; tradeoff = no auto-capture/consolidation (user or agent must explicitly save), AGPL license, young project.

---

## 2. Synthesis

### (a) Comparison table

| System | ★ (2026-09) | License | Stores | Retrieval trigger | Linked/双链 | Auto-capture | Token model | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Mem0** mem0ai/mem0 | 64,770 | Apache-2.0 | Facts/entities in vector DB (graph removed→Platform) | On-demand `search()`; explicit add | Entity-linked facts; no memory graph in OSS | No (manual add) | ~6.9k tok/retrieval (self) | Default assistant-personalization store; relations weak in OSS |
| **Graphiti/Zep** getzep/graphiti | 30,627 | Apache-2.0 | Temporal KG (entities/edges w/ validity windows + episode provenance); Neo4j/FalkorDB | Explicit hybrid search + graph rerank; caller decides | **Yes — graph is the model** | Yes via episode ingestion (async) | Retrieval sub-sec; ingestion LLM-heavy | Best temporal+provenance graph; ops cost real |
| **cognee** topoteretes/cognee | 30,504 | Apache-2.0 | Graph + vectors + session cache (ECL pipeline) | Explicit recall; auto-routing; session-first | Yes (graph) | Yes (pipeline + improve/feedback) | LLM per ingest/feedback | Solid graph-RAG platform; heavier than markdown family |
| **Letta** letta-ai/letta(+code) | 24,630 / 3,215 | Apache-2.0 | Memory blocks (in-context) + archival + git MemFS | Agent self-edit; archival on agent call; dreaming | No (labels/skills) | Agent-driven + sleep-time | Core blocks always in context | Canonical self-editing memory; but now a full agent runtime |
| **OpenViking** volcengine | 35,724 | AGPL-3.0 | "Context DB": viking:// filesystem, L0/L1/L2 tiers | Session-start injection + on-demand find/grep | Directory hierarchy, no graph | Yes (session→memory, async) | −34→−91% tokens (self, range) | Powerful token-saver; AGPL + not relation-native |
| **TencentDB Agent Memory** | 25,991 | MIT (badge) / NOASSERTION (API) | 4 assets: ChatMem L0–L3, Skills, Wiki link-graph, CodeGraph; SQLite+sqlite-vec default | Equip/loadout per agent + on-demand tools; proxy | **Yes** (Wiki links, CodeGraph, asset bindings) | Yes (5-turn L1, 50-mem persona) | −33→−61% tokens (self) | Best team "brain" productization; verify license |
| **LangMem** langchain-ai | 1,646 | MIT | Memories in LangGraph BaseStore; namespaces | Agent tools in hot path + background manager | No | Yes (background) | Config-dependent | Clean LangGraph-native toolkit |
| **A-Mem** agiresearch | 1,167 | MIT | Zettelkasten notes, ChromaDB | Explicit add/search + auto evolution | **Yes** (Zettelkasten links) | On add (evolution) | Research code | Academic precursor, dormant |
| **ReMe** (ex-MemoryScope) | 3,418 | Apache-2.0 | Markdown files (daily→digest) + rebuildable BM25/vec/wikilink index | auto_memory/auto_dream/auto_index; recall w/ wikilink expansion | **Yes** (wikilinks) | Yes (hooks + auto_dream) | Self: LongMemEval 89.4% | **Top pick for personal multi-agent linked KB** |
| **Basic Memory** | 3,868 | AGPL-3.0 | Markdown entities (Observations + Relations) + SQLite | MCP on-demand; agent-driven | **Yes** (wikilink graph) | No | — | Cleanest human-editable 双链 KB; no auto-capture |
| **MemPalace** | 58,870 | MIT | Verbatim transcripts in structured wings/rooms/drawers; ChromaDB | On-demand MCP search | Hierarchy (weak graph) | No | 96.6% R@5 self | Fastest-rising verbatim memory; no lossy summary |
| **Memmy** | 1,270 | MIT | Local shared memory hub across agents (relay) | Agent tool calls | Partial | Yes (session) | — | Young cross-agent personal hub |
| **agentmemory** | 28,084 | Apache-2.0 | SQLite obs→4-tier consolidation; BM25+vec+graph | **Hook-driven auto-inject** at session start (~1.9k tok) | Graph via entity extraction | Yes (12 hooks) | −92% vs built-ins (self) | Best coding-agent auto-capture reference |
| **ai-memory** | 5,841 | MIT | git-backed markdown wiki + rebuildable index (Rust server) | On-demand + lifecycle hooks; typed handoffs | Wiki links (markdown) | Yes (hooks, zero-LLM path) | Zero-LLM default | Strong cross-agent/cross-machine handoff KB |
| **Basic-memory-class extras** | — | — | Markdown/JSON files | Tool-driven | wikilinks | varies | — | — |
| **OpenMemory** mem0ai | 34 | MIT | Session archives (porting, not a memory server) | Manual CLI/TUI | No | No | — | Do not confuse with a memory MCP server |

### (b) Emerging design pattern — *WHEN to use/recall*

There is **partial consensus**, crystallizing into ~4 recognized patterns (several systems combine 2–3):

1. **Search on demand (tool-call retrieval).** The agent (or host app) explicitly queries memory when the conversation plausibly needs it — Mem0 `search()`, LangMem hot-path `create_search_memory_tool`, Basic Memory/ReMe MCP search, TencentDB `tdai_memory_search`. **Consensus: it's the default**, low-risk, easy to reason about; weakness = the agent must *know to look* (missed recall when no tool fires).

2. **Session-boundary / pre-fetch injection.** Memory is retrieved automatically at session start and/or summarized at session end — Codex Memories (async consolidation of idle sessions, then read next session), OpenViking integration hooks ("inject recall into context"), agentmemory's SessionStart hybrid search under a token budget, TencentDB persona bootstrap (L2/L3 quick context). **Consensus: complements (1)** for continuity, bounded by a token budget (~2k tokens typical) to avoid context flooding.

3. **Always-in-context core blocks + agent self-edit.** Letta memory blocks (and memdir's `memories.md`) keep a small curated core permanently in the prompt; the *agent edits it* when facts change. **Consensus: only for small curated state** (persona, hard preferences, project invariants); cannot scale to a KB.

4. **Temporal-graph recall on episode/fact match.** Graphiti invalidates facts by validity window so retrieval returns the *right-dated* answer; Mem0 v3 adds write-time temporal classification + memory decay (recency damping); TencentDB layers L1 atoms under L2/L3 scenarios. **Consensus emerging: any memory system holding changing facts needs time-awareness** — this is where 2026's systems differentiated most (LoCoMo temporal categories show the biggest deltas: Mem0 temporal +29.3).

A secondary axis — **background consolidation** (LangMem background manager, cognee improve/auto-feedback, Letta dreaming/sleep-time compute, ReMe auto_dream, Codex 6-hour consolidation, TencentDB 5-turn extraction) — is nearly universal in 2026: *write cheap/fast now, distill in background*, to keep the hot path cheap.

**What "when to recall" is *not* yet:** nobody (except TencentDB's proxy and some harness hooks) does automatic per-*turn* semantic retrieval with attention-based relevance gating at scale; the industry standard remains agent-declared tool calls + session-boundary pre-fetch.

### (c) Best fit: a PERSONAL knowledge base shared across many AI tools, with linked/双链 relations (not just top-k)

Ranking by (i) workspace/tool agnosticism (MCP or protocol-agnostic server), (ii) explicit link/relation support with multi-hop retrieval, (iii) human readability/editing, (iv) local-first data ownership:

1. **ReMe (ex-MemoryScope) — agentscope-ai/ReMe.** Markdown + wikilinks + daily→digest consolidation loop + BM25/vector/wikilink-graph recall with line-level results; integrates Claude Code/Codex/DeepSeek Harness/QwenPaw via MCP/hooks/SKILL.md; local-first Apache-2.0; self-reported LongMemEval 89.4%. Best balance of *auto-consolidation* and *explicit linked files* — and explicitly designed as a shared personal KB, not an agent-scoped silo. (Successor of MemoryScope with the memoryscope branch retained.)

2. **Basic Memory.** The purest 双链 design (Observations + Relations + wikilinks), truly human-editable in Obsidian, MCP-native so any MCP client works, real graph navigation (build_context). Tradeoffs: no auto-capture/consolidation (you must ask the AI to save), AGPL-3.0, markdown grammar is opinionated.

3. **Graphiti (if you want a real graph database + temporal provenance).** Unmatched for *typed, temporal, provenance-backed* relations and multi-hop queries; MCP server available; but requires operating Neo4j/FalkorDB + an LLM ingestion pipeline — heavier than a personal KB warrants unless your knowledge is large/enterprise-scale and time-sensitive.

4. **Memmy / Flowix / ai-memory / memdir** — honorable mentions in the cross-agent markdown space, all young; ai-memory (Rust, git-backed wiki, handoffs, zero-LLM) is the most infrastructure-solid of these; Memmy is product-polished and DSH-aware; Flowix is the most human-notebook-like.

5. **Not recommended for this specific need:** Mem0 (fact snippets, graph removed from OSS), MemPalace (verbatim, hierarchy not relations), OpenViking (AGPL, directory not graph), Letta (runtime lock-in), TencentDB Agent Memory (team-asset/loadout model + proxy interception + license ambiguity — powerful but oriented to agent *teams* and cloud DB products, with SQLite local default as the light option).

**Bottom line for the decision:** if the KB must be (a) one brain shared by *many* tools/agents, (b) human-ownable and editable, (c) genuinely linked (双链, multi-hop), and (d) local-first — the **Markdown-file + wikilink + MCP architecture (ReMe or Basic Memory)** is the convergent design in the 2026 landscape; both are AGPL/Apache tradeoffs to weigh (Basic Memory AGPL vs ReMe Apache-2.0). If relations must be *typed and temporal* at scale, standardize on **Graphiti** as the engine. Treat Mem0-class systems as a complementary "personalization fact layer" rather than the knowledge base.

---

## 3. Sources (every URL consulted / verified)

**Repos (GitHub metadata via `gh api`, 2026-09-05/06; READMEs read):**
- mem0ai/mem0 — https://github.com/mem0ai/mem0
- getzep/graphiti — https://github.com/getzep/graphiti
- getzep/zep — https://github.com/getzep/zep
- topoteretes/cognee — https://github.com/topoteretes/cognee
- letta-ai/letta — https://github.com/letta-ai/letta
- letta-ai/letta-code — https://github.com/letta-ai/letta-code
- volcengine/OpenViking — https://github.com/volcengine/OpenViking
- TencentCloud/TencentDB-Agent-Memory — https://github.com/TencentCloud/TencentDB-Agent-Memory (redirect from Tencent/TencentDB-Agent-Memory)
- langchain-ai/langmem — https://github.com/langchain-ai/langmem
- basicmachines-co/basic-memory — https://github.com/basicmachines-co/basic-memory
- agiresearch/A-mem — https://github.com/agiresearch/A-mem ; WujiangXu/A-mem — https://github.com/WujiangXu/A-mem
- agentscope-ai/ReMe — https://github.com/agentscope-ai/ReMe (MemoryScope lineage, topics incl. memoryscope)
- MemTensor/memmy-agent — https://github.com/MemTensor/memmy-agent
- text2future/flowix — https://github.com/text2future/flowix
- artiebits/memdir — https://github.com/artiebits/memdir
- mem0ai/openmemory — https://github.com/mem0ai/openmemory
- MemPalace/mempalace — https://github.com/MemPalace/mempalace
- akitaonrails/ai-memory — https://github.com/akitaonrails/ai-memory
- rohitg00/agentmemory — https://github.com/rohitg00/agentmemory
- NousResearch/hermes-agent — https://github.com/NousResearch/hermes-agent
- MemaryAI/MemaryAI — https://github.com/MemaryAI/MemaryAI (original kingjulio823888/memary: 404)
- supermemoryai/supermemory — https://github.com/supermemoryai/supermemory
- khoj-ai/khoj — https://github.com/khoj-ai/khoj
- openai/codex — https://github.com/openai/codex

**Vendor docs/blogs fetched and read:**
- Mem0 research page — https://mem0.ai/research
- Mem0 v2→v3 migration docs — https://docs.mem0.ai/migration/oss-v2-to-v3
- Mem0 "Codex CLI Memory" blog — https://mem0.ai/blog/how-memory-works-in-codex-cli
- Zep/Graphiti arXiv paper — https://arxiv.org/abs/2501.13956
- Letta memory-blocks blog — https://www.letta.com/blog/memory-blocks
- OpenViking benchmark post — https://blog.openviking.ai/post/openviking-benchmark-results/
- OpenViking docs (concepts referenced in README) — https://docs.openviking.ai/
- VikingMem paper — https://arxiv.org/abs/2605.29640
- TencentDB Agent Memory MarkTechPost analysis — https://www.marktechpost.com/2026/05/23/tencent-open-sources-tencentdb-agent-memory-a-4-tier-local-memory-pipeline-for-ai-agents/
- Yahoo Finance on TencentDB star growth — https://finance.yahoo.com/technology/ai/articles/tencentdb-agent-memory-tops-20-062700398.html
- TencentDB trendshift — https://trendshift.io/repositories/29310
- ibl.ai AGPL analysis of OpenViking — https://ibl.ai/blog/openviking-agpl-license-agent-memory-token-costs
- OpenViking trendshift — https://trendshift.io/repositories/19668

**Third-party landscape articles (cross-check):**
- Hindsight/Vectorize: "Best Open-Source Agent Memory Systems (Self-Hosted, 2026)" — https://hindsight.vectorize.io/blog/2026/08/11/open-source-agent-memory-systems
- (Found in search, not read in full) evermind.ai frameworks list — https://evermind.ai/blogs/best-open-source-agent-memory-frameworks-2026 ; vectorize.io 8-frameworks comparison — https://vectorize.io/articles/best-ai-agent-memory-systems
- agentmemory's benchmark/COMPARISON.md (via README) — https://github.com/rohitg00/agentmemory/blob/main/benchmark/COMPARISON.md

**Other references:**
- B站 Codex long-term memory video BV1bNti6XEZx ("给Codex装上长期记忆，新开会话不用从零开始了", published 2026-09-04) — https://www.bilibili.com/video/BV1bNti6XEZx/ (metadata via api.bilibili.com/x/web-interface/view)
- OpenAI Codex long-term memory GitHub issue #8368 — https://github.com/openai/codex/issues/8368
- A-Mem paper — https://arxiv.org/pdf/2502.12110
- Cognee paper — https://arxiv.org/abs/2505.24478
- Zep OSS strategy announcement — https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/

**Notes on verification limits:** (1) All star counts live as of 2026-09-05/06. (2) Benchmark numbers labeled *self-reported* come from the vendors' own blog/README/paper and were not independently reproduced. (3) TencentDB Agent Memory license: README badge says MIT; GitHub API reports NOASSERTION with a corporate license header — flagged for verification. (4) OpenViking's "91%" is a max-of-range token reduction vs native agent memory, not a blanket figure (ibl.ai and the raw benchmark table both confirm). (5) memdir (artiebits) has no detected license.
