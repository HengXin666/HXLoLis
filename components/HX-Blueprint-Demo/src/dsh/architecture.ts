import { createRegistry, type BlueprintRegistryImpl } from "@hx/ui";
import type { BlueprintGraph } from "@hx/ui";
import { registerTunnels } from "@hx/ui";

/**
 * dsh agent loop —— 架构层。
 *
 * ## 粒度约定 (这是本次重写的要点)
 *
 * 上一版把源码里每个 `if` 都画成了节点 (60 个), 结果是**代码流程图**,
 * 不是架构图 —— 太细, 看不出结构, 也没法照着复现。
 *
 * 这一版分两层:
 *
 *   根图 (10 个节点) = **大步骤**
 *     一次交互从头到尾经过哪些阶段。每个节点是一个子图, 双击进入。
 *
 *   子图 (每个 3~6 个节点) = **这一步怎么做**
 *     比架构深一层, 但不到代码。不画"判断什么", 画"做了什么 / 产出什么"。
 *
 * 判据: 照着这张图能 1:1 复现 dsh 的核心功能, 但不必抄它的每个分支。
 *
 * ## 复用了蓝图库的哪些能力
 *   - 子图 (折叠/进入/展开)      —— 分层表达"大步骤 vs 细节"
 *   - 区间注释                  —— 标出三个阶段
 *   - 自定义数据类型             —— 每类产物一种颜色
 *   - buildFromAgent            —— 不用写坐标, 布局自动分层且零重叠
 *   - 多入执行口                 —— 回路汇合点 (继续下一轮 / 再来一步)
 *   - 连线简化写法               —— 只写节点 key, 端口由两端能力推断
 */

// ── 数据类型: 每类"产物"一种颜色 ──────────────────────────────────────
const TYPES = {
  input: { label: "用户输入", colorClass: "bg-primary" },
  history: { label: "会话历史", colorClass: "bg-primary" },
  assembly: { label: "提示词", colorClass: "bg-primary" },
  request: { label: "请求", colorClass: "bg-emerald-400" },
  response: { label: "模型响应", colorClass: "bg-emerald-400" },
  tools: { label: "工具结果", colorClass: "bg-amber-400" },
  state: { label: "状态", colorClass: "bg-muted-foreground" },
} as const;

// ── 根图: 10 个大步骤 ─────────────────────────────────────────────────
const ROOT_INPUT = {
  nodes: [
    { key: "input", type: "stage.input" },
    { key: "history", type: "stage.history" },
    { key: "assemble", type: "stage.assemble" },
    { key: "request", type: "stage.request" },
    { key: "stream", type: "stage.stream" },
    { key: "tools", type: "stage.tools" },
    { key: "compact", type: "stage.compact" },
    { key: "loop", type: "stage.loop" },
    { key: "settle", type: "stage.settle" },
    { key: "output", type: "stage.output" },
  ],
  edges: [
    { from: "input", to: "history" },
    { from: "history", to: "assemble" },
    { from: "assemble", to: "request" },
    { from: "request", to: "stream" },
    { from: "stream", to: "tools" },
    { from: "tools", to: "loop" },
    { from: "loop", to: "compact" },      // 需要压缩时
    { from: "compact", to: "assemble" },  // 压缩后重回组装
    { from: "loop", to: "settle" },       // 不需要压缩, 收尾
    { from: "settle", to: "output" },
    /**
     * 有工具结果 -> 下一步模型请求。
     *
     * 这条是**控制流**不是数据流: 它表达"再调一次模型", 不传递某个具体产物。
     * 所以显式走执行端口 —— 只写 key 的话推断会挑数据口 (loop 出 state /
     * request 入 assembly), 类型不相容, 边上就会挂一条类型错误。
     */
    { from: "loop.then", to: "request.exec-in" },
  ],
  comments: [
    { title: "进: 输入到请求", body: "拿到输入、拼出完整历史、渲染提示词、绑定路由", nodes: ["input", "history", "assemble", "request"] },
    { title: "出: 响应到结果", body: "流式接收、派发工具、收尾落盘", nodes: ["stream", "tools", "settle", "output"] },
    { title: "循环与压缩", body: "决定是继续、重来一轮, 还是先压缩再继续", nodes: ["loop", "compact"] },
  ],
};

