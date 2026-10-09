/**
 * URL 请求安全校验（SSRF 防护）。
 *
 * ## 来源
 *
 * **移植自 argo v2.8.6 的 `scripts/url_safety.py`**（MIT License © 2026 taxueseek），
 * 逐条对应其判定逻辑。移植而非 fork 的理由：argo 是 Python 3.14 + 91 个文件，
 * 本仓库是 TypeScript 零依赖零构建  整体 fork 要放弃后者，而这一件是**纯逻辑、
 * 无依赖、可直译**的，移植保住了零依赖又拿到了它的成熟实现。
 *
 * ## 它防什么
 *
 * 对会发起网络请求的入口做统一拦截:
 *   1. scheme 白名单（仅 http/https，拒绝 `file://` / `ftp://`）
 *   2. 主机名黑名单（localhost、**裸单标签主机**、`.local`/`.internal`/`.lan` 等）
 *   3. DNS 解析后 IP 段检查（私有/环回/链路本地/保留/CGNAT）
 *   4. 重定向目标逐跳校验（由调用方在每一跳上调用本模块）
 *
 * ## 三个最容易被忽略、但 argo 做对了的点
 *
 * ### 一、数字 IP 字面量必须规范化
 *
 * 各系统解析器对 `0177.0.0.1`（八进制）、`0x7f.0.0.1`（十六进制）、
 * `2130706433`（单段整数）的行为**不一致**。校验层不能依赖连接层的"自觉" 
 * 统一规范化成点分 IPv4 再查表，堵住绕过。
 *
 * ### 二、IPv4-mapped IPv6 必须转回 IPv4
 *
 * `http://[::ffff:127.0.0.1]/` 实际连接落在 IPv4 网段，
 * 不转换就能绕过私有段检查。
 *
 * ### 三、DNS 解析失败要**保守拦截**
 *
 * 解析失败时无法确认公网性  宁可误伤，不可漏防。
 *
 * ## fake-ip 例外（argo 的实战经验）
 *
 * Clash/Surge 等 TUN 工具的 fake-ip 模式把域名解析到 `198.18.0.0/15` 等占位段，
 * 流量由 TUN 接管转发到真实公网目标。**占位段不可直达内网**，所以命中占位段
 * 不算 SSRF 风险。**仅当解析出的全部地址都是占位段时**才放行；
 * 含任一真实私有 IP 仍拦截。
 *
 * 没有这条例外，**任何用代理的用户都会被全站误伤**  这是 argo 踩过的坑。
 */

/** 私有 / 特殊用途 IPv4 段（与 argo 的 `_PRIVATE_NETWORKS_V4` 逐条对应）。 */
const PRIVATE_V4: readonly string[] = [
  '0.0.0.0/8',        // 本网络
  '10.0.0.0/8',       // 私有
  '100.64.0.0/10',    // CGNAT
  '127.0.0.0/8',      // 环回
  '169.254.0.0/16',   // 链路本地
  '172.16.0.0/12',    // 私有
  '192.168.0.0/16',   // 私有
  '192.0.0.0/24',     // IETF 协议分配
  '192.0.2.0/24',     // TEST-NET-1
  '198.18.0.0/15',    // 基准测试
  '198.51.100.0/24',  // TEST-NET-2
  '203.0.113.0/24',   // TEST-NET-3
  '224.0.0.0/4',      // 组播
  '240.0.0.0/4',      // 保留
]

/** 私有 / 特殊用途 IPv6 段。 */
const PRIVATE_V6: readonly string[] = [
  '::1/128',          // 环回
  '::/128',           // 未指定
  'fc00::/7',         // 唯一本地地址 ULA
  'fe80::/10',        // 链路本地
  'ff00::/8',         // 组播
  '2001:db8::/32',    // 文档
  '64:ff9b::/96',     // NAT64 前缀
]

/** fake-ip 代理占位段（Clash/Surge TUN）。 */
const FAKE_IP: readonly string[] = [
  '198.18.0.0/15',
  'fdfe:dcba:9876::/64',
]

/** 裸主机名（无点）与内网域名后缀：默认视为不可路由目标。 */
const PRIVATE_HOST_SUFFIXES: readonly string[] = [
  '.local', '.internal', '.lan', '.home.arpa', '.corp', '.intranet',
]
const LOCALHOST_NAMES: ReadonlySet<string> = new Set([
  'localhost', 'localhost.localdomain', 'ip6-localhost',
])

