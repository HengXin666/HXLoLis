"use client";

import { useMemo, useState, type JSX } from "react";
import {
  BlueprintCanvas, buildFromAgent, countOverlaps,
  createBlueprintTools, toolManifest, dispatchTool,
  validateGraph, Badge, Button, Card, CardContent, CardHeader, CardTitle,
  cn, type BlueprintGraph,
} from "@hx/ui";
import { createDshRegistry } from "@hx/blueprint-demo";

/**
 * 演示: Agent 用**不给坐标**的描述建图, 出来的是人类能看的图。
 *
 * 三栏对照是为了让"自动化产出也好看"这件事可被检验:
 *   左 = Agent 写的输入 (没有坐标)
 *   中 = 出来的图
 *   右 = 工具返回的文本 (Agent 看到的)
 */

const AGENT_INPUT = `{
  "nodes": [
    { "key": "start",  "type": "agentCreated" },
    { "key": "kick",   "type": "kick" },
    { "key": "turn",   "type": "turnStart" },
    { "key": "claim",  "type": "claim" },
    { "key": "pre",    "type": "preStep" },
    { "key": "step",   "type": "stepStart" },
    { "key": "freeze", "type": "freezeRequest" },
    { "key": "stream", "type": "stream" },
    { "key": "finish", "type": "checkFinish" },
    { "key": "asst",   "type": "appendAssistant" }
  ],
  "edges": [
    { "from": "start",  "to": "kick" },
    { "from": "kick",   "to": "turn" },
    { "from": "turn",   "to": "claim" },
    { "from": "claim",  "to": "pre" },
    { "from": "pre",    "to": "step" },
    { "from": "step",   "to": "freeze" },
    { "from": "freeze", "to": "stream" },
    { "from": "stream", "to": "finish" },
    { "from": "finish", "to": "asst" }
  ]
}`;

const PARSED = JSON.parse(AGENT_INPUT) as {
  nodes: Array<{ key: string; type: string }>;
  edges: Array<{ from: string; to: string }>;
};

export function AgentApiDemo(): JSX.Element {
  const reg = useMemo(() => createDshRegistry(), []);
  const [graph, setGraph] = useState<BlueprintGraph>(() =>
    buildFromAgent(reg, PARSED).graph
  );
  const [text, setText] = useState<string>("");

  const tools = useMemo(
    () =>
      createBlueprintTools({
        registry: reg,
        getGraph: () => graph,
        setGraph: setGraph,
      }),
    [reg, graph]
  );

  const overlaps = countOverlaps(reg, graph);
  const v = validateGraph(reg, graph);
  const errs = v.issues.filter((i) => i.level === "error");

  const runTool = async (name: string) => {
    const r = await dispatchTool(tools, name);
    setText(`$ ${name}\n\n${r.text}`);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="space-y-2">
        <div className="text-[12px] font-medium text-foreground">Agent 写的输入</div>
        <div className="text-[11px] text-muted-foreground">
          注意:<strong>一个坐标都没有</strong>。连线也只写了节点 key,
          端口由系统按两端的能力推断。
        </div>
        <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-[10.5px] leading-relaxed">
          {AGENT_INPUT}
        </pre>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={overlaps === 0 ? "success" : "destructive"}>
            重叠 {overlaps} 处
          </Badge>
          <Badge variant={errs.length ? "warning" : "success"}>
            {errs.length ? `${errs.length} 个校验错误` : "校验通过"}
          </Badge>
          <Badge variant="secondary">{graph.nodes.length} 节点</Badge>
        </div>

        <div className="text-[11px] leading-relaxed text-muted-foreground">
          <strong>重叠必须为 0。</strong>叠在一起的图对人类等于没有 ——
          所以布局不是"能跑就行", 而是带自检: 有重叠就加大间距重排, 最多重试三次。
        </div>
      </div>

      <div className="space-y-2">
        <BlueprintCanvas registry={reg} graph={graph} height={340} />

        <div className="flex flex-wrap gap-1.5">
          {toolManifest(tools).map((t) => (
            <Button
              key={(t as { name: string }).name}
              size="xs"
              variant="outline"
              onClick={() => void runTool((t as { name: string }).name)}
              title={(t as { description: string }).description}
            >
              {(t as { name: string }).name}
            </Button>
          ))}
        </div>

        {text && (
          <pre className={cn(
            "max-h-64 overflow-auto rounded-lg border border-border bg-background px-2.5 py-2 font-mono text-[10.5px] leading-relaxed"
          )}>
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
