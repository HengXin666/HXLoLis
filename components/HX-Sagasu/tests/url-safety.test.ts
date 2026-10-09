import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkUrl, hostIsPrivate, hostIsPrivateName, isFakeIpAddress, isPrivateIp,
  normalizeNumericHost, type Resolver,
} from '../src/url-safety.ts'

// 移植自 argo scripts/url_safety.py（MIT）。测试逐条对应它的防护点。

const pub: Resolver = async () => ['93.184.216.34']
const priv: Resolver = async () => ['127.0.0.1']
const fake: Resolver = async () => ['198.18.0.7']
const mixed: Resolver = async () => ['198.18.0.7', '192.168.1.5']
const boom: Resolver = async () => { throw new Error('ENOTFOUND') }

test('scheme 白名单：只放行 http/https', async () => {
  for (const u of ['file:///etc/passwd', 'ftp://x.com/a', 'gopher://x.com', 'data:text/html,x']) {
    const r = await checkUrl(u, pub)
    assert.equal(r.ok, false, u)
    assert.match(r.reason, /http\/https/)
  }
  assert.equal((await checkUrl('http://example.com', pub)).ok, true)
  assert.equal((await checkUrl('https://example.com', pub)).ok, true)
})

test('主机名级：localhost / 裸主机名 / 内网后缀', () => {
  for (const h of ['localhost', 'LOCALHOST', 'ip6-localhost', 'router', 'intranet', 'a.local', 'b.internal', 'c.lan', 'd.corp', 'e.intranet', 'f.home.arpa']) {
    assert.equal(hostIsPrivateName(h), true, h)
  }
  for (const h of ['example.com', 'api.github.com', 'a.b.c.io']) {
    assert.equal(hostIsPrivateName(h), false, h)
  }
})

test('**数字字面量规范化**  八进制/十六进制/单段整数都必须被识破', () => {
  // 这是 argo 最值钱的一条: 各系统解析器行为不一致，校验层不能依赖连接层的"自觉"。
  assert.equal(normalizeNumericHost('0177.0.0.1'), '127.0.0.1', '八进制')
  assert.equal(normalizeNumericHost('0x7f.0.0.1'), '127.0.0.1', '十六进制')
  assert.equal(normalizeNumericHost('2130706433'), '127.0.0.1', '单段整数')
  assert.equal(normalizeNumericHost('0'), '0.0.0.0')
  assert.equal(normalizeNumericHost('example.com'), null, '非数字字面量')
})

test('绕过手法必须被拦住（每一条都是一次真实 SSRF 尝试）', async () => {
  const cases = [
    'http://0177.0.0.1/',            // 八进制环回
    'http://0x7f.0.0.1/',            // 十六进制环回
    'http://2130706433/',            // 单段整数环回
    'http://[::ffff:127.0.0.1]/',    // IPv4-mapped IPv6
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',  // 云元数据端点
    'http://100.64.0.1/',            // CGNAT
    'http://[::1]/',
    'http://[fc00::1]/',
  ]
  for (const u of cases) {
    const r = await checkUrl(u, priv)
    assert.equal(r.ok, false, `必须拦住: ${u}`)
  }
})

test('IPv4-mapped IPv6 必须转回 IPv4 再查表', () => {
  assert.equal(isPrivateIp('::ffff:127.0.0.1'), true, '不转换就能绕过')
  assert.equal(isPrivateIp('::ffff:192.168.1.1'), true)
  assert.equal(isPrivateIp('::ffff:93.184.216.34'), false, '公网映射地址不该被误伤')
})

test('CGNAT 与保留段（非 8 倍数前缀，字符串前缀匹配会算错）', () => {
  assert.equal(isPrivateIp('100.64.0.1'), true, '100.64.0.0/10')
  assert.equal(isPrivateIp('100.127.255.255'), true, '/10 的上边界')
  assert.equal(isPrivateIp('100.128.0.1'), false, '/10 之外')
  assert.equal(isPrivateIp('172.16.0.1'), true, '172.16.0.0/12')
  assert.equal(isPrivateIp('172.31.255.255'), true, '/12 上边界')
  assert.equal(isPrivateIp('172.32.0.1'), false, '/12 之外')
  assert.equal(isPrivateIp('240.0.0.1'), true, '240.0.0.0/4')
  assert.equal(isPrivateIp('223.255.255.255'), false, '/4 之外')
})

test('**fake-ip 例外**  代理用户不该被全站误伤', async () => {
  // Clash/Surge TUN 把域名解析到 198.18.0.0/15，流量走 TUN 直达公网。
  // 没有这条例外，任何用代理的用户都会被拦。
  assert.equal(isFakeIpAddress('198.18.0.7'), true)
  assert.equal(isFakeIpAddress('198.19.255.255'), true, '/15 上边界')
  assert.equal(await hostIsPrivate('example.com', fake), false, '全部是占位段 → 放行')
  assert.equal(await hostIsPrivate('example.com', mixed), true, '**含任一真实私有 IP 仍拦截**')
})

test('**DNS 解析失败必须保守拦截**  宁可误伤不可漏防', async () => {
  assert.equal(await hostIsPrivate('example.com', boom), true)
})

test('公网地址正常放行（不误伤）', async () => {
  assert.equal(await hostIsPrivate('example.com', pub), false)
  assert.equal((await checkUrl('https://api.github.com/x', pub)).ok, true)
})

test('畸形 URL 不许抛异常，要返回可读的失败', async () => {
  for (const u of ['', 'not a url', 'http://', '://x']) {
    const r = await checkUrl(u, pub)
    assert.equal(r.ok, false, u)
    assert.ok(r.reason.length > 0)
  }
})
