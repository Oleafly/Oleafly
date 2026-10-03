// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DiagEdge, DiagNode, DiagramModel } from "@oleafly/latex";
import { readModelMark } from "./languages/model-mark";
import type { DiagramNote } from "./languages/types";
import {
  MERMAID_COMMENT,
  MERMAID_NOTE_ENGLISH,
  type MermaidExtras,
  mermaidBlocks,
  mermaidFence,
  mermaidFileSource,
  modelToMermaid,
  readMermaid,
} from "./mermaid";

function node(overrides: Partial<DiagNode> & { id: string }): DiagNode {
  return { shape: "rectangle", x: 0, y: 0, w: 120, h: 56, label: overrides.id, ...overrides };
}

function edge(overrides: Partial<DiagEdge> & { id: string; source: string; target: string }): DiagEdge {
  return { routing: "straight", arrow: "forward", style: "solid", ...overrides };
}

function model(nodes: DiagNode[], edges: DiagEdge[] = []): DiagramModel {
  return { version: 1, nodes, edges };
}

const FULL = model(
  [
    node({
      id: "start",
      label: "Start",
      x: 40,
      y: 40,
      fill: "#ffeecc",
      stroke: "#333333",
      strokeWidth: 2,
      textColor: "#111111",
      fontSize: 12,
      fontFamily: "mono",
    }),
    node({ id: "round", shape: "roundrect", label: "Round (1)", x: 40, y: 160, strokeStyle: "dashed", radius: 8 }),
    node({ id: "circ", shape: "circle", label: "C", x: 40, y: 280, w: 72, h: 72, strokeStyle: "dotted", fill: "" }),
    node({ id: "ell", shape: "ellipse", label: 'Say "hi"', x: 40, y: 400, w: 110, h: 64, fontFamily: "sans" }),
    node({ id: "dia", shape: "diamond", label: "Yes?", x: 300, y: 40, w: 92, h: 92, stroke: "#aa0000", fontFamily: "serif" }),
    node({ id: "para", shape: "parallelogram", label: "In/Out", x: 300, y: 200, w: 140, h: 60 }),
    node({ id: "txt", shape: "text", label: "Note #1 <b>", x: 300, y: 320, w: 90, h: 32, textColor: "#555555" }),
    node({ id: "grp", shape: "roundrect", label: "Group", x: 600, y: 0, w: 400, h: 300, fill: "#eeeeff" }),
    node({ id: "g1", label: "Inside", x: 620, y: 60 }),
    node({ id: "g2", shape: "roundrect", label: "Two\nlines", x: 820, y: 60 }),
    node({ id: "n7_ab3cd", label: "", x: 40, y: 520 }),
  ],
  [
    edge({ id: "e1", source: "start", target: "round" }),
    edge({ id: "e2", source: "round", target: "circ", arrow: "none", style: "dotted", label: "maybe" }),
    edge({
      id: "e3",
      source: "circ",
      target: "ell",
      arrow: "both",
      style: "dashed",
      routing: "curved",
      sourceHandle: "r",
      targetHandle: "l",
    }),
    edge({ id: "e4", source: "ell", target: "dia", style: "dashed", label: "a|b" }),
    edge({ id: "e5", source: "dia", target: "para", arrow: "both", label: "yes", routing: "orthogonal" }),
    edge({ id: "e6", source: "para", target: "g1", style: "dotted" }),
    edge({ id: "e7", source: "g1", target: "g2", arrow: "none" }),
    edge({ id: "e8", source: "dia", target: "dia" }),
    edge({ id: "e9", source: "txt", target: "n7_ab3cd", arrow: "none", style: "dashed" }),
  ],
);

const FULL_CODE = [
  "flowchart TD",
  "  start[Start]",
  '  round("Round (1)")',
  "  circ((C))",
  '  ell(["Say #quot;hi#quot;"])',
  "  dia{Yes?}",
  '  para[/"In/Out"/]',
  '  txt@{ shape: text, label: "Note #35;1 #lt;b#gt;" }',
  "  subgraph grp [Group]",
  "    g1[Inside]",
  '    g2("Two<br>lines")',
  "  end",
  '  n7_ab3cd[" "]',
  "  start --> round",
  "  round -.-|maybe| circ",
  "  circ <-.-> ell",
  '  ell -.->|"a#124;b"| dia',
  "  dia <-->|yes| para",
  "  para -.-> g1",
  "  g1 --- g2",
  "  dia --> dia",
  "  txt -.- n7_ab3cd",
  "  style start fill:#ffeecc,stroke:#333333,stroke-width:2px,color:#111111,font-size:12pt,font-family:monospace",
  "  style round stroke-dasharray:6 4",
  "  style circ fill:none,stroke-dasharray:2 3",
  "  style ell font-family:sans-serif",
  "  style dia stroke:#aa0000,font-family:serif",
  "  style txt color:#555555",
  "  style grp fill:#eeeeff",
  "  linkStyle 2,3,8 stroke-dasharray:6 4",
].join("\n");

type Rect = { x: number; y: number; w: number; h: number };

