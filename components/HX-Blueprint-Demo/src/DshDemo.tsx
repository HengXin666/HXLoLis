"use client";

import { useMemo, useState, type JSX } from "react";
import {
  BlueprintEditor, BlueprintCanvas,
  createDemoRegistry, demoGraph,
} from "@hx/ui";

/**
 * 演示页的入口。
 *
 * 它只做一件事: 证明蓝图库能被**外部包**消费 —— 这个包不在 HX-UI 里,
 * 通过 peerDependencies 声明依赖, 只用导出的公共 API。
 * 如果这里能跑, 说明拓展点开对了。
 */
import type { BlueprintGraph } from "@hx/ui";
import { useBlueprint, useSelection, validateGraph, canConnect } from "@hx/ui";
import { createDshRegistry, NODES } from "./dsh/nodes";
import { dshAgentLoopGraph, COLLAPSIBLE_GROUPS } from "./dsh/graph";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from "@hx/ui";

export function DshDemo(): JSX.Element {
  const registry = useMemo(() => createDshRegistry(), []);
  const api = useBlueprint({ registry, defaultValue: dshAgentLoopGraph });
  const sel = useSelection();
  const [showAdd, setShowAdd] = useState(false);

  const v = api.validation;
  const errors = v.issues.filter((i) => i.level === "error");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={errors.length ? "destructive" : "success"}>
          {errors.length ? `${errors.length} 个错误` : "校验通过"}
        </Badge>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {Object.keys(NODES).length} 种节点 / {api.graph.nodes.length} 个实例 / {api.graph.edges.length} 条线
        </span>

        <span className="mx-1 h-3 w-px bg-border" />

        {/* 折叠: 一键把源码里三个自然段落收成三个节点 */}
        {Object.entries(COLLAPSIBLE_GROUPS).map(([label, ids]) => (
          <Button
            key={label}
            size="xs"
            variant="outline"
            onClick={() => {
              const id = api.collapse([...ids], label);
              if (id) sel.only(id);
            }}
            title={`把「${label}」折成一个节点, 双击可进入`}
          >
            折叠「{label}」
          </Button>
        ))}

        <Button size="xs" variant="ghost" onClick={() => { api.replace(dshAgentLoopGraph); sel.clear(); }}>
          重置
        </Button>

        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setShowAdd((s) => !s)}>
          {showAdd ? "收起" : "怎么加一个节点?"}
        </Button>
      </div>

      {showAdd && <HowToExtend registry={registry} />}

      <BlueprintEditor
        registry={registry}
        value={api.graph}
        onChange={(g) => api.replace(g)}
        height={620}
        showIssues={false}
      />

      <div className="text-[11px] leading-relaxed text-muted-foreground">
        白线是执行流, 彩线是数据。每条边都对应源码里一个真实的"下一步" ——
        节点定义上带 <code className="rounded bg-muted/60 px-1">source</code> 字段标了行号, 可以回去核对。
        双击子图节点进入, 面包屑退回。
      </div>
    </div>
  );
}

/** 现场演示"加一个节点 = 加一行"。 */
function HowToExtend({ registry }: { readonly registry: ReturnType<typeof createDshRegistry> }): JSX.Element {
  const [added, setAdded] = useState(false);
  const [verdict, setVerdict] = useState<string>("");

  const addNode = () => {
    // 这就是全部: 一行定义, 蓝图层零改动
    registry.node({
      type: "myLogger",
      label: "我的日志节点",
      category: "自定义",
      description: "演示: 加一个节点不需要改蓝图库",
      execIn: true,
      execOut: ["then"],
      inputs: [{ id: "text", label: "文本", type: "string" }],
      params: [{ id: "level", label: "级别", kind: "select", default: "info", options: [
        { value: "info", label: "信息" }, { value: "warn", label: "警告" },
      ] }],
    });
    setAdded(true);

    // 加完立刻验证类型判据对它也生效 —— 不需要任何额外接线
    const g: BlueprintGraph = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, params: { v: "hi" } },
        { id: "b", type: "myLogger", x: 200, y: 0 },
      ],
      edges: [],
    };
    const okConn = canConnect(registry, g, { node: "a", port: "value" }, { node: "b", port: "text" });
    const badConn = canConnect(registry, g, { node: "b", port: "text" }, { node: "a", port: "value" });
    setVerdict(
      `string → string 可连: ${okConn.ok ? "是" : "否"} / ` +
      `方向反了被拒: ${"reason" in badConn ? badConn.reason : "没有"}`
    );
  };

  return (
    <Card variant="muted" className="p-3">
      <CardHeader className="px-0 pt-0">
        <CardTitle>加一个节点要做几件事?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-0 pb-0">
        <pre className="overflow-x-auto rounded border border-border bg-background px-2.5 py-2 font-mono text-[11px] leading-relaxed">
{`registry.node({
  type: "myLogger", label: "我的日志节点", category: "自定义",
  execIn: true, execOut: ["then"],
  inputs: [{ id: "text", label: "文本", type: "string" }],
  params: [{ id: "level", label: "级别", kind: "select", default: "info",
             options: [{ value: "info", label: "信息" }] }],
});`}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline" onClick={addNode} disabled={added}>
            {added ? "已注册" : "注册它, 并立刻验证类型判据"}
          </Button>
          {verdict && (
            <span className={cn("text-[11px]", verdict.includes("否") ? "text-destructive" : "text-emerald-400")}>
              {verdict}
            </span>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          就这一段。<strong>蓝图层零改动</strong> —— 校验、类型相容、面板、求值全都对新节点立即生效。
          加一种数据类型同理: <code className="rounded bg-muted/60 px-1">registry.type(&#123; id: "image", extends: "object" &#125;)</code>,
          之后 image 就能连进 object 的输入口(协变)。
        </p>
      </CardContent>
    </Card>
  );
}

/** 另一个演示: 同一套库跑完全不同领域的图。 */
export function OtherDomainDemo(): JSX.Element {
  const reg = useMemo(() => createDemoRegistry(), []);
  const api = useBlueprint({ registry: reg, defaultValue: demoGraph });
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-muted-foreground">
        同一套库, 换一张注册表就是另一个领域。这里跑的是库自带的演示节点(数值 / 比较 / 分支 / 打印)。
      </div>
      <BlueprintCanvas
        registry={reg}
        graph={api.graph}
        height={260}
        onConnect={(f, t) => api.connect(f, t)}
        onNodesMove={(moves) => {
          const byId = new Map(moves.map((m) => [m.id, m]));
          api.replace({ ...api.graph, nodes: api.graph.nodes.map((n) => {
            const m = byId.get(n.id);
            return m ? { ...n, x: m.x, y: m.y } : n;
          }) });
        }}
      />
      <div className="text-[11px] text-muted-foreground">
        校验: {validateGraph(reg, api.graph).ok ? "通过" : "有错"}
      </div>
    </div>
  );
}
