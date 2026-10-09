import { createRegistry, type BlueprintRegistryImpl } from "@hx/ui";
import type { NodeTypeDef, PortDef } from "@hx/ui";

/**
 * dsh agent loop 的节点集。
 *
 * ## 这不是"示意图", 是照着源码画的
 *
 * 每个节点对应 `dsh-agent-loop/lib/index.js` 里的一个真实控制流位置:
 *   kick()          -> while (await this.turn())
 *   turn()          -> while (true) { preStep -> step -> turn/end }
 *   preStep()       -> agent/pre-step waterfall
 *   step()          -> while (true) { prepareRequest -> stream -> tools }
 *   executeToolCalls-> while (next < planned.length)
 *   runGroup()      -> 独占屏障 / 有界并行池
 *
 * 分支条件也是源码里的: `decision.kind === "reject"`、`finish.kind`、
 * `toolCalls.length === 0`、`inbox.nextStep.length === 0`。
 * 行号写在每个节点的 `source` 字段里, 便于回去核对。
 *
 * ## 拓展方式
 *
 * 加一个节点 = 往 NODES 里加一条。加一种数据类型 = `reg.type(...)`。
 * 蓝图层不需要任何改动  这就是"轻易拓展"的实际含义:
 * 拓展发生在**数据**里, 不在库里。
 */

/** 给节点定义挂一个源码位置, 文档页会显示它。 */
export interface SourcedNodeTypeDef extends NodeTypeDef {
  /** 源码位置, 形如 "index.js:1041"。仅用于文档与核对。 */
  readonly source?: string;
}

const in_: Record<string, PortDef> = {
  trigger: { id: "trigger", label: "触发", type: "exec" },
  ctx: { id: "ctx", label: "上下文", type: "context" },
  decision: { id: "decision", label: "步骤决定", type: "decision" },
  messages: { id: "messages", label: "已领消息", type: "messages" },
  attempt: { id: "attempt", label: "模型尝试", type: "attempt" },
  tools: { id: "tools", label: "工具调用", type: "toolCalls" },
  stream: { id: "stream", label: "流", type: "stream" },
};

const out_: Record<string, PortDef> = {
  pass: { id: "pass", label: "通过", type: "exec" },
  fail: { id: "fail", label: "不通过", type: "exec" },
  value: { id: "value", label: "值", type: "any" },
};

