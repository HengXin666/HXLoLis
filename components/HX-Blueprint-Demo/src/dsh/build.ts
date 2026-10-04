import { buildFromAgent, nodeShape, type BlueprintGraph } from "@hx/ui";
import { createDshRegistry, ROOT_INPUT, SUBGRAPHS, type NodeSpec } from "./architecture";

/**
 * 构建 dsh agent loop 的架构图: 根图 + 可进入的子图。
 *
 * ## 为什么用 buildFromAgent 而不是手写坐标
 *
 * 手写坐标的图一定难看 (上一版实测宽高比 0.26, 一条竖条)。用 Agent API
 * 则: 不给任何坐标, 由分层布局自动摆, 并且带质量自检 (零重叠 + 宽高比
 * 落在可看区间)。这同时也是在演示"Agent 产出的图也能看"。
 *
 * ## 结构
 *
 *   根图: 10 个大步骤 (双击任何一个进入它的子图)
 *   子图: 每个大步骤 2~5 个子步骤, 存在 graph.subgraphs 里
 *
 * 复用了蓝图库的: 子图折叠/进入、区间注释、自定义类型配色、多入执行口、
 * Agent 构建 API、自动布局。
 */

export interface BuiltDsh {
  readonly registry: ReturnType<typeof createDshRegistry>;
  readonly graph: BlueprintGraph;
}

/** 构建根图。 */
export function buildRootGraph(): BuiltDsh {
  const registry = createDshRegistry();
  const built = buildFromAgent(registry, ROOT_INPUT as never);

  // 给每个大步骤挂上它的子图
  const subgraphs: Record<string, unknown> = {};
  const nodes = built.graph.nodes.map((n) => {
    const sg = SUBGRAPHS[n.type];
    if (!sg) return n;
    const inner = buildFromAgent(registry, sg.input as never);
    const id = `sg:${n.type}`;
    /**
     * 子图必须**显式声明**对外端口。
     *
     * 子图节点的外形完全由 SubGraphDef 决定 —— 不声明就等于"没有任何端口",
     * 所有连到它的边都会变成 unknown-port。库有从内部隧道推导的容错,
     * 但显式声明才可靠 (尤其这个子图还可能再被折叠)。
     */
    /**
     * 子图的端口 id 必须**与这个大步骤本身**完全一致。
     *
     * 踩过的坑 (实测: 挂完子图后所有边报 unknown-port, 整图 29 个错误):
     * 节点一旦带 subgraph, 它的外形就**完全**由 SubGraphDef 决定 ——
     * 原节点上叫 history / assembly / state 的那些端口立刻消失, 而根图上的
     * 边还按原端口 id 连着, 于是全部悬空。
     *
     * 所以这里按 stage 的 spec 声明同名同类型的端口, 让"折叠前后"外形一致。
     */
    const shape = nodeShape(registry, built.graph, n.id);
    subgraphs[id] = {
      id,
      label: sg.label,
      nodes: inner.graph.nodes,
      edges: inner.graph.edges,
      execIn: true,
      execOut: ["then"],
      multiExecIn: true,
      inputs: shape.inputs.map((p) => ({ ...p })),
      outputs: shape.outputs.map((p) => ({ ...p })),
    };
    return { ...n, subgraph: id, title: sg.label };
  });

  return {
    registry,
    graph: { ...built.graph, nodes, subgraphs: subgraphs as never },
  };
}

export { SUBGRAPHS };