function inside(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 &&
    inner.y + inner.h <= outer.y + outer.h + 0.5
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function containerOf(m: DiagramModel, id: string): string | null {
  const target = m.nodes.find((n) => n.id === id);
  if (!target) return null;
  const containers = m.nodes.filter(
    (n) => n.id !== id && n.shape === "roundrect" && !m.edges.some((e) => e.source === n.id || e.target === n.id),
  );
  const holding = containers.filter((c) => inside(c, target)).sort((a, b) => a.w * a.h - b.w * b.h);
  return holding[0]?.id ?? null;
}

function expressed(m: DiagramModel) {
  return {
    nodes: m.nodes.map((n) => ({
      id: n.id,
      shape: n.shape,
      label: n.label,
      fill: n.fill,
      stroke: n.stroke,
      strokeStyle: n.strokeStyle,
      strokeWidth: n.strokeWidth,
      textColor: n.textColor,
      fontSize: n.fontSize,
      fontFamily: n.fontFamily,
      parent: containerOf(m, n.id),
    })),
    edges: m.edges.map((e) => ({
      source: e.source,
      target: e.target,
      arrow: e.arrow,
      style: e.style,
      label: e.label ?? "",
    })),
  };
}

function codes(notes: DiagramNote[]): string[] {
  return notes.map((n) => (n.detail ? `${n.kind}:${n.code}:${n.detail}` : `${n.kind}:${n.code}`));
}

function read(source: string, hint?: DiagramModel) {
  const result = readMermaid(source, hint ? { hint } : {});
  if (!result.model || !result.extras) throw new Error("expected a flowchart");
  return { model: result.model, extras: result.extras as MermaidExtras, notes: result.notes };
}

function patchNode(m: DiagramModel, id: string, patch: Partial<DiagNode>): DiagramModel {
  return { ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

function patchEdge(m: DiagramModel, source: string, target: string, patch: Partial<DiagEdge>): DiagramModel {
  return {
    ...m,
    edges: m.edges.map((e) => (e.source === source && e.target === target ? { ...e, ...patch } : e)),
  };
}

const ENTITY: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", num: "#" };

function decodeDb(text: string): string {
  return text
    .replace(/ﬂ°°(\d+)¶ß/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/ﬂ°(\w+)¶ß/g, (_, name: string) => ENTITY[name] ?? `#${name};`)
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();
}

interface DbVertex {
  id: string;
  text: string;
}
interface DbEdge {
  start: string;
  end: string;
  text: string;
  stroke: string;
}
interface DbSubgraph {
  id: string;
  title: string;
  nodes: string[];
}
interface FlowDb {
  getVertices(): Map<string, DbVertex>;
  getEdges(): DbEdge[];
  getSubGraphs(): DbSubgraph[];
  getDirection(): string;
}

async function mermaidParse(code: string): Promise<boolean> {
  const mermaid = (await import("mermaid")).default;
  return Boolean(await mermaid.parse(code));
}

async function mermaidDb(code: string) {
  const mermaid = (await import("mermaid")).default;
  await mermaid.parse(code);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(code);
  const db = diagram.db as unknown as FlowDb;
  const subgraphs = db.getSubGraphs();
  const subIds = new Set(subgraphs.map((s) => s.id));
  return {
    nodes: [...db.getVertices().values()]
      .filter((v) => !subIds.has(v.id))
      .map((v) => ({ id: v.id, label: decodeDb(v.text) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: db
      .getEdges()
      .filter((e) => e.stroke !== "invisible")
      .map((e) => [e.start, e.end, decodeDb(e.text)]),
    groups: subgraphs
      .map((s) => ({ id: s.id, label: decodeDb(s.title), members: [...s.nodes].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    direction: db.getDirection(),
  };
}

function ourDb(m: DiagramModel) {
  const groups = m.nodes.filter((n) => m.nodes.some((other) => containerOf(m, other.id) === n.id));
  const groupIds = new Set(groups.map((g) => g.id));
  return {
    nodes: m.nodes
      .filter((n) => !groupIds.has(n.id))
      .map((n) => ({ id: n.id, label: n.label }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: m.edges.map((e) => [e.source, e.target, e.label ?? ""]),
    groups: groups
      .map((g) => ({
        id: g.id,
        label: g.label,
        members: m.nodes
          .filter((n) => containerOf(m, n.id) === g.id)
          .map((n) => n.id)
          .sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const HAND = [
  "flowchart LR",
  "  %% hand-written",
  "  A[Start] --> B{Is it?}",
  "  B -- Yes --> C(Done)",
  "  B -->|No| D[[Retry]]",
  "  D --> A",
  "  classDef hot fill:#f96",
  "  class C hot",
  "  linkStyle 3 stroke:#f00",
].join("\n");

describe("modelToMermaid", () => {
  it("writes a header, one declaration per node, one link per edge and the style lines", () => {
    expect(modelToMermaid(FULL)).toBe(FULL_CODE);
  });

  it("writes an empty flowchart for an empty model", () => {
    expect(modelToMermaid(model([]))).toBe("flowchart TD");
  });

  it("writes plain ids, quotes labels with Mermaid characters and renames ids Mermaid cannot use", () => {
    const m = model([
      node({ id: "end", label: "end" }),
      node({ id: "my node", label: "Ready" }),
      node({ id: "plain", label: "plain" }),
    ]);
    expect(modelToMermaid(m)).toBe(
      ["flowchart TD", '  end_["end"]', "  my_node[Ready]", "  plain"].join("\n"),
    );
    expect(readMermaid(modelToMermaid(m), { hint: m }).model).toEqual(m);
  });

  it("keeps the direction and header read from the source", () => {
    const { model: m, extras } = read("graph LR\n  A --> B");
    const moved = patchNode(m, "A", { label: "Alpha" });
    expect(modelToMermaid(moved, { extras }).split("\n")[0]).toBe("graph LR");
  });

  it("produces code the Mermaid 11 parser accepts", async () => {
    expect(await mermaidParse(FULL_CODE)).toBe(true);
    const odd = model([node({ id: "a", label: "it's 50% (ok) & done; [x] {y} end" }), node({ id: "b", label: "" })], [
      edge({ id: "e", source: "a", target: "b", label: "#tag | x" }),
    ]);
    expect(await mermaidParse(modelToMermaid(odd))).toBe(true);
    expect(readMermaid(modelToMermaid(odd), { hint: odd }).model).toEqual(odd);
  });
});

describe("round trips", () => {
  it("reads its own output back to the same model with the model as hint", () => {
    expect(readMermaid(modelToMermaid(FULL), { hint: FULL }).model).toEqual(FULL);
  });

  it("reads a saved file back without a hint through the embedded model", () => {
    const file = mermaidFileSource(FULL);
    expect(file.startsWith(`${FULL_CODE}\n${MERMAID_COMMENT} `)).toBe(true);
    expect(readModelMark(file, MERMAID_COMMENT)).toEqual(FULL);
    expect(readMermaid(file).model).toEqual(FULL);
  });

  it("prefers the embedded model over a passed hint", () => {
    const other = patchNode(FULL, "start", { x: 999, y: 999 });
    const result = readMermaid(mermaidFileSource(FULL), { hint: other }).model;
    expect(result?.nodes[0]).toEqual(FULL.nodes[0]);
  });

  it("writes the same code again after reading it without a hint", () => {
    const { model: m, extras } = read(FULL_CODE);
    expect(modelToMermaid(m)).toBe(FULL_CODE);
    expect(modelToMermaid(m, { extras })).toBe(FULL_CODE);
  });

  it("keeps every field Mermaid can express when read without a hint", () => {
    const { model: m } = read(modelToMermaid(FULL));
    expect(expressed(m)).toEqual(expressed(FULL));
  });

  it("keeps fields Mermaid cannot express from the hint", () => {
    const code = modelToMermaid(FULL).replace("start[Start]", "start[Begin]");
    const m = readMermaid(code, { hint: FULL }).model;
    expect(m?.nodes[0]).toEqual({ ...FULL.nodes[0], label: "Begin" });
    expect(m?.nodes[1].radius).toBe(8);
    expect(m?.edges[2]).toEqual(FULL.edges[2]);
  });

  it("keeps the hint edge id, routing and handles when only the label changed in the code", () => {
    const code = modelToMermaid(FULL).replace("dia <-->|yes| para", "dia <-->|sure| para");
    const m = readMermaid(code, { hint: FULL }).model;
    expect(m?.edges[4]).toEqual({ ...FULL.edges[4], label: "sure" });
  });
});

describe("readMermaid", () => {
  it("reads chains, & groups, both label forms, classes and the graph keyword", async () => {
    const source = [
      "graph LR",
      "  A[Start] --> B{Is it?} & C",
      "  B -- Yes --> D(Done) --> E",
      "  B -->|No| F[[Retry]]",
      '  F -. "back #quot;home#quot;" .-> A',
      "  E ==> G((End))",
      "  classDef hot fill:#f96,stroke:#333,stroke-width:4px",
      "  class D,E hot",
      "  G:::hot",
      "  H <--> I",
      "  I x--x J",
      "  J --- K",
    ].join("\n");
    const { model: m, extras, notes } = read(source);
    expect(extras.direction).toBe("LR");
    expect(ourDb(m)).toEqual({
      nodes: (await mermaidDb(source)).nodes,
      edges: (await mermaidDb(source)).edges,
      groups: [],
    });
    const byId = new Map(m.nodes.map((n) => [n.id, n]));
    expect(byId.get("B")?.shape).toBe("diamond");
    expect(byId.get("D")?.shape).toBe("roundrect");
    expect(byId.get("F")?.shape).toBe("rectangle");
    expect(byId.get("G")?.shape).toBe("circle");
    expect(byId.get("D")).toMatchObject({ fill: "#ff9966", stroke: "#333333", strokeWidth: 4 });
    expect(byId.get("G")).toMatchObject({ fill: "#ff9966", stroke: "#333333", strokeWidth: 4 });
    expect(byId.get("A")?.fill).toBeUndefined();
    expect(m.edges.map((e) => [e.source, e.target, e.arrow, e.style, e.label ?? ""])).toEqual([
      ["A", "B", "forward", "solid", ""],
      ["A", "C", "forward", "solid", ""],
      ["B", "D", "forward", "solid", "Yes"],
      ["D", "E", "forward", "solid", ""],
      ["B", "F", "forward", "solid", "No"],
      ["F", "A", "forward", "dotted", 'back "home"'],
      ["E", "G", "forward", "solid", ""],
      ["H", "I", "both", "solid", ""],
      ["I", "J", "both", "solid", ""],
      ["J", "K", "none", "solid", ""],
    ]);
    expect(codes(notes)).toEqual(
      expect.arrayContaining([
        "approximated:mermaidShape:subroutine",
        "approximated:mermaidThickLink",
        "approximated:mermaidArrowHead",
      ]),
    );
  });

  it("reads subgraphs as group containers that hold exactly their members", async () => {
    const source = [
      "flowchart TB",
      "  c1-->a2",
      "  subgraph one",
      "    a1-->a2",
      "  end",
      "  subgraph two [Two Title]",
      "    direction LR",
      "    b1-->b2",
      "    subgraph three",
      "      x1",
      "    end",
      "  end",
      '  subgraph "Loose title"',
      "    z1",
      "  end",
      "  c1 --> b1",
    ].join("\n");
    const { model: m, notes } = read(source);
    const db = await mermaidDb(source);
    const ours = ourDb(m);
    expect(ours.nodes).toEqual(db.nodes);
    expect(ours.edges).toEqual(db.edges);
    expect(ours.groups).toEqual(db.groups);
    const leaves = m.nodes.filter((n) => !ours.groups.some((g) => g.id === n.id));
    for (const a of leaves) for (const b of leaves) if (a !== b) expect(overlaps(a, b)).toBe(false);
    expect(codes(notes)).toContain("kept:mermaidSubgraphDirection");
  });

  it("reads styles, named and short colours and stroke styles", () => {
    const { model: m, notes } = read(
      [
        "flowchart TD",
        "  A --> B --> C",
        "  style A fill:red,stroke:#0F0,stroke-width:3px,color:white,font-size:16px,stroke-dasharray:5 5",
        "  style B fill:transparent,stroke-dasharray:1 2,font-family:Courier New",
        "  style C fill:rgb(10\\,20\\,30),opacity:0.5",
      ].join("\n"),
    );
    expect(m.nodes[0]).toMatchObject({
      fill: "#ff0000",
      stroke: "#00ff00",
      strokeWidth: 3,
      textColor: "#ffffff",
      fontSize: 12,
      strokeStyle: "dashed",
    });
    expect(m.nodes[1]).toMatchObject({ fill: "", strokeStyle: "dotted", fontFamily: "mono" });
    expect(m.nodes[2]).toMatchObject({ fill: "#0a141e" });
    expect(codes(notes)).toContain("kept:mermaidStyleProperty:opacity");
  });

  it("reads dashed links from a linkStyle stroke-dasharray", () => {
    const { model: m } = read("flowchart TD\n  A -.-> B\n  B --> C\n  C -.- D\n  linkStyle 0,1 stroke-dasharray:6 4");
    expect(m.edges.map((e) => e.style)).toEqual(["dashed", "dashed", "dotted"]);
  });

  it("reads every node shape form", () => {
    const { model: m, notes } = read(
      [
        "flowchart TD",
        "  a[sq] --> b(rd) --> c([st]) --> d[[sub]] --> e[(cyl)] --> f((ci)) --> g(((dc)))",
        "  h>odd] --> i{di} --> j{{hex}} --> k[/lr/] --> l[\\ll\\] --> m[/tz\\] --> n[\\it/]",
        "  o(-el-)",
        '  p@{ shape: text, label: "Words" }',
        '  q@{ shape: cyl, label: "Disk" }',
        "  r@{ shape: rounded }",
      ].join("\n"),
    );
    expect(Object.fromEntries(m.nodes.map((n) => [n.id, `${n.shape}:${n.label}`]))).toEqual({
      a: "rectangle:sq",
      b: "roundrect:rd",
      c: "ellipse:st",
      d: "rectangle:sub",
      e: "rectangle:cyl",
      f: "circle:ci",
      g: "circle:dc",
      h: "rectangle:odd",
      i: "diamond:di",
      j: "rectangle:hex",
      k: "parallelogram:lr",
      l: "parallelogram:ll",
      m: "parallelogram:tz",
      n: "parallelogram:it",
      o: "ellipse:el",
      p: "text:Words",
      q: "rectangle:Disk",
      r: "roundrect:r",
    });
    expect(codes(notes)).toEqual(
      expect.arrayContaining([
        "approximated:mermaidShape:hexagon",
        "approximated:mermaidShape:cyl",
        "approximated:mermaidShape:doublecircle",
        "approximated:mermaidShape:lean_left",
      ]),
    );
  });

  it("decodes quoted labels, entity codes, line breaks and Markdown strings", () => {
    const { model: m, notes } = read(
      [
        "flowchart TD",
        '  A["say #quot;hi#quot; #35;1 #59; a<br/>b"]',
        '  B["`**bold** text`"]',
        "  A -- plain words --> B",
      ].join("\n"),
    );
    expect(m.nodes[0].label).toBe('say "hi" #1 ; a\nb');
    expect(m.nodes[1].label).toBe("**bold** text");
    expect(m.edges[0].label).toBe("plain words");
    expect(codes(notes)).toContain("approximated:mermaidMarkdownLabel");
  });

  it("returns no model for diagrams that are not flowcharts", () => {
    for (const source of [
      "sequenceDiagram\n  Alice->>Bob: Hi",
      "---\ntitle: x\n---\nclassDiagram\n  A <|-- B",
      "%% note\nstateDiagram-v2\n  [*] --> S",
    ]) {
      const result = readMermaid(source);
      expect(result.model).toBeNull();
      expect(result.extras).toBeNull();
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].kind).toBe("kept");
      expect(result.notes[0].code).toBe("mermaidNotFlowchart");
    }
    expect(readMermaid("sequenceDiagram\n  A->>B: x").notes[0].detail).toBe("sequenceDiagram");
    const headless = readMermaid("A --> B");
    expect(headless.model).toBeNull();
    expect(headless.notes).toEqual([{ kind: "kept", code: "mermaidNoFlowchartHeader" }]);
  });

  it("reads an empty source as an empty flowchart", () => {
    expect(readMermaid("").model).toEqual(model([]));
  });

  it("keeps statements it cannot draw verbatim and lists them in the notes", async () => {
    const source = [
      "---",
      "title: Kept title",
      "---",
      '%%{init: {"theme": "forest"}}%%',
      "flowchart TD",
      "  %% a comment",
      "  accTitle: Steps",
      "  A[One] --> B[Two]",
      '  click A "https://example.org" "Open"',
      "  classDef warm fill:#fc9,rx:6",
      "  class B warm",
      "  linkStyle 0 stroke:#f00,stroke-width:3px",
      "  A ~~~ B",
      "  B ---> C",
      "  A e9@--> C",
      "  e9@{ animate: true }",
      "  C@{ shape: rect, icon: fa:user }",
      "  A -->> B",
    ].join("\n");
    const { model: m, extras, notes } = read(source);
    expect(codes(notes)).toEqual(
      expect.arrayContaining([
        "kept:mermaidFrontmatter",
        "kept:mermaidDirective",
        "kept:mermaidComment",
        "kept:mermaidAccessibility",
        "kept:mermaidClick",
        "kept:mermaidClassProperty:rx",
        "kept:mermaidLinkStyleProperty:stroke",
        "kept:mermaidLinkStyleProperty:stroke-width",
        "kept:mermaidInvisibleLink",
        "kept:mermaidLinkLength",
        "kept:mermaidEdgeSetting:animate",
        "kept:mermaidNodeSetting:icon",
        "kept:mermaidUnknownStatement",
      ]),
    );
    expect(modelToMermaid(m, { extras })).toBe(source);
    const relabeled = modelToMermaid(patchNode(m, "A", { label: "Uno" }), { extras });
    expect(relabeled).toBe(source.replace("A[One]", "A[Uno]"));
    const grouped = model(
      [...m.nodes, node({ id: "box", shape: "roundrect", label: "Box", x: -5000, y: -5000, w: 20000, h: 20000 })],
      m.edges,
    );
    const rebuilt = modelToMermaid(grouped, { extras });
    for (const line of source.split("\n")) if (line !== "  A[One] --> B[Two]") expect(rebuilt).toContain(line.trim());
    for (const part of ["A[One]", "B[Two]", "A --> B"]) expect(rebuilt).toContain(part);
    expect(rebuilt).toContain("subgraph box [Box]");
    expect(await mermaidParse(rebuilt.replace("  A -->> B\n", "").replace("\n  A -->> B", ""))).toBe(true);
  });

  it("gives every note code an English sentence without em dashes or semicolons", () => {
    for (const [code, text] of Object.entries(MERMAID_NOTE_ENGLISH)) {
      expect(code.startsWith("mermaid")).toBe(true);
      expect(text).not.toMatch(/[—;]/);
      expect(text.endsWith(".")).toBe(true);
    }
    const sources = [
      HAND,
      "sequenceDiagram\n  A->>B: x",
      "---\ntitle: t\n---\n%%{init: {}}%%\nflowchart TD\n  %% c\n  accTitle: t\n  A ==> B\n  A ~~~ B\n  A ---> B\n  A --o B\n  A[\"`md`\"]\n  click A cb\n  style A opacity:1\n  classDef k rx:2\n  linkStyle 0 stroke:red\n  e1@{ curve: linear }\n  A e1@--> B\n  B@{ shape: cyl, icon: x }\n  subgraph s\n    direction LR\n    Q\n  end\n  A -->> B",
    ];
    for (const source of sources) {
      for (const n of readMermaid(source).notes) expect(MERMAID_NOTE_ENGLISH[n.code]).toBeTruthy();
    }
  });
});

describe("hand-written code survives canvas edits", () => {
  it("writes the source back unchanged when nothing changed or a node only moved", () => {
    const { model: m, extras } = read(HAND);
    expect(modelToMermaid(m, { extras })).toBe(HAND);
    const moved = patchNode(m, "D", { x: m.nodes[3].x + 140, y: m.nodes[3].y - 60 });
    expect(modelToMermaid(moved, { extras })).toBe(HAND);
  });

  it("regenerates only the declaration of a relabeled node", () => {
    const { model: m, extras } = read(HAND);
    const out = modelToMermaid(patchNode(m, "B", { label: "Is it ok?" }), { extras });
    const before = HAND.split("\n");
    const after = out.split("\n");
    expect(after).toHaveLength(before.length);
    expect(after[2]).toBe("  A[Start] --> B{Is it ok?}");
    for (let i = 0; i < before.length; i++) if (i !== 2) expect(after[i]).toBe(before[i]);
  });

  it("keeps the source shape of a relabeled node and replaces it when the shape changes", () => {
    const { model: m, extras } = read(HAND);
    const relabeled = modelToMermaid(patchNode(m, "D", { label: "Again" }), { extras });
    expect(relabeled.split("\n")[4]).toBe("  B -->|No| D[[Again]]");
    const reshaped = modelToMermaid(patchNode(m, "D", { shape: "diamond" }), { extras });
    expect(reshaped.split("\n")[4]).toBe("  B -->|No| D{Retry}");
  });

  it("rewrites only the link whose label or style changed", () => {
    const { model: m, extras } = read(HAND);
    const out = modelToMermaid(patchEdge(m, "B", "C", { label: "Sure", style: "dotted" }), { extras });
    expect(out).toBe(HAND.replace("B -- Yes --> C(Done)", "B -.->|Sure| C(Done)"));
  });

  it("splits a statement whose edge was deleted and renumbers linkStyle", async () => {
    const { model: m, extras } = read(HAND);
    const without = { ...m, edges: m.edges.filter((e) => !(e.source === "A" && e.target === "B")) };
    const out = modelToMermaid(without, { extras });
    expect(out).toBe(
      HAND.replace("  A[Start] --> B{Is it?}", "  A[Start]\n  B{Is it?}").replace("linkStyle 3", "linkStyle 2"),
    );
    expect(await mermaidParse(out)).toBe(true);
  });

  it("appends new nodes, edges and styles after the hand-written lines", async () => {
    const { model: m, extras } = read(HAND);
    const added = patchNode(
      {
        ...m,
        nodes: [...m.nodes, node({ id: "X", label: "New", x: 2000, y: 2000 })],
        edges: [...m.edges, edge({ id: "new", source: "D", target: "X", style: "dashed" })],
      },
      "C",
      { fill: "#00ff00" },
    );
    const out = modelToMermaid(added, { extras });
    expect(out).toBe(
      [HAND, "  X[New]", "  D -.-> X", "  style C fill:#00ff00", "  linkStyle 4 stroke-dasharray:6 4"].join("\n"),
    );
    expect(await mermaidParse(out)).toBe(true);
    const again = readMermaid(out, { hint: added }).model;
    expect(again).toEqual(added);
  });

  it("drops lines that only belong to a deleted node", () => {
    const { model: m, extras } = read(HAND);
    const without = {
      ...m,
      nodes: m.nodes.filter((n) => n.id !== "C"),
      edges: m.edges.filter((e) => e.source !== "C" && e.target !== "C"),
    };
    const out = modelToMermaid(without, { extras });
    expect(out.split("\n")).toEqual([
      "flowchart LR",
      "  %% hand-written",
      "  A[Start] --> B{Is it?}",
      "  B -->|No| D[[Retry]]",
      "  D --> A",
      "  classDef hot fill:#f96",
      "  linkStyle 2 stroke:#f00",
    ]);
  });

  it("regenerates a shared & link as one line per edge and keeps invisible links and their linkStyle index", async () => {
    const source = ["flowchart TD", "  A & B --> C", "  A ~~~ C", "  C --> D", "  linkStyle 3 stroke:#f00"].join("\n");
    const { model: m, extras } = read(source);
    const out = modelToMermaid(patchEdge(m, "A", "C", { arrow: "both" }), { extras });
    expect(out).toBe(
      ["flowchart TD", "  A <--> C", "  B --> C", "  A ~~~ C", "  C --> D", "  linkStyle 3 stroke:#f00"].join("\n"),
    );
    const removed = modelToMermaid({ ...m, edges: m.edges.filter((e) => e.source !== "B") }, { extras });
    expect(removed).toBe(["flowchart TD", "  B", "  A --> C", "  A ~~~ C", "  C --> D", "  linkStyle 2 stroke:#f00"].join("\n"));
    expect(await mermaidParse(removed)).toBe(true);
  });

  it("never names a new node after an edge id from the source", () => {
    const { model: m, extras } = read("flowchart TD\n  A e9@--> B\n  e9@{ animate: true }");
    const added = { ...m, nodes: [...m.nodes, node({ id: "e9", label: "Nine", x: 900, y: 900 })] };
    expect(modelToMermaid(added, { extras }).split("\n").at(-1)).toBe("  e9_2[Nine]");
  });

  it("adds a new member inside its subgraph", async () => {
    const source = ["flowchart TD", "  subgraph S [Side]", "    A --> B", "  end", "  B --> C"].join("\n");
    const { model: m, extras } = read(source);
    const group = m.nodes.find((n) => n.id === "S");
    if (!group) throw new Error("missing group");
    const added = { ...m, nodes: [...m.nodes, node({ id: "D", x: group.x + 30, y: group.y + 30, w: 10, h: 10 })] };
    const out = modelToMermaid(added, { extras });
    expect(out).toBe(["flowchart TD", "  subgraph S [Side]", "    A --> B", "    D", "  end", "  B --> C"].join("\n"));
    expect(await mermaidParse(out)).toBe(true);
  });
});

describe("layout", () => {
  const position = (m: DiagramModel, id: string) => {
    const n = m.nodes.find((candidate) => candidate.id === id);
    if (!n) throw new Error(id);
    return n;
  };

  it("follows the flowchart direction", () => {
    const td = read("flowchart TD\n  A --> B").model;
    expect(position(td, "B").y).toBeGreaterThan(position(td, "A").y + position(td, "A").h);
    const bt = read("flowchart BT\n  A --> B").model;
    expect(position(bt, "B").y + position(bt, "B").h).toBeLessThan(position(bt, "A").y);
    const lr = read("graph LR\n  A --> B").model;
    expect(position(lr, "B").x).toBeGreaterThan(position(lr, "A").x + position(lr, "A").w);
    const rl = read("graph RL\n  A --> B").model;
    expect(position(rl, "B").x + position(rl, "B").w).toBeLessThan(position(rl, "A").x);
  });

  it("does not overlap nodes in a larger graph and sizes nodes from their labels", () => {
    const { model: m } = read(
      "flowchart TD\n  A --> B & C & D\n  B --> E\n  C --> E\n  E --> A\n  D --> F[A much longer label than the others]",
    );
    for (const a of m.nodes) for (const b of m.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
    expect(position(m, "F").w).toBeGreaterThan(position(m, "A").w);
  });

  it("keeps hint geometry and places new nodes next to their neighbours", () => {
    const hint = read("flowchart TD\n  A --> B").model;
    const next = readMermaid("flowchart TD\n  A --> B\n  B --> C\n  Q", { hint }).model;
    if (!next) throw new Error("expected a model");
    expect(position(next, "A")).toEqual(position(hint, "A"));
    expect(position(next, "B")).toEqual(position(hint, "B"));
    expect(position(next, "C").y).toBeGreaterThan(position(next, "B").y + position(next, "B").h);
    for (const a of next.nodes) for (const b of next.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it("moves a node out of its old group box when the code moves it out of the subgraph", () => {
    const hint = read("flowchart TD\n  subgraph S\n    A --> B\n  end").model;
    const next = readMermaid("flowchart TD\n  subgraph S\n    A\n  end\n  A --> B", { hint }).model;
    if (!next) throw new Error("expected a model");
    expect(containerOf(next, "A")).toBe("S");
    expect(containerOf(next, "B")).toBeNull();
  });
});

describe("pinned reader, layout and writer cases", () => {
  const READER = [
    "flowchart TD",
    "  %%{init: {}}%%",
    "  %% note",
    "  end",
    "  direction LR",
    "  A:::",
    "  classDef",
    "  class D",
    "  style",
    "  classDef hot fill:#f00,rx:2",
    "  subgraph S1 [Group one]",
    "    direction RL",
    "    style S1 fill:#eeeeee",
    "    X --> Y",
    "  end",
    "  style S1 stroke:#333",
    '  subgraph "spaced title"',
    "    Z",
    "  end",
    "  linkStyle 0 interpolate basis stroke:#f00,stroke-dasharray:3",
    "  P:::hot --o Q",
    "  P --x R",
    "  P ==> Q",
    "  P o--o R",
    "  V@{ shape: sm-circ, icon: x }",
    "  W@{ shape: cyl }",
    "  subgraph Open",
    "    O1",
    "  B@{ shape: rect",
  ].join("\n");

  const withoutNode = (m: DiagramModel, id: string): DiagramModel => ({
    ...m,
    nodes: m.nodes.filter((n) => n.id !== id),
    edges: m.edges.filter((e) => e.source !== id && e.target !== id),
  });

  it("reads what it can and keeps the rest as raw statements", () => {
    const { model: m, extras, notes } = read(READER);
    expect(notes.map((n) => (n.detail ? `${n.code}:${n.detail}` : n.code))).toEqual([
      "mermaidDirective",
      "mermaidComment",
      "mermaidUnknownStatement",
      "mermaidClassProperty:rx",
      "mermaidSubgraphDirection",
      "mermaidLinkStyleProperty:interpolate",
      "mermaidLinkStyleProperty:stroke",
      "mermaidNodeSetting:icon",
      "mermaidShape:sm-circ",
      "mermaidShape:cyl",
      "mermaidArrowHead",
      "mermaidThickLink",
    ]);
    expect(extras.items.map((item) => item.kind)).toEqual([
      "raw", "raw", "raw", "raw", "raw", "graph", "raw", "graph", "raw", "subgraph", "direction", "style", "graph", "end",
      "style", "subgraph", "graph", "end", "linkStyle", "graph", "graph", "graph", "graph", "graph", "graph", "subgraph",
      "graph", "raw",
    ]);
    expect(m.nodes.map((n) => [n.id, n.shape, n.label, n.fill ?? null, n.stroke ?? null])).toEqual([
      ["classDef", "rectangle", "classDef", null, null],
      ["style", "rectangle", "style", null, null],
      ["S1", "roundrect", "Group one", "#eeeeee", "#333333"],
      ["X", "rectangle", "X", null, null],
      ["Y", "rectangle", "Y", null, null],
      ["subGraph1", "roundrect", "spaced title", null, null],
      ["Z", "rectangle", "Z", null, null],
      ["P", "rectangle", "P", "#ff0000", null],
      ["Q", "rectangle", "Q", null, null],
      ["R", "rectangle", "R", null, null],
      ["V", "circle", "V", null, null],
      ["W", "rectangle", "W", null, null],
      ["Open", "roundrect", "Open", null, null],
      ["O1", "rectangle", "O1", null, null],
    ]);
    expect(m.edges.map((e) => [e.source, e.target, e.arrow, e.style, e.label ?? null])).toEqual([
      ["X", "Y", "forward", "dashed", null],
      ["P", "Q", "forward", "solid", null],
      ["P", "R", "forward", "solid", null],
      ["P", "Q", "forward", "solid", null],
      ["P", "R", "both", "solid", null],
    ]);
    expect(extras.links).toEqual({
      e2: { heads: ["", "o"] },
      e3: { heads: ["", "x"] },
      e4: { thick: true },
      e5: { heads: ["o", "o"] },
    });
    expect(extras.directions).toEqual({ S1: "RL" });
    expect(extras.parents).toEqual({ X: "S1", Y: "S1", Z: "subGraph1", O1: "Open" });
  });

  it("places new nodes and groups around hint geometry in every direction", () => {
    const placed = (dir: string) => {
      const hint = read(`flowchart ${dir}\n  A --> B`).model;
      const source = [`flowchart ${dir}`, "  A --> B", "  C", "  subgraph G", "    D --> E", "  end", "  F --> A"].join("\n");
      return read(source, hint).model.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h]);
    };
    expect(placed("TB")).toEqual([
      ["A", 40, 40, 120, 56],
      ["B", 40, 156, 120, 56],
      ["C", 40, 272, 120, 56],
      ["G", 40, 388, 160, 236],
      ["D", 60, 432, 120, 56],
      ["E", 60, 548, 120, 56],
      ["F", 40, -76, 120, 56],
    ]);
    expect(placed("BT")).toEqual([
      ["A", 40, 156, 120, 56],
      ["B", 40, 40, 120, 56],
      ["C", 40, -76, 120, 56],
      ["G", 40, -372, 160, 236],
      ["D", 60, -212, 120, 56],
      ["E", 60, -328, 120, 56],
      ["F", 40, 272, 120, 56],
    ]);
    expect(placed("LR")).toEqual([
      ["A", 40, 40, 120, 56],
      ["B", 220, 40, 120, 56],
      ["C", 400, 40, 120, 56],
      ["G", 580, 40, 340, 120],
      ["D", 600, 84, 120, 56],
      ["E", 780, 84, 120, 56],
      ["F", -140, 40, 120, 56],
    ]);
    expect(placed("RL")).toEqual([
      ["A", 220, 40, 120, 56],
      ["B", 40, 40, 120, 56],
      ["C", -140, 40, 120, 56],
      ["G", -540, 40, 340, 120],
      ["D", -340, 84, 120, 56],
      ["E", -520, 84, 120, 56],
      ["F", 400, 40, 120, 56],
    ]);
    const group = read("flowchart TD\n  subgraph G\n    D\n  end").model;
    const onlyBox = { ...group, nodes: group.nodes.filter((n) => n.id === "G") };
    const boxed = read("flowchart TD\n  subgraph G\n    D --> E\n  end\n  F", onlyBox).model;
    expect(boxed.nodes.map((n) => [n.id, n.x, n.y, n.w, n.h])).toEqual([
      ["G", 20, -4, 180, 236],
      ["D", 40, 40, 120, 56],
      ["E", 40, 156, 120, 56],
      ["F", 40, 272, 120, 56],
    ]);
  });

  const WRITES: [string, string, (m: DiagramModel) => DiagramModel, string[]][] = [
    [
      "kept circle and cross heads",
      "flowchart LR\n  A --o B\n  A x--x C",
      (m) => patchEdge(patchEdge(m, "A", "B", { label: "kept" }), "A", "C", { arrow: "forward" }),
      ["flowchart LR", "  A --o|kept| B", "  A --> C"],
    ],
    [
      "a dash style that undoes a default class",
      "flowchart TD\n  classDef default stroke-dasharray:3\n  A --> B\n  style A fill:#ff0000",
      (m) => patchNode(patchNode(m, "A", { strokeStyle: "solid", fill: "#00ff00" }), "B", { strokeStyle: "dotted" }),
      [
        "flowchart TD",
        "  classDef default stroke-dasharray:3",
        "  A --> B",
        "  style A fill:#00ff00,stroke-dasharray:0",
        "  style B stroke-dasharray:2 3",
      ],
    ],
    [
      "a default linkStyle",
      "flowchart TD\n  A --> B\n  B --> C\n  linkStyle default stroke-dasharray:3",
      (m) => patchEdge(m, "A", "B", { style: "solid", label: "x" }),
      ["flowchart TD", "  A -->|x| B", "  B --> C", "  linkStyle default stroke-dasharray:3"],
    ],
    [
      "a dashed linkStyle whose edge became solid",
      "flowchart TD\n  A --> B\n  B --> C\n  linkStyle 0,1 stroke-dasharray:3,stroke:#f00",
      (m) => patchEdge(m, "A", "B", { style: "solid" }),
      ["flowchart TD", "  A --> B", "  B --> C", "  linkStyle 1 stroke-dasharray:3,stroke:#f00", "  linkStyle 0 stroke:#f00"],
    ],
    [
      "an interpolate-only linkStyle after an edge was deleted",
      "flowchart TD\n  A --> B\n  B --> C\n  C --> D\n  linkStyle 1,2 interpolate basis",
      (m) => ({ ...m, edges: m.edges.filter((e) => !(e.source === "A" && e.target === "B")) }),
      ["flowchart TD", "  A", "  B", "  B --> C", "  C --> D", "  linkStyle 0,1 interpolate basis"],
    ],
    [
      "relabeled data declarations",
      'flowchart TD\n  A@{ shape: rect, label: "x" }\n  B@{ shape: diam }\n  A --> B',
      (m) => patchNode(patchNode(m, "A", { label: "Renamed" }), "B", { label: "Q?" }),
      ["flowchart TD", '  A@{ shape: rect, label: "Renamed" }', '  B@{ shape: diam, label: "Q?" }', "  A --> B"],
    ],
    [
      "a subgraph statement that lost a node",
      "flowchart TD\n  subgraph S\n    A:::hot --> B & C\n    B\n    S2\n  end\n  classDef hot fill:#f96",
      (m) => withoutNode(m, "C"),
      ["flowchart TD", "  subgraph S", "    A:::hot", "    A --> B", "    B", "    S2", "  end", "  classDef hot fill:#f96"],
    ],
    [
      "style lines of a deleted node and of a cleared fill",
      "flowchart TD\n  A --> B\n  style A fill:#ff0000,opacity:0.5\n  style B fill:#00ff00",
      (m) => withoutNode(patchNode(m, "A", { fill: undefined }), "B"),
      ["flowchart TD", "  A", "  style A opacity:0.5"],
    ],
    [
      "a node declared only by a style line",
      "flowchart TD\n  A --> B\n  style X fill:#ff0000",
      (m) => patchNode(m, "X", { label: "Now labelled" }),
      ["flowchart TD", "  A --> B", "  style X fill:#ff0000", "  X[Now labelled]"],
    ],
    [
      "a deleted subgraph",
      "flowchart TD\n  subgraph S\n    A --> B\n  end\n  style A fill:#ff0000,opacity:0.5\n  click A cb\n  e1@{ animate: true }\n  A e1@--> B\n  class A,B hot\n  linkStyle 0 stroke:#f00\n  A ~~~ B",
      (m) => withoutNode(m, "S"),
      [
        "flowchart TD",
        "  A",
        "  B",
        "  A --> B",
        "  A e1@--> B",
        "  A ~~~ B",
        "  style A fill:#ff0000,opacity:0.5",
        "  click A cb",
        "  e1@{ animate: true }",
        "  class A,B hot",
        "  linkStyle 0 stroke:#f00",
      ],
    ],
    [
      "a class line that lost a node",
      "flowchart TD\n  A --> B\n  B --> C\n  class A,B,C hot",
      (m) => withoutNode(m, "B"),
      ["flowchart TD", "  A", "  C", "  class A,C hot"],
    ],
    [
      "a new node inside a subgraph",
      "flowchart TD\n  subgraph S\n    A\n  end",
      (m) => {
        const a = m.nodes.find((n) => n.id === "A");
        const fresh = node({ id: "N", shape: "circle", x: (a?.x ?? 0) + 2, y: (a?.y ?? 0) + 2, w: 10, h: 10, label: "N", fill: "#123456" });
        return { ...m, nodes: [...m.nodes, fresh] };
      },
      ["flowchart TD", "  subgraph S", "    A", "    N((N))", "  end", "  style N fill:#123456"],
    ],
  ];

  it.each(WRITES)("writes %s back with the hand-written parts kept", (_, source, change, expected) => {
    const { model: m, extras } = read(source);
    expect(modelToMermaid(change(m), { extras })).toBe(expected.join("\n"));
  });
});

describe("mermaidBlocks and mermaidFence", () => {
  it("finds fenced mermaid blocks with their content ranges", () => {
    const markdown = [
      "# Title",
      "```mermaid",
      "flowchart TD",
      "  A --> B",
      "```",
      "text",
      "~~~mermaid",
      "graph LR",
      "~~~",
      "```js",
      "x",
      "```",
      "````mermaid",
      "```",
      "````",
      "```mermaid",
      "```",
      "```mermaid",
      "open to the end",
    ].join("\n");
    const blocks = mermaidBlocks(markdown);
    expect(blocks.map((b) => b.code)).toEqual(["flowchart TD\n  A --> B", "graph LR", "```", "", "open to the end"]);
    for (const block of blocks) expect(markdown.slice(block.from, block.to)).toBe(block.code);
  });

  it("wraps code in a mermaid fence without trailing newlines", () => {
    expect(mermaidFence("flowchart TD\n  A --> B\n\n")).toBe("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(mermaidBlocks(mermaidFence("graph LR"))[0].code).toBe("graph LR");
  });
});
