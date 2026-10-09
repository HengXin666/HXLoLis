import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PLATFORMS, coverage, getAdapter } from '../src/adapters/registry.ts'

test('覆盖率由登记表算出，不允许各处手写数字', () => {
  const c = coverage()
  assert.equal(c.total, PLATFORMS.length)
  assert.equal(c.ready, PLATFORMS.filter(p => p.state === 'ready').length)
  // 汇总各类别之和必须等于总数（防止漏登记）
  const sum = Object.values(c.byState).reduce((a, b) => a + b.length, 0)
  assert.equal(sum, c.total)
})

test('每个未接入的平台都必须写明依据与解锁条件  没有理由的 TODO 不算数', () => {
  for (const p of PLATFORMS) {
    assert.ok(p.evidence.length > 20, `${p.platform} 缺少一手实测依据`)
    if (p.state !== 'ready') {
      assert.ok((p.unlock ?? '').length > 5, `${p.platform} 是 ${p.state}，必须写明解锁条件`)
    } else {
      assert.ok(p.adapter !== undefined, `${p.platform} 标为 ready 就必须有适配器`)
    }
  }
})

test('state=ready 与 adapter 的存在严格一一对应', () => {
  for (const p of PLATFORMS) {
    assert.equal(p.state === 'ready', p.adapter !== undefined, `${p.platform} 的 state 与 adapter 不一致`)
  }
})

test('取未接入平台的适配器会抛错，并带上解锁条件（而不是返回 null）', () => {
  assert.throws(() => getAdapter('xiaohongshu'), /尚未接入.*解锁条件/s)
  assert.throws(() => getAdapter('discord'), /尚未接入/)
})

test('已接入平台的适配器能被取出且能力声明正确', () => {
  const bili = getAdapter('bilibili')
  assert.equal(bili.platform, 'bilibili')
  assert.equal(bili.capabilities.search, true)
  const tg = getAdapter('telegram')
  assert.equal(tg.platform, 'telegram')
  // 2026-09-16 实测更正: 这里此前断言 search===false，理由写作"公开频道页没有搜索能力"。
  // 那是**未实测的假设**，实测已被推翻（t.me/s/<ch>?q=<term> 是服务端过滤）。
  // 教训: 把未验证的假设写进测试，测试就从"防线"变成了"错误的固化装置"  它会让
  // 后来者以为"已经验证过了"。能力断言必须能指向一条实测证据。
  assert.equal(tg.capabilities.search, true, '频道内搜索已实测可用（t.me/s/<channel>?q=<term>）')
  assert.equal(tg.capabilities.requiresAuth, false)
})

test('八个目标平台一个都不缺  未接入的也要在表里，且写明为什么', () => {
  const targets = ['telegram', 'discord', 'x', 'xiaohongshu', 'heybox', 'tieba', 'bilibili', 'youtube']
  for (const t of targets) {
    assert.ok(PLATFORMS.some(p => p.platform === t), `目标平台 ${t} 不在登记表里`)
  }
})

// ── 平台登记表的一致性（2026-09-18 加）──────────────────────────
//
// 起因: 本轮补实测结论时，我给 X.com 加了**第二条**记录（platform: 'twitter'），
// 而原有条目用的是 platform: 'x'  同一平台两条记录，coverage() 把它算了两次。

test('同一平台不许登记两条  coverage 会重复计数', () => {
  // **判据必须按 label 去重，不能按 platform 键。**
  // 我第一版写的是按 `p.platform` 去重  而那个重复的两条分别写着
  // `platform: 'x'` 与 `platform: 'twitter'`，**字符串不同所以测试看不见它**。
  // 测试通过了，重复还在，coverage 仍然把 X.com 算了两次。
  // **判据选错 = 测试在守卫一个不存在的问题。**
  const seen = new Map<string, number>()
  for (const p of PLATFORMS) seen.set(p.label, (seen.get(p.label) ?? 0) + 1)
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
  assert.deepEqual(dupes, [], '重复的平台登记（按 label）: ' + dupes.join(','))
})

test('X.com 只登记一条  它的 platform 键历史上是 x 与 twitter 两种写法', () => {
  const xs = PLATFORMS.filter(p => p.label.includes('X.com'))
  assert.equal(xs.length, 1, 'X.com 相关条目: ' + JSON.stringify(xs.map(p => p.platform)))
})

test('coverage().total 等于登记条数，且各状态之和等于总数', () => {
  const c = coverage()
  assert.equal(c.total, PLATFORMS.length)
  const summed = Object.values(c.byState).reduce((a, b) => a + b.length, 0)
  assert.equal(summed, c.total, '各状态之和必须等于总数（否则有平台漏统计）')
})

test('每条非 ready 的平台都必须有 evidence 与 unlock  判定要能追溯', () => {
  // 这是本项目对"未实测的假设"的一贯拒绝: 判定必须追溯得到某次具体测量，
  // 且必须写明接上它需要什么，否则下一个人只会重复走一遍已走过的路。
  for (const p of PLATFORMS) {
    assert.ok(p.evidence.length > 10, p.platform + ' 缺少实测依据')
    if (p.state !== 'ready') {
      assert.ok(p.unlock !== undefined && p.unlock.length > 5, p.platform + ' 缺少 unlock（接上它需要什么）')
    }
  }
})
