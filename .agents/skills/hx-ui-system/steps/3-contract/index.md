# 3 contract  定前后端契约

## 只做这一件事

定通道名、载荷类型、广播事件. **不写业务逻辑, 不做界面. **

## 先读

`references/contract-pattern.md`

## 产物

```
shared/contract-<域>.ts     通道常量 + 载荷类型 + 事件类型   ← 唯一事实源
src/api/<域>.ts             前端封装: 只做转发、错误映射、运行时校验
server/routes/<域>.ts       后端处理
```

三层缺一不可. **契约文件必须被前后端同时 import**  只有一边用它, 它就是一份会腐烂的文档

## 通道命名

`<应用名>:<域>:<动作>`, 全小写连字符. 读写分离: 查询与变更用不同通道, 后端可以给它们不同的超时、重试与权限

## 载荷必须带运行时校验

TS 类型在运行期不存在. 后端字段改名时前端不会报错, 只会拿到 `undefined`. 每个响应都要有一条运行时收窄路径 (zod 或手写 guard)

```ts
export async function listUsers(): Promise<User[]> {
  const res = await fetch("/api/user/list");
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return z.array(UserSchema).parse(await res.json());
}
```

## 后端是事实源时, 补一条广播

状态可能由与前端无关的动作改变 (定时任务、别的客户端). 没有广播通道, 前端会停在旧状态上. 广播载荷要小: 无载荷就发"某某已变", 让前端去重读, 不要把整份数据推来推去

## 过关条件

两条都要过

1. `node ../hx-ui-system/scripts/check-contract.ts .` 零 ERROR
2. **后端真的启动一次并返回一个请求. ** 类型检查通过不等于服务能起来  若后端用 Node 直接跑 `.ts`, 相对 import 的扩展名约束只在运行期暴露. 见 `references/node-ts-server.md`
