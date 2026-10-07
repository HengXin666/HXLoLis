# 模板 8：agent hook 注册

来源：assets/source/skeletons.md 第 8 节。以下是占位骨架，不是可运行脚本；项目落地前替换路径/工具并跑正反验证。

适配要求：不要把示例 JSONC（包含注释与占位符）直接存为 JSON。先确认当前 runtime 的事件、目录变量和阻断协议，逐一实测合规、违规、崩溃三种输入。

<!-- source-section:start -->
## 8. agent hook 注册

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "node \"$PROJECT_DIR\"/scripts/gates/shared/hook-guard.mjs", "timeout": 10 }]
    }],
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{ "type": "command", "command": "node \"$PROJECT_DIR\"/scripts/gates/shared/hook-format.mjs",
                  "timeout": 180, "statusMessage": "清理 + 格式化" }]
    }],
    "Stop": [{
      "hooks": [
        { "type": "command", "command": "node \"$PROJECT_DIR\"/scripts/gates/shared/hook-stop.mjs --backend",
          "timeout": 600, "statusMessage": "运行后端门禁(无变更则跳过)" }
        /* …每个分组一条… */
      ]
    }]
  }
}
```

- **每个 runtime 一份**配置文件, 目录变量名不同(Claude 系是 `$CLAUDE_PROJECT_DIR`, 其它 runtime 各有各的);
  内容同源, 但**只在支持该事件语义的 runtime 里注册**  不支持 PreToolUse 拦截的 runtime 硬塞 `hook-guard`,
  结果是一个永不生效的守卫。
- hook 的统一协议: 从 stdin 读一个 JSON, 用退出码表达决策。**`0` 放行 / `2` 阻塞并把 stderr 回灌给模型 /
  其它非零码 = 非阻塞错误**  脚本路径写错、解释器不对、语法错误全落在最后这档,
  也就是 **hook 静默失效的表现和"没发现问题"完全一样**。所以每个 hook 必须有冒烟测试。
- 能内置就不 hook: 能用 settings 的 permission `deny` 表达的规则优先用它(hook 适合"要看内容才能判断"的规则)。
- hook 脚本 / settings / CI 配置本身属于**受保护路径**, 改它们要有人审批。

<!-- source-section:end -->
