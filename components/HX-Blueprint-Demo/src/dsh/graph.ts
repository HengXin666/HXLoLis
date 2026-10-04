import type { BlueprintGraph } from "@hx/ui";
import { EXEC_IN_PORT } from "@hx/ui";

/**
 * dsh agent loop 的图数据。
 *
 * ## 连线的依据
 *
 * 每条执行边对应源码里一个真实的"下一步"。举几处不那么显然的:
 *
 *   kick -> turnStart -> ... -> wakeAgain ->(again) kick
 *     源码: `while (await this.turn()); turn() 末尾 `return true` 表示再来一轮
 *
 *   checkEmptyFirst ->(empty) turnEnd
 *     源码: `turnEnds = { kind: "completed" }; return false` —— 直接结束, 不进步骤
 *
 *   checkReject ->(reject) turnEnd
 *     源码: 同上, `kind: "blocked"`
 *
 *   stream -> checkFinish ->(error) requestError ->(retry) prepareRequest
 *     源码: `continue` 回到 while(true) 顶部 —— **重试复用已渲染的组装结果,
 *     不重新组装、不重跑 pre-step、不重复追加 user 消息**
 *
 *   executionMode ->(exclusive) exclusiveBarrier / (parallel) parallelPool
 *     源码: `mode === "parallel" ? planned.slice(next) : [first]`
 *
 * ## 分组注释
 *
 * 图里带三条注释, 对应源码里的三个自然段落: 轮次、步骤、工具调度。
 * 拖动注释会带走完全落在里面的节点 —— 重排布局时它们是一整块。
 */

const n = (id: string, type: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id, type, x, y, ...extra,
});

/** 执行边。终端之间只有一条白线, 不需要数据端口。 */
const e = (id: string, from: string, fromPort: string, to: string, toPort = EXEC_IN_PORT) => ({
  id, from: { node: from, port: fromPort }, to: { node: to, port: toPort }, kind: "exec" as const,
});

/** 数据边。 */
const d = (id: string, from: string, fromPort: string, to: string, toPort: string) => ({
  id, from: { node: from, port: fromPort }, to: { node: to, port: toPort }, kind: "data" as const,
});