// ── 子图: 每个大步骤"怎么做" ──────────────────────────────────────────

/** 1. 输入: 外部消息怎么进来。 */
const SG_INPUT = {
  nodes: [
    { key: "inbox", type: "step.inbox" },
    { key: "claim", type: "step.claim" },
    { key: "admit", type: "step.admit" },
  ],
  edges: [
    { from: "inbox", to: "claim" },
    { from: "claim", to: "admit" },
  ],
};

/** 2. 历史: 持久日志怎么派生成本次请求能用的消息序列。 */
const SG_HISTORY = {
  nodes: [
    { key: "log", type: "step.log" },
    { key: "derive", type: "step.derive" },
    { key: "project", type: "step.project" },
  ],
  edges: [
    { from: "log", to: "derive" },
    { from: "derive", to: "project" },
  ],
};

/** 3. 组装: 权威 waterfall 怎么定出最终提示词。 */
const SG_ASSEMBLE = {
  nodes: [
    { key: "persona", type: "step.persona" },
    { key: "sections", type: "step.sections" },
    { key: "tools", type: "step.toolSchema" },
    { key: "render", type: "step.render" },
  ],
  edges: [
    { from: "persona", to: "sections" },
    { from: "sections", to: "tools" },
    { from: "tools", to: "render" },
  ],
};

/** 4. 请求: 路由与适配器。 */
const SG_REQUEST = {
  nodes: [
    { key: "route", type: "step.route" },
    { key: "adapter", type: "step.adapter" },
    { key: "header", type: "step.header" },
    { key: "freeze", type: "step.freeze" },
  ],
  edges: [
    { from: "route", to: "adapter" },
    { from: "adapter", to: "header" },
    { from: "header", to: "freeze" },
  ],
};

/** 5. 流式: 一次模型调用怎么落地成持久消息。 */
const SG_STREAM = {
  nodes: [
    { key: "call", type: "step.call" },
    { key: "chunks", type: "step.chunks" },
    { key: "settle", type: "step.settleMsg" },
  ],
  edges: [
    { from: "call", to: "chunks" },
    { from: "chunks", to: "settle" },
  ],
};

/** 6. 工具: 调度策略。 */
const SG_TOOLS = {
  nodes: [
    { key: "parse", type: "step.parse" },
    { key: "mode", type: "step.mode" },
    { key: "exclusive", type: "step.exclusive" },
    { key: "parallel", type: "step.parallel" },
    { key: "results", type: "step.results" },
  ],
  edges: [
    { from: "parse", to: "mode" },
    { from: "mode", to: "exclusive" },
    { from: "mode", to: "parallel" },
    { from: "exclusive", to: "results" },
    { from: "parallel", to: "results" },
  ],
};

/** 7. 压缩: 什么时候压、压掉什么。 */
const SG_COMPACT = {
  nodes: [
    { key: "budget", type: "step.budget" },
    { key: "strategy", type: "step.strategy" },
    { key: "offload", type: "step.offload" },
    { key: "rewrite", type: "step.rewrite" },
  ],
  edges: [
    { from: "budget", to: "strategy" },
    { from: "strategy", to: "offload" },
    { from: "strategy", to: "rewrite" },
  ],
};

/** 8. 循环: 这一步之后去哪。 */
const SG_LOOP = {
  nodes: [
    { key: "decide", type: "step.decide" },
    { key: "nextStep", type: "step.nextStep" },
    { key: "nextTurn", type: "step.nextTurn" },
    { key: "stop", type: "step.stop" },
  ],
  edges: [
    { from: "decide", to: "nextStep" },
    { from: "decide", to: "nextTurn" },
    { from: "decide", to: "stop" },
  ],
};

