/**
 * @hx/blueprint-demo —— 蓝图库的使用方演示。
 *
 * 刻意放在 HX-UI **外面**: 它只通过 peerDependencies 依赖 @hx/ui,
 * 只能用导出的公共 API。这本身就是对"拓展点开得对不对"的检验 ——
 * 放在库里会有意无意地摸到内部, 而那不能证明什么。
 */

export { createDshRegistry, NODES, type SourcedNodeTypeDef } from "./dsh/nodes";
export { dshAgentLoopGraph, COLLAPSIBLE_GROUPS } from "./dsh/graph";
export { DshDemo, OtherDomainDemo } from "./DshDemo";
