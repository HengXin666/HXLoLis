# 替身边界

只在系统边界使用替身

| 边界 | 做法 |
|---|---|
| 外部 API (支付, 邮件, 第三方 SDK) | 替身数据端口, 按端点返回固定形状 |
| 数据库 | 优先隔离测试库并 seed/reset, 只有 mock 层才换成假数据端口 |
| 时间与随机数 | 注入时钟和种子, 不 sleep 等待真实时间 |
| 文件系统 | 优先在 tmpdir 下读写真实文件, 不写绝对路径 |

不替身自有模块, 内部协作者以及任何本项目能控制的代码. 需要替身内部模块才能测, 说明接缝选错或模块边界有问题, 回到接缝步骤调整

## 与 hx-agent-code 测试层的对应

| 层 | 数据来源 |
|---|---|
| backend/unit | 无外部依赖, 不需要替身 |
| backend/api/mock | 假数据端口替换存储与远程服务 |
| backend/api/real | 隔离测试库或测试服务, 永不连接生产数据 |
| frontend/api | 测试后端的真实响应, 不 mock 后端 |
| frontend/ui | 假后端数据 |
| contract | YAML 契约是唯一期望来源 |

同一行为需要 mock 与 real 两层时各写一条, 不让 mock 层冒充真实对接验收

## 为可替身而设计

业务逻辑不直接创建数据库连接或远程客户端, 由调用方注入

```ts
// 易替身: 依赖从参数传入
function processPayment(order: Order, client: PaymentClient) {
    return client.charge(order.total);
}

// 难替身: 在内部创建依赖并读取环境变量
function processPayment(order: Order) {
    const client = new StripeClient(process.env.STRIPE_KEY);
    return client.charge(order.total);
}
```

对外部服务按操作提供 SDK 式接口, 每个操作一个函数, 不提供一个靠参数分支的通用 fetch. 这样每个替身只返回一种形状, 替身里没有条件逻辑, 也能直接看出测试用到了哪些端点
