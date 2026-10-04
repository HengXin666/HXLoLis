"use client";

import { useMemo, useState, type JSX } from "react";
import {
  BlueprintEditor, buildFromAgent, countOverlaps, validateGraph,
  Badge, Button, cn, type BlueprintGraph,
} from "@hx/ui";
import { buildRootGraph, SUBGRAPHS } from "./dsh/build";

/**
 * dsh agent loop —— 架构层视图。
 *
 * 根图 = 10 个大步骤; 每个大步骤是一个**子图**, 双击进入看它"怎么做"。
 *
 * 与旧版的区别: 旧版 60 个节点对应源码的每个分支 (那是代码流程图),
 * 这一版只到"怎么做"这一层 —— 照着它能 1:1 复现核心功能, 但不必抄分支。
 */

const STAGE_KEYS = Object.keys(SUBGRAPHS);

export function DshArchitectureDemo(): JSX.Element {
  const built = useMemo(() => buildRootGraph(), []);
  const [graph, setGraph] = useState<BlueprintGraph>(built.graph);

  const v = useMemo(() => validateGraph(built.registry, graph), [built.registry, graph]);
  const errs = v.issues.filter((i) => i.level === "error");
  const overlaps = countOverlaps(built.registry, graph);
  const subCount = Object.keys(graph.subgraphs ?? {}).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={errs.length ? "destructive" : "success"}>
          {errs.length ? `${errs.length} 个错误` : "校验通过"}
        </Badge>
        <Badge variant={overlaps === 0 ? "success" : "destructive"}>重叠 {overlaps}</Badge>
        <Badge variant="secondary">{graph.nodes.length} 大步骤</Badge>
        <Badge variant="secondary">{subCount} 个子图</Badge>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => setGraph(built.graph)}
        >
          重置
        </Button>
      </div>

      <BlueprintEditor
        registry={built.registry}
        value={graph}
        onChange={setGraph}
        height={480}
        paletteWidth={170}
        showIssues={false}
      />

      {/* 大步骤一览: 点一下看这个阶段的说明, 也是"能不能照着复现"的清单 */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {graph.nodes.map((n) => {
          const def = built.registry.nodeTypes.get(n.type);
          const sgId = n.subgraph;
          const sg = sgId ? (graph.subgraphs ?? {})[sgId] : undefined;
          const steps = (sg as { nodes?: readonly unknown[] } | undefined)?.nodes?.length ?? 0;
          return (
            <div
              key={n.id}
              className="rounded-lg border border-border bg-card/40 px-2.5 py-2"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[12px] font-medium text-foreground">
                  {n.title ?? def?.label ?? n.type}
                </span>
                {steps > 0 && (
                  <span className="text-[10px] text-muted-foreground">{steps} 步</span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {def?.description}
              </p>
            </div>
          );
        })}
      </div>

      <UsedFeatures />
    </div>
  );
}

/** 这张图用了蓝图库的哪些能力 —— 可折叠的说明。 */
function UsedFeatures(): JSX.Element {
  const [open, setOpen] = useState(false);
  const items: Array<[string, string]> = [
    ["子图 (折叠/进入/展开)", "10 个大步骤各自是一个子图, 双击进入。分层表达粒度"],
    ["区间注释", "标出「进 / 出 / 循环与压缩」三个阶段"],
    ["自定义数据类型", "每类产物一种颜色: 输入 / 历史 / 提示词 / 请求 / 响应 / 工具结果"],
    ["buildFromAgent", "不写任何坐标, 由分层布局自动摆; 带零重叠与宽高比自检"],
    ["多入执行口", "回路汇合点: 「继续本轮」「开新一轮」「压缩后重来」都回到同一节点"],
    ["连线简化写法", "只写节点 key, 端口由两端能力推断 (不写 out/in)"],
    ["连接合法性判定", "执行流与数据流不互连; 类型不相容的边会被拒"],
    ["撤销 / 重做", "⌘Z; 拖动合并成一步"],
  ];

  return (
    <div className="rounded-lg border border-border bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] font-medium text-foreground"
      >
        <span className={cn("inline-block transition-transform", open && "rotate-90")}>›</span>
        这张图用了蓝图库的哪些能力
        <span className="ml-auto text-[11px] text-muted-foreground">{items.length} 项</span>
      </button>
      {open && (
        <ul className="space-y-1 px-3 pb-2.5">
          {items.map(([name, why]) => (
            <li key={name} className="text-[11px] leading-snug">
              <span className="text-foreground">{name}</span>
              <span className="text-muted-foreground"> — {why}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
