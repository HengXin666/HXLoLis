"use client";

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  BlueprintEditor, BlueprintCanvas,
  createDemoRegistry, demoGraph,
} from "@hx/ui";

/**
 * 演示页的入口。
 *
 * 它只做一件事: 证明蓝图库能被**外部包**消费  这个包不在 HX-UI 里,
 * 通过 peerDependencies 声明依赖, 只用导出的公共 API。
 * 如果这里能跑, 说明拓展点开对了。
 */
import type { BlueprintGraph } from "@hx/ui";
import { useBlueprint, useSelection, validateGraph, canConnect, SyncChannel, graphToHash, graphMatchesRegistry } from "@hx/ui";
import { createSourceRegistry, NODES } from "./dsh/nodes";
import { dshAgentLoopGraph, COLLAPSIBLE_GROUPS } from "./dsh/graph";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from "@hx/ui";

export function DshDemo(): JSX.Element {
  const registry = useMemo(() => createSourceRegistry(), []);
  const api = useBlueprint({ registry, defaultValue: dshAgentLoopGraph });
  const sel = useSelection();
  const [showAdd, setShowAdd] = useState(false);

  const v = api.validation;
  const errors = v.issues.filter((i) => i.level === "error");

  /**
   * 与独立页面同步。
   *
   * 频道名带 source 标识  dsh 那张图和 demo 那张图不该互相覆盖。
   * 用 ref 读最新图: onRequest 是构造时注册的, 闭包会读到旧值。
   */
  const graphRef = useRef(api.graph);
  graphRef.current = api.graph;
  /**
   * `api` 的身份**每次渲染都变** (useBlueprint 每次都返回新对象), 所以
   * 它绝不能进下面那个 effect 的依赖  否则每次渲染都拆掉旧 SyncChannel、
   * 建一个新 BroadcastChannel, 于是:
   *
   *   1. 新建通道要发一条 `request` 问状态, 对端回 `graph`;
   *   2. 对端的 `onRemote` 改图 → 它重渲染 → 它的 effect 重跑 → 又新建通道 → 又 request …
   *
   * 实测一次节点拖拽让本页建了 **250 个** BroadcastChannel, 两端互推 214 次
   * graph 广播, 页面直接卡死。用 ref 取最新的 api, 依赖只留频道名。
   */
  const apiRef = useRef(api);
  apiRef.current = api;

  const syncRef = useRef<SyncChannel | null>(null);
  useEffect(() => {
    const sync = new SyncChannel({
      channel: "hx-blueprint-source",
      onRemote: (g) => apiRef.current.replace(g),
      onRequest: () => graphRef.current,
      /**
       * 频道名只是一个名字, 谁都能用同名频道开一个**别的源**的页面。
       *
       * 这一页用的是**源码层**注册表 (33 个 `dsh` 节点), 而独立页面那侧在
       * `#src=dsh` 时用的是**架构层**注册表 (10 个大步骤 + 子图)。两者节点
       * 类型名不同  无条件接受对方的图, 整张图会立刻变成"未注册"。
       *
       * 实测: 独立页一发广播, 这一页就从"校验通过"变成 **70 个错误**
       * (10 个节点 × 各自的端口 + 边), 因为架构层的类型名源码层注册表
       * 一个都不认识。
       *
       * 与 blueprint-main.tsx 同一条判据: 不认识的图丢弃, 本地图保持不动。
       */
      accept: (g) => graphMatchesRegistry(registry, g),
    });
    syncRef.current = sync;
    return () => { sync.close(); syncRef.current = null; };
    // registry 由 useMemo 建, 身份稳定; 通道只在挂载时建一次
  }, [registry]);

  // 本地改动 -> 广播
  useEffect(() => {
    syncRef.current?.publish(api.graph);
  }, [api.graph]);

  /**
   * 独立整页画布的 URL。
   *
   * 每次渲染时算, 把当前图内联进去  那边打开就有内容, 不用等同步。
   * (原来是 window.open, 会被弹窗拦截器拦掉, 用户点了毫无反应。)
   */
  const standaloneHref = () => {
    const enc = graphToHash(api.graph);
    /**
     * `src` 必须是 `source`, 不能是 `dsh`。
     *
     * 这一页用的是**源码层**注册表 (createSourceRegistry, 33 个节点), 而
     * blueprint.html 的 `readSource()` 在 `src=dsh` 时加载的是**架构层**
     * 注册表 (10 个大步骤 + 子图)。写错 src 的后果是: 新开的独立页拿到
     * 一张自己不认识类型的图, 页面上每个节点都会变成"未注册"  而且
     * 因为 `accept` 拦着, 同步也救不回来, 看起来就是"打开是空的/全错"。
     *
     * 频道名同理: 源码层的图不该广播到架构层那个 `hx-blueprint-dsh` 频道上。
     */
    return "/blueprint.html#src=source&channel=hx-blueprint-source" + (enc ? `&graph=${enc}` : "");
  };

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
        standaloneHref={standaloneHref()}
      />

      <div className="text-[11px] leading-relaxed text-muted-foreground">
        白线是执行流, 彩线是数据。每条边都对应源码里一个真实的"下一步" 
        节点定义上带 <code className="rounded bg-muted/60 px-1">source</code> 字段标了行号, 可以回去核对。
        双击子图节点进入, 面包屑退回。
      </div>
    </div>
  );
}

/** 现场演示"加一个节点 = 加一行"。 
 * .agents/notes/implemented/process/2026-10-08-repository-agent-notes-v2-adoption.md
 */
function HowToExtend({ registry }: { readonly registry: ReturnType<typeof createSourceRegistry> }): JSX.Element {
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

    // 加完立刻验证类型判据对它也生效  不需要任何额外接线
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
          就这一段。<strong>蓝图层零改动</strong>  校验、类型相容、面板、求值全都对新节点立即生效。
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
