#!/usr/bin/env bash
# 复现: CLI 路径下的 argo initialize 超时（2026-09-18 起未闭合）
#
# **这个失败是稳定复现的**（连续 3 次均为 11 个 initialize 超时），
# 而**同一份代码在 /tmp/*.mjs 与 scripts/_probe.mjs 里都正常**。
#
# 已排除的 21 个方向见 .agents/notes/implemented/architecture/
#   2026-09-18-argo-concurrency-unresolved.md
#   2026-09-18-gate-and-missing-code.md
#   2026-09-18-timeline-diagnosis.md
#
# 用法: bash scripts/diag/repro-argo-init-timeout.sh
set -u
cd "$(dirname "$0")/../.." || exit 1

echo "=== A) CLI 路径（预期: 11 个 initialize 超时）==="
timeout 280 node --experimental-strip-types scripts/sagasu.ts search "Rust 所有权" --min-hits 40 2>&1   | grep -c 'method=initialize' | sed 's/^/  initialize 超时数: /'

echo "=== B) 逐字节克隆（预期: 同样失败 → 证明不是文件路径）==="
cp scripts/sagasu.ts scripts/_clone.ts
timeout 280 node --experimental-strip-types scripts/_clone.ts search "Rust 所有权" --min-hits 40 2>&1   | grep -c 'method=initialize' | sed 's/^/  initialize 超时数: /'
rm -f scripts/_clone.ts

echo "=== C) 手工重写的等价脚本（预期: 0 超时 → 证明不是代码逻辑）==="
cat > scripts/_probe.mjs <<'JSEOF'
import { spawn } from 'node:child_process'
import { planFetchers, adapterFetchers } from '../src/fetchers.ts'
import { authoritativeFetchers } from '../src/authoritative.ts'
import { makeBilibiliAdapter } from '../src/adapters/bilibili.ts'
import { makeTelegramAdapter } from '../src/adapters/telegram.ts'
import { argoFetchers, openArgoSession } from '../src/argo-source.ts'
import { recall } from '../src/recall.ts'
import '../src/adapters/scope-probes.ts'
const ctx = {}
try { ctx.session = openArgoSession(spawn, '/usr/bin/python3', [process.env['HOME'] + '/.local/share/hx-sagasu/argo/scripts/mcp_server.py']) } catch { ctx.session = undefined }
const available = {
  authoritative: authoritativeFetchers(),
  adapter: adapterFetchers({ bilibili: makeBilibiliAdapter(), 'telegram-public': makeTelegramAdapter() }),
}
if (ctx.session !== undefined) available['argo'] = argoFetchers(ctx.session)
const { fetchers } = planFetchers({ available })
let result
try { result = await recall('Rust 所有权', fetchers, { query: 'Rust 所有权', minHits: 40, perSourceLimit: 3, minSources: 1, maxTier: 2 }) }
finally { try { ctx.session?.close() } catch {} }
const init = result.tiers.flatMap(t => t.failures).filter(f => String(f.message).includes('initialize')).length
console.log('  initialize 超时数:', init)
JSEOF
timeout 280 node --experimental-strip-types scripts/_probe.mjs 2>&1 | tail -2
rm -f scripts/_probe.mjs

echo
echo "**若 A 失败而 C 为 0  该问题仍未定位，见上面引用的三篇 note**"