/** 9. 收尾: 中断/失败怎么保证历史是完整的。 */
const SG_SETTLE = {
  nodes: [
    { key: "cancel", type: "step.cancel" },
    { key: "recover", type: "step.recover" },
    { key: "closeTurn", type: "step.closeTurn" },
  ],
  edges: [
    { from: "cancel", to: "recover" },
    { from: "recover", to: "closeTurn" },
  ],
};

/** 10. 输出: 交付与持久化。 */
const SG_OUTPUT = {
  nodes: [
    { key: "surface", type: "step.surface" },
    { key: "persist", type: "step.persist" },
  ],
  edges: [{ from: "surface", to: "persist" }],
};

export const SUBGRAPHS: Record<string, { readonly label: string; readonly input: unknown }> = {
  "stage.input": { label: "1 输入准入", input: SG_INPUT },
  "stage.history": { label: "2 历史派生", input: SG_HISTORY },
  "stage.assemble": { label: "3 提示词组装", input: SG_ASSEMBLE },
  "stage.request": { label: "4 请求准备", input: SG_REQUEST },
  "stage.stream": { label: "5 流式调用", input: SG_STREAM },
  "stage.tools": { label: "6 工具调度", input: SG_TOOLS },
  "stage.compact": { label: "7 上下文压缩", input: SG_COMPACT },
  "stage.loop": { label: "8 循环决策", input: SG_LOOP },
  "stage.settle": { label: "9 异常收尾", input: SG_SETTLE },
  "stage.output": { label: "10 输出与持久化", input: SG_OUTPUT },
};

// ── 节点定义: 大步骤 + 子步骤 ──────────────────────────────────────────

export interface NodeSpec {
  readonly label: string;
  readonly category: string;
  readonly desc: string;
  readonly in?: string;
  readonly out?: string;
}

const STAGES: Record<string, NodeSpec> = {
  "stage.input": { label: "输入准入", category: "大步骤", desc: "外部消息进收件箱, 轮次边界原子领取, 决定是否接纳", in: "input", out: "history" },
  "stage.history": { label: "历史派生", category: "大步骤", desc: "从持久日志派生本次请求要发的消息序列", in: "history", out: "history" },
  "stage.assemble": { label: "提示词组装", category: "大步骤", desc: "权威 waterfall 定出系统提示词与可见工具", in: "history", out: "assembly" },
  "stage.request": { label: "请求准备", category: "大步骤", desc: "定路由、绑适配器、记录请求头、冻结请求", in: "assembly", out: "request" },
  "stage.stream": { label: "流式调用", category: "大步骤", desc: "发起流式请求, 逐块接收, 结算成一条持久助手消息", in: "request", out: "response" },
  "stage.tools": { label: "工具调度", category: "大步骤", desc: "解析调用、按策略派发、按模型顺序提交结果", in: "response", out: "tools" },
  "stage.compact": { label: "上下文压缩", category: "大步骤", desc: "超预算时按策略压缩历史, 压缩后重新组装", in: "state", out: "history" },
  "stage.loop": { label: "循环决策", category: "大步骤", desc: "决定继续本轮的下一步、开新一轮, 还是停下", in: "tools", out: "state" },
  "stage.settle": { label: "异常收尾", category: "大步骤", desc: "取消或失败时补齐未决工具结果, 保证历史成对完整", in: "state", out: "state" },
  "stage.output": { label: "输出与持久化", category: "大步骤", desc: "把结果呈现给用户并写入持久会话", in: "state", out: "response" },
};

