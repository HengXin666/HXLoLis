# 用 Node 直接跑 TypeScript 后端

不需要构建步骤时, Node 22+ 可以直接执行 `.ts` 文件 (strip-types). 但有一处硬约束, 不知道它就会得到"构建全绿、服务起不来"的结果

## 相对 import 必须带 `.ts` 扩展名

```ts
// ✗ 运行时失败: ERR_MODULE_NOT_FOUND
import { snapshot } from "./store";
import { PROJECT_CHANNELS } from "../shared/contract-project";

// ✓ 正确
import { snapshot } from "./store.ts";
import { PROJECT_CHANNELS } from "../shared/contract-project.ts";
```

报错形如

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/server/store'
    imported from /app/server/events.ts
```

**它只在运行期暴露, 任何静态检查都不会报. ** 而且改了一处还会在下一处再撞一次, 所以要一次性全改

```bash
find server -name '*.ts' ! -name '*.test.ts' | while read f; do
  perl -i -pe 's{from "(\.{1,2}/(?:[\w.-]+/)*[\w.-]+)"}{from "$1.ts"}g unless /\.ts"/' "$f"
done
```

注意 `package.json` 里的 `"type": "module"` 是前提; 没有它 Node 按 CommonJS 解析, 又是另一套规则

## 另一种做法

不想被这条约束绑住, 就用 `tsx` 或 `node --experimental-strip-types` 之外的工具链跑后端. 两者取一, 不要混  混用时"为什么本地能跑、CI 不能"会变得极难查

## 验证方式

不要只看 `tsc --noEmit` 通过. **必须真的启动一次服务并打一个请求**

```bash
node server/index.ts &        # 应当在几秒内打印监听地址
sleep 2
curl -fsS http://127.0.0.1:4174/api/project/list | head -c 200
kill %1
```

"类型检查通过" 与 "服务能起来" 是两件事  上面那条扩展名约束恰好只能靠后者发现
