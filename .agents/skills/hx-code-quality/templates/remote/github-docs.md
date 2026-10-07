# GitHub 协作文档模板

此为新增 GitHub 适配, 不冒称原件已有. 只为项目实际需要的协作入口创建文件, 参考字段必须改成该项目能验证的问题. PR 模板/Issue 表单不等于自动门禁; CODEOWNERS 的文件存在不等于已设置必需审批

## PR 输入骨架

落到目标项目既有 PR 模板位置, 常见为 . github/PULL_REQUEST_TEMPLATE.md

~~~markdown
## 改动与理由
<受影响功能、为什么需要, 以及相应 issue 或决策链接>
## 验证证据
<本项目真实命令、结果、相关 UI 截图或契约测试; 没跑的项目及原因>
## 兼容性与回滚
<数据/配置/API 变化与回滚办法; 无变化时说明>
~~~

## Issue 输入骨架

按项目真实问题类型裁剪, 使用 . github/ISSUE_TEMPLATE/bug_report.yml 时

~~~yaml
name: 缺陷报告
description: 提供可复现的行为差异
body:
  - type: textarea
    id: reproduce
    attributes:
      label: 复现步骤
      description: 写出最小输入、实际结果与预期结果
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: 版本与环境
    validations:
      required: true
~~~

贡献文档只写本项目真实安装、验证和提交入口; 有既存模板先合并而非覆盖. 校验 YAML 和模板可达性; 远程不可访问时只报告本地配置验证. 必填字段是否能改善问题复现须用一次真实或受控的协作输入检验, 不统计空文件数量当完成
