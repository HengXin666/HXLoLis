// **顶层 import 版**（与 CLI 同形）
import { spawn } from 'node:child_process'
import { planFetchers, adapterFetchers } from '../../src/fetchers.ts'
import { authoritativeFetchers } from '../../src/authoritative.ts'
import { makeBilibiliAdapter } from '../../src/adapters/bilibili.ts'
import { makeTelegramAdapter } from '../../src/adapters/telegram.ts'
import { argoFetchers, openArgoSession } from '../../src/argo-source.ts'
import { recall } from '../../src/recall.ts'
import '../../src/adapters/scope-probes.ts'

const ctx = {}
try { ctx.session = openArgoSession(spawn, '/usr/bin/python3', [process.env['HOME'] + '/.local/share/hx-sagasu/argo/scripts/mcp_server.py']) } catch { ctx.session = undefined }
const available = {
  authoritative: authoritativeFetchers(),
  adapter: adapterFetchers({ bilibili: makeBilibiliAdapter(), 'telegram-public': makeTelegramAdapter() }),
}
if (ctx.session !== undefined) available['argo'] = argoFetchers(ctx.session)
const { fetchers } = planFetchers({ available })
const recallCtx = { query: 'Rust 所有权', minHits: 40, perSourceLimit: 3, minSources: 1, maxTier: 2 }
const t0 = Date.now()
let result
try { result = await recall('Rust 所有权', fetchers, recallCtx) }
finally { try { ctx.session?.close() } catch {} }
console.log('耗时', ((Date.now()-t0)/1000).toFixed(1), 's')
for (const t of result.tiers) {
  const init = t.failures.filter(f => String(f.message).includes('initialize')).length
  console.log('  tier' + t.tier, 'hits=' + t.hits, 'failures=' + t.failures.length, '其中 initialize=' + init)
}
