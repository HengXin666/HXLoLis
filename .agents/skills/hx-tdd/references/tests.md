# 好测试与坏测试

## 判据

- 验证调用方关心的行为, 只用公共接口, 内部重构而行为不变时测试不受影响
- 测试名描述做到了什么, 不描述怎么做, 如 `已登记用户可按 ID 取回` 而不是 `createUser 调用 repo.insert`
- 一条测试只断言一个逻辑结果, 多个字段属于同一结果时可一起断言
- 期望值来自独立事实源, 测试能与实现意见不一致

## 反模式

| 反模式 | 表现 | 识别方式 |
|---|---|---|
| 实现耦合 | 替身内部协作者, 测私有函数, 断言调用次数或顺序, 绕过接口直接查库 | 只重构不改行为时测试就红 |
| 同义反复 | 期望值按实现同样的方式重算, 手工按同一算法生成快照, 常量断言等于自身 | 测试按构造必然通过, 永远不会与代码不一致 |
| 水平切片 | 先写完全部测试再写实现 | 测试锁定想象中的结构, 对真实行为变化不敏感 |

## 正反例

经接口观察结果, 不断言内部调用

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// 坏: 断言内部协作者被调用
test("checkout 调用 payment.process", async () => {
    const calls: number[] = [];
    const payment = { process: (total: number) => { calls.push(total); } };
    await checkout(cart, payment);
    assert.deepEqual(calls, [cart.total]);
});

// 好: 断言调用方可见的结果
test("购物车有效时可以完成下单", async () => {
    const cart = createCart();
    cart.add(product);
    const result = await checkout(cart, paymentMethod);
    assert.equal(result.status, "confirmed");
});
```

经接口取回结果, 不绕过接口直接查库

```ts
// 坏: 用 SQL 旁路验证
test("createUser 写入数据库", async () => {
    await createUser({ name: "Alice" });
    const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
    assert.ok(row);
});

// 好: 用另一个公共接口取回
test("创建的用户可按 ID 取回", async () => {
    const user = await createUser({ name: "Alice" });
    const found = await getUser(user.id);
    assert.equal(found.name, "Alice");
});
```

期望值用已知字面量, 不按实现重算

```ts
// 坏: 期望值与实现同一算法
test("calculateTotal 汇总明细", () => {
    const items = [{ price: 10 }, { price: 5 }];
    const expected = items.reduce((sum, item) => sum + item.price, 0);
    assert.equal(calculateTotal(items), expected);
});

// 好: 独立的已知结果
test("calculateTotal 汇总明细", () => {
    assert.equal(calculateTotal([{ price: 10 }, { price: 5 }]), 15);
});
```

示例使用 `node:test`, 目标项目按其已有 runner 改写, 判据不变
