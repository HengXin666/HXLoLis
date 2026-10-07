# 前后端契约: 三层对偶

核心主张只有一句: **同一份通道名与载荷类型, 前端与后端都要 import, 不允许各写一份. **

IPC 场景的范式直接取自 open-vetta (42 个 API 命名空间、523 处调用点都在用这套)

```
shared/contract-<域>.ts     通道常量 + 载荷类型 + 事件类型   ← 唯一事实源
        ├─> 前端 api/<域>.ts    invoke(CHANNELS.X, payload)   ← 只做转发与校验
        └─> 后端 routes/<域>.ts handle(CHANNELS.X, handler)   ← 只做处理
```

HTTP 场景把 `invoke/handle` 换成 `path + method`, 其余不变  差别只在传输, 不在结构

## 通道命名

```ts
// shared/contract-user.ts
export const USER_CHANNELS = {
  LIST: "app:user:list",
  CREATE: "app:user:create",
  CHANGED: "app:user:changed",   // 广播 (后端 → 前端)
} as const;
```

规律: `<应用名>:<域>:<动作>`, 全小写连字符. **读写分离**查询与变更不同通道, 这样后端可以给它们不同的超时、重试与权限

## 载荷类型必须自带运行时校验

TS 类型在运行期不存在. 后端字段改名时前端不会报错, 只会拿到 `undefined`. 所以每个响应类型都要有一条运行时收窄路径

```ts
import { z } from "zod";

export const UserSchema = z.object({ id: z.string(), name: z.string() });
export type User = z.infer<typeof UserSchema>;

export async function listUsers(): Promise<User[]> {
  const res = await fetch("/api/user/list");
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return z.array(UserSchema).parse(await res.json());   // 收窄在这里
}
```

`scripts/check-contract.ts` 会对"调了后端但没有任何 guard"的 api 文件报警

## 广播与轮询

后端是事实源时, 前端只持有一份快照. 状态变化可能由**与前端无关的动作**触发(定时任务、别的客户端、后台进程), 因此必须有一条广播通道, 否则前端会停在旧状态

广播载荷要小: 无载荷就发"某某已变", 让前端去重读; 不要把整份数据推来推去. 这样后端不必为每个订阅者裁剪数据, 前端也能沿用自己那条读取路径

## 前端禁止绕过 api 层

组件里不许出现 `fetch("/...')`. 所有调用走 `src/api/`, 那里统一负责: 鉴权头、错误映射、超时、运行时校验. 绕过去的后果是这些事散落在几十个组件里, 每处都缺一点

## 状态放在哪

| 状态 | 放哪 | 理由 |
|---|---|---|
| 后端返回的数据 | 请求库缓存 (TanStack Query 之类) | 便于失效与重取, 不要自己抄进全局 store |
| 跨组件共享的局部 UI 状态 | store | 例如侧栏折叠、当前页签 |
| 单个组件的交互状态 | `useState` | 不要为它建 store |
| 表单输入 | 表单库或组件本地 | 与后端数据分开, 未提交前不该污染缓存 |

反过来说: **后端数据不要自己拷进全局 store**  那样就有了两个事实源, 一个是缓存一个是副本, 迟早对不上