/** 是否显式放行私有地址（`HX_SAGASU_ALLOW_PRIVATE_URLS=1`）。 */
export function allowPrivate(): boolean {
  const v = (process.env['HX_SAGASU_ALLOW_PRIVATE_URLS'] ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

// ── CIDR 匹配 ────────────────────────────────────────────────────
//
// Node 没有内置的 CIDR 判定（Python 有 `ipaddress`）。自己实现:
// 把 IPv4 折成 32 位整数、IPv6 折成 128 位 BigInt，再做前缀掩码比较。
// **不用字符串前缀匹配**  那对 `10.0.0.0/8` 恰好能用，但对
// `100.64.0.0/10` 这类非 8 倍数边界的前缀会算错。

interface Cidr { readonly bits: 32 | 128; readonly base: bigint; readonly prefix: number }

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = (n << 8) | v
  }
  return n >>> 0
}

function ipv6ToBigInt(ip: string): bigint | null {
  let s = ip.trim()
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  // 去掉 zone id（fe80::1%eth0）
  const pct = s.indexOf('%')
  if (pct >= 0) s = s.slice(0, pct)
  if (!s.includes(':')) return null
  // IPv4-mapped 尾部（::ffff:127.0.0.1）先单独处理
  let tailV4: number | null = null
  const lastColon = s.lastIndexOf(':')
  const tail = s.slice(lastColon + 1)
  if (tail.includes('.')) {
    tailV4 = ipv4ToInt(tail)
    if (tailV4 === null) return null
    s = s.slice(0, lastColon + 1) + '0:0'
  }
  const dbl = s.split('::')
  if (dbl.length > 2) return null
  const head = dbl[0] === '' ? [] : dbl[0]!.split(':')
  const rest = dbl.length === 2 ? (dbl[1] === '' ? [] : dbl[1]!.split(':')) : []
  const missing = 8 - head.length - rest.length
  if (dbl.length === 1 && head.length !== 8) return null
  if (dbl.length === 2 && missing < 0) return null
  const groups = [...head, ...Array<string>(dbl.length === 2 ? missing : 0).fill('0'), ...rest]
  if (groups.length !== 8) return null
  let out = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    out = (out << 16n) | BigInt(parseInt(g, 16))
  }
  if (tailV4 !== null) {
    // 尾部 IPv4 已作为 '0:0' 占位写入，用真实值覆盖最低 32 位
    out = (out & ~0xffffffffn) | BigInt(tailV4)
  }
  return out
}

function parseCidr(spec: string): Cidr | null {
  const slash = spec.lastIndexOf('/')
  const addr = slash >= 0 ? spec.slice(0, slash) : spec
  const prefix = slash >= 0 ? Number(spec.slice(slash + 1)) : null
  if (addr.includes(':')) {
    const base = ipv6ToBigInt(addr)
    if (base === null) return null
    return { bits: 128, base, prefix: prefix ?? 128 }
  }
  const n = ipv4ToInt(addr)
  if (n === null) return null
  return { bits: 32, base: BigInt(n), prefix: prefix ?? 32 }
}

const PRIVATE_CIDRS: readonly Cidr[] = [...PRIVATE_V4, ...PRIVATE_V6]
  .map(parseCidr).filter((c): c is Cidr => c !== null)
const FAKE_IP_CIDRS: readonly Cidr[] = FAKE_IP
  .map(parseCidr).filter((c): c is Cidr => c !== null)

function inCidr(value: bigint, bits: 32 | 128, c: Cidr): boolean {
  if (c.bits !== bits) return false
  if (c.prefix === 0) return true
  const shift = BigInt(c.bits - c.prefix)
  return (value >> shift) === (c.base >> shift)
}

/** 把任意 IP 字面量折成 (值, 位宽)；IPv4-mapped IPv6 会**转回 IPv4**。 */
function toComparable(ip: string): { v: bigint; bits: 32 | 128 } | null {
  const s = ip.trim()
  if (!s.includes(':')) {
    const n = ipv4ToInt(s)
    return n === null ? null : { v: BigInt(n), bits: 32 }
  }
  const b = ipv6ToBigInt(s)
  if (b === null) return null
  // ::ffff:a.b.c.d（IPv4-mapped）→ 转回 IPv4 再查表。
  // 不转换则 http://[::ffff:127.0.0.1]/ 可绕过私有段检查（SSRF）。
  if ((b >> 32n) === 0xffffn) return { v: b & 0xffffffffn, bits: 32 }
  return { v: b, bits: 128 }
}

/** 判断 IP 是否属于私有 / 特殊用途段。 */
export function isPrivateIp(ip: string): boolean {
  const c = toComparable(ip)
  if (c === null) return false
  return PRIVATE_CIDRS.some(net => inCidr(c.v, c.bits, net))
}

/** 判断 IP 是否属于 fake-ip 代理占位段。 */
export function isFakeIpAddress(ip: string): boolean {
  const c = toComparable(ip)
  if (c === null) return false
  return FAKE_IP_CIDRS.some(net => inCidr(c.v, c.bits, net))
}