export const NODES: Record<string, SourcedNodeTypeDef> = {
  // ── 启动 ───────────────────────────────────────────────────────────
  agentCreated: {
    type: "agentCreated",
    label: "agent 创建",
    category: "1. 启动",
    description: "create/resume 成功后宣告 session/created, 等待串行 agent/created 监听器, 随后释放已排队输入",
    source: "index.js:1859",
    execOut: ["then"],
  },
  /**
   * 回路汇合点。
   *
   * 执行入口是**多入**的: 源码里 `wake ->(again) kick` 是真实的回路,
   * 与 `created -> kick` 那条同时存在。蓝图默认独占执行入口
   * (再连一根会顶掉旧的), 那会把回路或启动边画丢一条。
   * 所以这类"汇合点"显式声明 multiExecIn。
   */
  kick: {
    type: "kick",
    label: "驱动器 kick",
    category: "1. 启动",
    description: "while (await this.turn())  一次 turn 返回 true 就再来一轮。执行入口多入: 启动与回路都回到这里",
    source: "index.js:885",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true,
  },

  // ── 轮次 ───────────────────────────────────────────────────────────
  turnStart: {
    type: "turnStart",
    label: "turn/start",
    category: "2. 轮次",
    description: "打开一个持久轮次。turn = phase.turn + 1",
    source: "index.js:933",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true, // 轮次入口: 首次进入与后续轮次都到这里
  },
  claim: {
    type: "claim",
    label: "原子领取输入",
    category: "2. 轮次",
    description: "轮次边界领 next-step 输入 + 一条排队提示词; 步骤之间只领 next-step 输入",
    source: "index.js:904",
    execIn: true,
    execOut: ["then"],
    outputs: [{ id: "messages", label: "已领消息", type: "messages" }],
  },
  assemblePrompt: {
    type: "assemblePrompt",
    label: "组装系统提示词",
    category: "2. 轮次",
    description: "ctx.systemPrompt.assemble()  权威组装 waterfall",
    source: "index.js:905",
    execIn: true,
    execOut: ["then"],
    /**
     * 上下文来自 agent 自身 (phase / session), 不是上游某个节点的输出。
     * 给 default 让它成为可选输入  否则图上会永远挂一个"缺少输入"的红点,
     * 而实际上没有东西该连进来。
     */
    inputs: [{ id: "ctx", label: "上下文", type: "context", default: null }],
    outputs: [{ id: "assembly", label: "组装结果", type: "assembly" }],
  },
  projectRuntimeContext: {
    type: "projectRuntimeContext",
    label: "投影运行时上下文",
    category: "2. 轮次",
    description: "renderContextSections -> runtimeContext.project()",
    source: "index.js:907",
    execIn: true,
    execOut: ["then"],
  },
  preStep: {
    type: "preStep",
    label: "agent/pre-step",
    category: "2. 轮次",
    description: "拦截 waterfall。默认返回 kind:'enter'; 返回 reject 则不打开步骤",
    source: "index.js:913",
    execIn: true,
    execOut: ["then"],
    inputs: [{ id: "messages", label: "已领消息", type: "messages" }],
    outputs: [{ id: "decision", label: "决定", type: "decision" }],
  },
  checkReject: {
    type: "checkReject",
    label: "被拒绝?",
    category: "2. 轮次",
    description: "decision.kind === 'reject' -> 轮次以 blocked 结束, 不打开步骤",
    source: "index.js:945",
    execIn: true,
    execOut: ["reject", "enter"],
    inputs: [{ id: "decision", label: "决定", type: "decision" }],
  },
  checkEmptyFirst: {
    type: "checkEmptyFirst",
    label: "首步输入为空?",
    category: "2. 轮次",
    description: "phase.step === 0 且消息数为 0 -> 轮次以 completed 结束。空的首批输入不打开步骤",
    source: "index.js:950",
    execIn: true,
    execOut: ["empty", "hasInput"],
    inputs: [{ id: "messages", label: "消息", type: "messages" }],
  },
  stepStart: {
    type: "stepStart",
    label: "step/start",
    category: "2. 轮次",
    description: "接纳后的首次尝试先记录 step/start, 再跑 agent/request waterfall",
    source: "index.js:970",
    execIn: true,
    execOut: ["then", "failed"],
    multiExecIn: true, // 步骤入口: 首步与「本轮继续下一步」都回到这里
  },

  // ── 步骤 ───────────────────────────────────────────────────────────
  prepareRequest: {
    type: "prepareRequest",
    label: "prepareRequest",
    category: "3. 步骤",
    description: "agent/request waterfall 决定 provider/model, 再 llm.prepareCall() 绑定适配器",
    source: "index.js:1170",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true, // 步骤入口与重试都汇到这里 (retry 复用已渲染组装)
    outputs: [{ id: "config", label: "请求配置", type: "request" }],
  },
  admitPrompt: {
    type: "admitPrompt",
    label: "提示词准入 / 归并",
    category: "3. 步骤",
    description: "依据 preparedCall 能力决定: 归并到首个系统节点, 或追加到已缓存历史之后",
    source: "index.js:1058",
    execIn: true,
    execOut: ["then"],
    inputs: [{ id: "assembly", label: "组装结果", type: "assembly" }],
  },
  admitUser: {
    type: "admitUser",
    label: "追加 user/message",
    category: "3. 步骤",
    description: "仅在首次尝试追加已接纳的 user/message 批次。重试不重复追加",
    source: "index.js:1067",
    execIn: true,
    execOut: ["then"],
  },
  freezeRequest: {
    type: "freezeRequest",
    label: "派生并冻结请求",
    category: "3. 步骤",
    description: "deepFreeze: header / messages / request。保留取消信号的可变性",
    source: "index.js:1070",
    execIn: true,
    execOut: ["then"],
    inputs: [{ id: "config", label: "请求配置", type: "request" }],
    outputs: [{ id: "request", label: "请求", type: "request" }],
  },
  stream: {
    type: "stream",
    label: "流式请求",
    category: "3. 步骤",
    description: "for await (const chunk of stream)  每个 chunk 都先 throwIfAborted",
    source: "index.js:1078",
    execIn: true,
    execOut: ["then"],
    inputs: [{ id: "request", label: "请求", type: "request" }],
    outputs: [{ id: "try", label: "一次尝试", type: "attempt" }],
  },

  // ── 步骤收尾分支 ───────────────────────────────────────────────────
  checkFinish: {
    type: "checkFinish",
    label: "检查 finish",
    category: "4. 收尾",
    description: "finish.kind: error / aborted -> 走 agent/request-error; max-tokens -> 结束; 否则提交 assistant/message",
    source: "index.js:1093",
    execIn: true,
    execOut: ["error", "maxTokens", "ok"],
    inputs: [{ id: "try", label: "一次尝试", type: "attempt" }],
  },
  requestError: {
    type: "requestError",
    label: "agent/request-error",
    category: "4. 收尾",
    description: "监听器返回 { kind:'retry' } 且不调 next() -> 重试; 未处理 -> 终态 LlmError",
    source: "index.js:1126",
    execIn: true,
    execOut: ["retry", "abort"],
  },
  appendAssistant: {
    type: "appendAssistant",
    label: "提交 assistant/message",
    category: "4. 收尾",
    description: "恰好一个终态 end。committed 出现在持久 assistant/message 之后",
    source: "index.js:1145",
    execIn: true,
    execOut: ["then"],
    outputs: [{ id: "message", label: "助手消息", type: "message" }],
  },
  checkToolCalls: {
    type: "checkToolCalls",
    label: "有工具调用?",
    category: "4. 收尾",
    description: "toolCalls.length === 0 -> 步骤以 completed 结束",
    source: "index.js:1155",
    execIn: true,
    execOut: ["none", "has"],
    inputs: [{ id: "message", label: "助手消息", type: "message" }],
  },

  // ── 工具调度 ───────────────────────────────────────────────────────
  executionMode: {
    type: "executionMode",
    label: "判定执行模式",
    category: "5. 工具",
    description: "ctx.tools.executionMode().kind  独占调用形成屏障, 并行安全调用进有界滚动池",
    source: "index.js:527",
    execIn: true,
    execOut: ["exclusive", "parallel"],
    inputs: [{ id: "message", label: "助手消息", type: "message" }],
  },
  exclusiveBarrier: {
    type: "exclusiveBarrier",
    label: "独占屏障",
    category: "5. 工具",
    description: "runGroup 只放一个。它单独运行并构成排序屏障",
    source: "index.js:553",
    execIn: true,
    execOut: ["then"],
  },
  parallelPool: {
    type: "parallelPool",
    label: "有界并行池",
    category: "5. 工具",
    description: "最多重叠 maxParallelToolCalls 个。结果与上下文按模型顺序提交",
    source: "index.js:553",
    execIn: true,
    execOut: ["then"],
    params: [{ id: "max", label: "并行上限", kind: "number", default: 10, min: 1, max: 64 }],
  },
  commitToolResults: {
    type: "commitToolResults",
    label: "提交结果与上下文",
    category: "5. 工具",
    description: "策略、持久结果与结果上下文保持模型顺序。acceptContext 交给下一步边界",
    source: "index.js:553",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true, // 独占屏障与并行池两条路都提交结果与上下文
  },
  skipRemaining: {
    type: "skipRemaining",
    label: "记 ABORTED_BEFORE_DISPATCH",
    category: "5. 工具",
    description: "取消后未分发的调用收到合成的 tool/call + 该错误码, 让后续历史里工具成对完整",
    source: "index.js:533",
    execIn: true,
    execOut: ["then"],
  },

  // ── 轮次收尾 ───────────────────────────────────────────────────────
  /**
   * 汇聚节点。
   *
   * 它不是源码里的一个函数, 而是**语义的显式化**: 源码里 maxTokens 与
   * commit 两条路都汇到 finally 块的 step/end, 而蓝图里执行入口是独占的
   * (连第二条会顶掉第一条)。直接画两条边进 stepEnd 会把其中一条画丢,
   * 也就丢掉了"step/end 总是写"这个语义。
   *
   * 所以这里用一个 multi 执行口的汇聚节点, 让两条路都留得下。
   */
  stepJoin: {
    type: "stepJoin",
    label: "汇合到 step/end",
    category: "6. 轮次收尾",
    description: "maxTokens 与工具提交两条路汇到同一个 step/end。执行入口多入  两条都要留得下",
    source: "index.js:996 (finally)",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true,
  },
  stepEnd: {
    type: "stepEnd",
    label: "step/end",
    category: "6. 轮次收尾",
    description: "finally 块里总是写。失败时先为尚无结果的调用补记错误结果",
    source: "index.js:996",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true, // step/end 在 finally 里总是写; 多条路径汇入
  },
  turnStopping: {
    type: "turnStopping",
    label: "agent/turn-stopping",
    category: "6. 轮次收尾",
    description: "轮次有结束原因且 inbox.nextStep 为空时串行跑。限制失控轮次的策略挂这里",
    source: "index.js:1016",
    execIn: true,
    execOut: ["then"],
  },
  checkContinue: {
    type: "checkContinue",
    label: "继续本轮?",
    category: "6. 轮次收尾",
    description: "turnEnds 且 inbox.nextStep 为空 -> 跳出本轮; 否则 target = next-step 再来一步",
    source: "index.js:1023",
    execIn: true,
    execOut: ["continue", "break"],
  },
  turnEnd: {
    type: "turnEnd",
    label: "turn/end",
    category: "6. 轮次收尾",
    description: "finally 块里写, 带 reason。取消时记录新的 AgentCancelCause 副本",
    source: "index.js:1029",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true, // 轮次收尾: 被拒绝 / 空输入 / 正常结束 / 中止 四条路都汇到这里
  },
  wakeAgain: {
    type: "wakeAgain",
    label: "还有待处理?",
    category: "6. 轮次收尾",
    description: "inbox.hasPending -> 重置 abort/step, 返回 true, kick 再开一轮",
    source: "index.js:1043",
    execIn: true,
    execOut: ["again", "idle"],
  },

  // ── 失败路径 ───────────────────────────────────────────────────────
  toolRecovery: {
    type: "toolRecovery",
    label: "补记未决工具结果",
    category: "7. 失败",
    description: "有 tool/call 但无结果 -> TOOL_OUTCOME_UNKNOWN; 无调用记录 -> TOOL_NOT_STARTED",
    source: "index.js:979",
    execIn: true,
    execOut: ["then"],
  },
  agentError: {
    type: "agentError",
    label: "agent/error",
    category: "7. 失败",
    description: "emit 之后再 throw。插件失败结束的是轮次, 不是循环",
    source: "index.js:879",
    execIn: true,
    execOut: ["then"],
    multiExecIn: true, // 轮次失败与补记失败都到这里关闭轮次
  },
  settleInterrupted: {
    type: "settleInterrupted",
    label: "结算中断的流",
    category: "7. 失败",
    description: "已送达用户的文本被保留: 带 interrupted:true 的锚点, 使下一次请求包含用户看到的内容",
    source: "index.js:1089",
    execIn: true,
    execOut: ["then"],
  },
};

/** 建 dsh 演示用的注册中心。 */
export function createSourceRegistry(): BlueprintRegistryImpl {
  const reg = createRegistry();

  // 自定义数据类型: 比内置那几个更能表达 agent loop 里的东西
  reg.type({ id: "context", label: "上下文", colorClass: "bg-primary", extends: "any" });
  reg.type({ id: "messages", label: "消息批", colorClass: "bg-primary", extends: "any" });
  reg.type({ id: "assembly", label: "组装结果", colorClass: "bg-primary", extends: "any" });
  reg.type({ id: "decision", label: "步骤决定", colorClass: "bg-amber-400", extends: "any" });
  reg.type({ id: "request", label: "请求", colorClass: "bg-emerald-400", extends: "any" });
  reg.type({ id: "attempt", label: "模型尝试", colorClass: "bg-emerald-400", extends: "any" });
  reg.type({ id: "stream", label: "流", colorClass: "bg-emerald-400", extends: "any" });
  reg.type({ id: "message", label: "助手消息", colorClass: "bg-emerald-400", extends: "any" });
  reg.type({ id: "toolCalls", label: "工具调用", colorClass: "bg-amber-400", extends: "any" });

  for (const def of Object.values(NODES)) reg.node(def);
  return reg;
}