export const dshAgentLoopGraph: BlueprintGraph = {
  nodes: [
    // ── 启动 ──
    n("created", "agentCreated", 40, 300),
    n("kick", "kick", 40, 380),

    // ── 轮次开启 ──
    n("turnStart", "turnStart", 40, 460),
    n("claim", "claim", 40, 540),
    n("assemble", "assemblePrompt", 40, 620),
    n("projectCtx", "projectRuntimeContext", 40, 700),
    n("preStep", "preStep", 40, 780),

    // ── 准入判定 ──
    n("checkReject", "checkReject", 40, 880),
    n("checkEmpty", "checkEmptyFirst", 40, 980),
    n("stepStart", "stepStart", 40, 1080),

    // ── 步骤主体 ──
    n("prepare", "prepareRequest", 340, 1080),
    n("admitPrompt", "admitPrompt", 340, 1180),
    n("admitUser", "admitUser", 340, 1280),
    n("freeze", "freezeRequest", 340, 1380),
    n("stream", "stream", 340, 1480),

    // ── 收尾分支 ──
    n("checkFinish", "checkFinish", 340, 1600),
    n("requestError", "requestError", 660, 1520),
    n("appendAssistant", "appendAssistant", 340, 1720),
    n("checkTools", "checkToolCalls", 340, 1820),

    // ── 工具调度 ──
    n("mode", "executionMode", 340, 1940),
    n("exclusive", "exclusiveBarrier", 140, 2040),
    n("parallel", "parallelPool", 460, 2040),
    n("commit", "commitToolResults", 340, 2160),
    n("skip", "skipRemaining", 660, 2040),

    // ── 轮次收尾 ──
    // stepEnd 的执行入口是独占的, 而源码里 maxTokens 与 commit 两条路都汇到
    // finally 块的 step/end。蓝图里用一个显式的汇聚节点表达"两条路汇合",
    // 而不是让某一条赢 —— 后者会把"总是写 step/end"这个语义画丢。
    n("stepJoin", "stepJoin", 340, 2220),
    n("stepEnd", "stepEnd", 340, 2280),
    n("turnStopping", "turnStopping", 340, 2380),
    n("checkContinue", "checkContinue", 340, 2480),
    n("turnEnd", "turnEnd", 40, 2580),
    n("wake", "wakeAgain", 40, 2680),

    // ── 失败路径 ──
    // toolRecovery 是步骤失败时的补记动作: 源码里在 catch 块里, 为尚无结果的
    // 工具调用补 TOOL_OUTCOME_UNKNOWN / TOOL_NOT_STARTED。它挂在 stepStart
    // 的失败口上, 补完之后交给 agent/error 关闭轮次。
    n("recovery", "toolRecovery", 660, 2280),
    n("agentError", "agentError", 660, 2380),
    n("settle", "settleInterrupted", 660, 1720),
  ],

  edges: [
    // 启动 -> 轮次
    e("x1", "created", "then", "kick"),
    e("x2", "kick", "then", "turnStart"),

    // 轮次开启链
    e("x3", "turnStart", "then", "claim"),
    e("x4", "claim", "then", "assemble"),
    e("x5", "assemble", "then", "projectCtx"),
    e("x6", "projectCtx", "then", "preStep"),
    d("d1", "claim", "messages", "preStep", "messages"),

    // 准入判定
    e("x7", "preStep", "then", "checkReject"),
    d("d2", "preStep", "decision", "checkReject", "decision"),
    e("x8", "checkReject", "reject", "turnEnd"),
    e("x9", "checkReject", "enter", "checkEmpty"),
    d("d3", "claim", "messages", "checkEmpty", "messages"),
    e("x10", "checkEmpty", "empty", "turnEnd"),
    e("x11", "checkEmpty", "hasInput", "stepStart"),

    // 步骤主体
    e("x12", "stepStart", "then", "prepare"),
    e("x13", "prepare", "then", "admitPrompt"),
    d("d4", "assemble", "assembly", "admitPrompt", "assembly"),
    e("x14", "admitPrompt", "then", "admitUser"),
    e("x15", "admitUser", "then", "freeze"),
    d("d5", "prepare", "config", "freeze", "config"),
    e("x16", "freeze", "then", "stream"),
    d("d6", "freeze", "request", "stream", "request"),

    // 收尾分支
    e("x17", "stream", "then", "checkFinish"),
    d("d7", "stream", "try", "checkFinish", "try"),
    e("x18", "checkFinish", "error", "requestError"),
    e("x19", "requestError", "retry", "prepare"), // 回到 while(true) 顶部
    e("x20", "requestError", "abort", "settle"),
    e("x21", "checkFinish", "maxTokens", "stepJoin"),
    e("x22", "checkFinish", "ok", "appendAssistant"),

    // 工具调度
    e("x23", "appendAssistant", "then", "checkTools"),
    d("d8", "appendAssistant", "message", "checkTools", "message"),
    e("x24", "checkTools", "none", "stepEnd"),
    e("x25", "checkTools", "has", "mode"),
    d("d9", "appendAssistant", "message", "mode", "message"),
    e("x26", "mode", "exclusive", "exclusive"),
    e("x27", "mode", "parallel", "parallel"),
    e("x28", "exclusive", "then", "commit"),
    e("x29", "parallel", "then", "commit"),
    e("x30", "mode", "parallel", "skip"), // 取消时给未分发的调用补结果

    // 轮次收尾
    e("x31", "commit", "then", "stepJoin"),
    e("x32", "skip", "then", "stepJoin"),
    e("x42", "stepJoin", "then", "stepEnd"),
    e("x33", "stepEnd", "then", "turnStopping"),
    e("x34", "turnStopping", "then", "checkContinue"),
    e("x35", "checkContinue", "break", "turnEnd"),
    e("x36", "checkContinue", "continue", "stepStart"), // 回到本轮的下一步
    e("x37", "turnEnd", "then", "wake"),
    e("x38", "wake", "again", "kick"), // 再来一轮
    e("x39", "wake", "idle", "agentError"),

    // 失败路径
    // 步骤抛错 -> catch 里补记未决工具结果 -> agent/error 关闭轮次
    e("x43", "stepStart", "failed", "recovery"),
    e("x40", "recovery", "then", "agentError"),
    e("x41", "settle", "then", "stepEnd"),
  ],

  comments: [
    {
      id: "c-turn",
      title: "轮次开启",
      body: "turn/start 之后: 领输入 → 组装提示词 → 投影上下文 → pre-step 拦截。被拒绝或首步输入为空都不打开步骤。",
      x: -20, y: 430, w: 460, h: 560,
      tone: "primary",
    },
    {
      id: "c-step",
      title: "一个步骤",
      body: "while(true) 的重试回到 prepareRequest 之后 —— 复用已渲染组装, 不重新组装、不重跑 pre-step。",
      x: 280, y: 1030, w: 460, h: 720,
      tone: "warning",
    },
    {
      id: "c-tools",
      title: "工具调度",
      body: "独占调用形成屏障; 并行安全调用进有界池, 上限 maxParallelToolCalls。结果与上下文按模型顺序提交。",
      x: 80, y: 1890, w: 700, h: 340,
      tone: "success",
    },
  ],

  subgraphs: {},
};

/**
 * 三个可折叠的区域。
 *
 * 演示页的"折叠"按钮用它们 —— 一张 30 个节点的图平铺着看不清结构,
 * 折成三块之后层次才出来。这也是蓝图库自己的卖点: 用自己演示自己。
 */
export const COLLAPSIBLE_GROUPS = {
  "轮次开启": ["turnStart", "claim", "assemble", "projectCtx", "preStep", "checkReject", "checkEmpty"],
  "一个步骤": ["prepare", "admitPrompt", "admitUser", "freeze", "stream", "checkFinish", "requestError", "appendAssistant", "checkTools"],
  "工具调度": ["mode", "exclusive", "parallel", "commit", "skip"],
} as const;
