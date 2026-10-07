# 4 gate  接上门禁并证明它会失败

## 只做这一件事

把两条检查接进工作流, 并**制造违规样本确认它们真的会拦下来**

## 为什么必须制造违规样本

一个永远通过的检查器比没有检查器更糟  它给人虚假的安全感. 这一步的核心不是"接上", 是"证明它拦得住"

## 做法

```bash
# 1. 正常跑一遍, 应当通过
node scripts/check-ui-rules.ts src
node scripts/check-contract.ts .

# 2. 造一份故意违规的样本, 确认退出码是 1
mkdir -p /tmp/fixture/src
cat > /tmp/fixture/src/Bad.tsx <<'EOF'
export function Bad() {
  return (
    <div className="bg-slate-800 border-2 rounded-3xl transition-all shadow-[0_4px_16px]"
         style={{ color: "#ff0055" }}>
      <button onClick={() => fetch("/api/list")}>go</button>
    </div>
  );
}
EOF
node scripts/check-ui-rules.ts /tmp/fixture/src; echo "退出码: $?"   # 必须是 1

# 3. 造一份合规样本, 确认退出码是 0 (防止误报把好代码判死)
mkdir -p /tmp/clean/src
cat > /tmp/clean/src/Good.tsx <<'EOF'
import { Button } from "./button";
export function Good() {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 transition-colors">
      <Button variant="primary">go</Button>
    </div>
  );
}
EOF
node scripts/check-ui-rules.ts /tmp/clean/src; echo "退出码: $?"     # 必须是 0
```

契约门禁的违规样本见 `scripts/check-contract.ts` 顶部注释里的三类: 契约单边引用、手写通道字符串、缺运行时校验

## 接进工作流

- 提交前跑一次 (pre-commit 或 CI 皆可)
- 编辑器里把这两条挂成任务, 改完随手跑
- 不要把它们写成"建议"  必须是非零退出

## 过关条件

两条脚本各跑过一次, 且**都亲眼见到过退出码 1 与 0**