/** 主机名级判断：localhost / 裸主机名 / 内网域名后缀。 */
export function hostIsPrivateName(host: string): boolean {
  const h = (host || '').trim().replace(/\.+$/u, '').toLowerCase()
  if (h === '') return true
  if (LOCALHOST_NAMES.has(h)) return true
  if (!h.includes('.')) return true  // 裸主机名（如 intranet、router）默认视为内网
  return PRIVATE_HOST_SUFFIXES.some(s => h.endsWith(s))
}

/** 数字 IP 字面量字符集：十进制 / 十六进制（0x）/ 前导零八进制 / 点分组合。 */
const NUMERIC_HOST_RE = /^[0-9a-fA-FxX.]+$/

/**
 * 数字 IP 字面量规范化：八进制 / 十六进制 / 单段整数 → 标准点分 IPv4。
 *
 * 各系统解析器对 `0177.0.0.1`、`0x7f.0.0.1`、`2130706433` 的行为不一致，
 * 校验层不能依赖连接层的"自觉"。非数字字面量返回 `null`。
 */
export function normalizeNumericHost(host: string): string | null {
  if (host === '' || !NUMERIC_HOST_RE.test(host) || host.includes(':')) return null

  const toInt = (seg: string): number | null => {
    try {
      if (seg.toLowerCase().startsWith('0x')) return parseInt(seg, 16)
      if (seg.length > 1 && seg.startsWith('0')) return parseInt(seg, 8)
      return parseInt(seg, 10)
    } catch { return null }
  }

  if (host.includes('.')) {
    const segs = host.split('.')
    if (segs.length !== 4) return null
    const parts: number[] = []
    for (const s of segs) {
      const v = toInt(s)
      if (v === null || Number.isNaN(v) || v > 255) return null
      parts.push(v)
    }
    return parts.join('.')
  }
  const v = toInt(host)
  if (v === null || Number.isNaN(v) || v > 0xffffffff) return null
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff].join('.')
}

/** 注入点：DNS 解析。默认用 `node:dns`，测试可替换。 */
export type Resolver = (host: string) => Promise<string[]>

const defaultResolver: Resolver = async (host) => {
  const dns = await import('node:dns')
  const res = await dns.promises.lookup(host, { all: true, verbatim: true })
  return res.map(r => r.address)
}

/**
 * 综合判断主机是否私有：先主机名，再数字字面量，最后 DNS 解析。
 *
 * **fake-ip 例外**: 若解析出的地址**全部**是占位段（域名被代理接管，
 * 流量走 TUN 直达公网），则不视为私网；**只要含任一真实私有 IP 即拦截**。
 *
 * **解析失败 → 保守拦截**（与 argo 一致）: 无法确认公网性时宁可误伤。
 */
export async function hostIsPrivate(host: string, resolve: Resolver = defaultResolver): Promise<boolean> {
  if (hostIsPrivateName(host)) return true
  const norm = normalizeNumericHost(host)
  if (norm !== null && norm !== host) {
    // 数字字面量变体：直接按规范化结果查表，不依赖各系统解析行为的一致性
    return isPrivateIp(norm)
  }
  let addrs: string[]
  try {
    addrs = await resolve(host)
  } catch {
    return true  // 解析失败无法确认公网性 → 保守按私有处理
  }
  const seen = new Set<string>()
  for (const ip of addrs) {
    if (seen.has(ip)) continue
    seen.add(ip)
    if (isFakeIpAddress(ip)) continue  // 代理接管域名，不视为内网
    if (isPrivateIp(ip)) return true
  }
  return false
}

export interface UrlSafety { readonly ok: boolean; readonly reason: string }

/** 校验 URL 是否可安全请求。 
 * .agents/notes/implemented/architecture/2026-09-18-fetch-entry-point.md
 * .agents/notes/implemented/architecture/2026-09-18-port-not-fork.md
 */
export async function checkUrl(url: string, resolve: Resolver = defaultResolver): Promise<UrlSafety> {
  if (typeof url !== 'string' || url === '') return { ok: false, reason: '空 URL' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch (err) {
    return { ok: false, reason: `URL 解析失败: ${(err as Error).message}` }
  }
  const scheme = parsed.protocol.replace(/:$/u, '').toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') {
    return { ok: false, reason: `仅允许 http/https，收到 ${scheme || '空'} scheme` }
  }
  const host = parsed.hostname
  if (host === '') return { ok: false, reason: 'URL 缺少主机名' }
  if (allowPrivate()) return { ok: true, reason: '' }
  if (hostIsPrivateName(host)) return { ok: false, reason: `主机名指向本机/内网: ${host}` }
  if (await hostIsPrivate(host, resolve)) return { ok: false, reason: `目标 IP 属于私有/保留段: ${host}` }
  return { ok: true, reason: '' }
}

/** 便捷布尔封装。 */
export async function isSafeFetchUrl(url: string, resolve: Resolver = defaultResolver): Promise<boolean> {
  return (await checkUrl(url, resolve)).ok
}