const STEPS: Record<string, NodeSpec> = {
  // 1 输入
  "step.inbox": { label: "收件箱", category: "1 输入", desc: "外部消息/引导/工具上下文入队, 每次变更发一条规范化 splice 事件", out: "input" },
  "step.claim": { label: "原子领取", category: "1 输入", desc: "轮次边界领 next-step 输入 + 一条排队提示词; 步骤之间只领 next-step", in: "input", out: "input" },
  "step.admit": { label: "准入决定", category: "1 输入", desc: "pre-step 拦截: 决定进步骤 / 改写消息 / 拒绝。被拒绝则不打开步骤", in: "input", out: "input" },

  // 2 历史
  "step.log": { label: "持久日志", category: "2 历史", desc: "只写日志: 事件追加、flush 屏障、会话退役都经写句柄", out: "history" },
  "step.derive": { label: "派生消息", category: "2 历史", desc: "把日志投影成模型可见的消息序列; 仅写日志的事件被排除", in: "history", out: "history" },
  "step.project": { label: "运行时上下文", category: "2 历史", desc: "渲染上下文分节(时间/cwd 等)并投影成一条注入消息", in: "history", out: "history" },

  // 3 组装
  "step.persona": { label: "人格与指令", category: "3 组装", desc: "部署人格 + 技能/插件贡献的指令段", out: "assembly" },
  "step.sections": { label: "上下文分节", category: "3 组装", desc: "拼装上下文段落; 每一节可独立增删而不影响其它", in: "assembly", out: "assembly" },
  "step.toolSchema": { label: "工具 schema", category: "3 组装", desc: "收集本次可见工具的声明, 变化会记进请求头", in: "assembly", out: "assembly" },
  "step.render": { label: "渲染提示词", category: "3 组装", desc: "产出最终文本; 空文本意味着清除已有提示词节点", in: "assembly", out: "assembly" },

  // 4 请求
  "step.route": { label: "定路由", category: "4 请求", desc: "agent/request waterfall 定 provider/model/推理强度", out: "request" },
  "step.adapter": { label: "绑适配器", category: "4 请求", desc: "prepareCall 校验字段并解析默认值; 没有适配器则报 NO_ADAPTER", in: "request", out: "request" },
  "step.header": { label: "记请求头", category: "4 请求", desc: "首次/序列变化/路由变化时写完整头; 否则继承上一个(保 KV 前缀)", in: "request", out: "request" },
  "step.freeze": { label: "冻结请求", category: "4 请求", desc: "深冻结头/消息/请求, 保留取消信号可变; 冻结证明在同 agent 内复用", in: "request", out: "request" },

  // 5 流式
  "step.call": { label: "发起请求", category: "5 流式", desc: "用已绑定的 preparedCall 发起流式请求", in: "request", out: "response" },
  "step.chunks": { label: "逐块接收", category: "5 流式", desc: "每块先查取消; 取消时保留已送达用户的文本", in: "response", out: "response" },
  "step.settleMsg": { label: "结算消息", category: "5 流式", desc: "恰好一个终态; 成功追加 assistant/message, 中断则带 interrupted 标记", in: "response", out: "response" },

  // 6 工具
  "step.parse": { label: "解析调用", category: "6 工具", desc: "解析参数; 非法 JSON 保留为文本而不是抛错", in: "response", out: "tools" },
  "step.mode": { label: "判定模式", category: "6 工具", desc: "独占调用构成屏障; 并行安全调用进入有界池", in: "tools", out: "tools" },
  "step.exclusive": { label: "独占屏障", category: "6 工具", desc: "单独运行, 是排序屏障: 前后都不能越过它", in: "tools", out: "tools" },
  "step.parallel": { label: "有界并行池", category: "6 工具", desc: "最多重叠 maxParallelToolCalls 个, 结果按模型顺序提交", in: "tools", out: "tools" },
  "step.results": { label: "提交结果", category: "6 工具", desc: "结果与结果上下文按模型顺序入日志, 成为下一步的派生依据", in: "tools", out: "tools" },

  // 7 压缩
  "step.budget": { label: "预算检查", category: "7 压缩", desc: "按 token 预算判断是否需要压缩", in: "state", out: "state" },
  "step.strategy": { label: "选策略", category: "7 压缩", desc: "可选: 折叠旧历史 / 卸载图片 / 裁剪大工具结果", in: "state", out: "state" },
  "step.offload": { label: "外卸大块", category: "7 压缩", desc: "把图片/超长结果移出消息体, 只留引用", in: "state", out: "history" },
  "step.rewrite": { label: "重写历史", category: "7 压缩", desc: "生成摘要替换被遮蔽的旧节点; 压缩后需重新组装提示词", in: "state", out: "history" },

  // 8 循环
  "step.decide": { label: "读结束原因", category: "8 循环", desc: "步骤给出 completed / max-tokens / blocked / aborted / error", in: "tools", out: "state" },
  "step.nextStep": { label: "继续本轮", category: "8 循环", desc: "本轮内再开一步: 领 next-step 输入, 重跑组装与请求", in: "state", out: "state" },
  "step.nextTurn": { label: "开新一轮", category: "8 循环", desc: "还有待处理输入则重置步骤计数, 重开一轮", in: "state", out: "state" },
  "step.stop": { label: "停下", category: "8 循环", desc: "轮次停稳; 取消策略挂在 turn-stopping 扩展点上", in: "state", out: "state" },

  // 9 收尾
  "step.cancel": { label: "取消传播", category: "9 收尾", desc: "协作式取消: 中止当前活动, 未设 keepInbox 则清空待处理", in: "state", out: "state" },
  "step.recover": { label: "补未决结果", category: "9 收尾", desc: "无结果的调用补 TOOL_OUTCOME_UNKNOWN / TOOL_NOT_STARTED, 让历史成对", in: "state", out: "tools" },
  "step.closeTurn": { label: "写 turn/end", category: "9 收尾", desc: "总在 finally 里写, 带结束原因; 让下一次请求看到完整历史", in: "state", out: "state" },

  // 10 输出
  "step.surface": { label: "呈现", category: "10 输出", desc: "文本/工具/进度等分发给界面; 已送达的部分在取消后仍保留", in: "state", out: "response" },
  "step.persist": { label: "持久化", category: "10 输出", desc: "按会话写入持久后端; 没有后端时只存在内存", in: "response", out: "response" },
};

/** 建注册表: 大步骤是可展开的节点, 子步骤是具体内容。 */
export function createDshRegistry(): BlueprintRegistryImpl {
  const reg = createRegistry();
  registerTunnels(reg);

  for (const [id, spec] of Object.entries(STAGES)) {
    reg.node({
      type: id,
      label: spec.label,
      category: spec.category,
      description: spec.desc,
      execIn: true,
      execOut: ["then"],
      // 回路汇合点: 多条路径都回到这里
      multiExecIn: true,
      /**
       * 输入口: **multi + 可选**。
       *
       * 两条原因, 缺一个图就会红:
       *
       *   1. multi —— 大步骤是回路汇合点。例如「提示词组装」同时接收
       *      "历史派生" 和 "压缩后重来" 两条边。独占语义下第二条会顶掉
       *      第一条, 图上就少一条关键路径 (实测报 input-occupied)。
       *
       *   2. default (即可选) —— 端口表达的是"这一步跟什么有关", 不是
       *      "必填参数"。必填会让第一个节点 (没有入边) 立刻报 missing-input
       *      (实测: 子图内部 10 条这类报错)。
       */
      inputs: spec.in
        ? [{ id: spec.in, label: "入", type: spec.in, multi: true, default: null }]
        : [],
      outputs: spec.out ? [{ id: spec.out, label: "出", type: spec.out }] : [],
    });
  }

  for (const [id, spec] of Object.entries(STEPS)) {
    reg.node({
      type: id,
      label: spec.label,
      category: spec.category,
      description: spec.desc,
      execIn: true,
      execOut: ["then"],
      multiExecIn: true,
      // 与 STAGES 同理: 回路汇合点 + 关联而非必填
      inputs: spec.in
        ? [{ id: spec.in, label: "入", type: spec.in, multi: true, default: null }]
        : [],
      outputs: spec.out ? [{ id: spec.out, label: "出", type: spec.out }] : [],
    });
  }
  return reg;
}

export const STAGE_LIST = Object.keys(STAGES);
export { ROOT_INPUT };
