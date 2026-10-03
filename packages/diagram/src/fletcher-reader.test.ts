import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Parser } from "@lezer/common";
import { loadTypstParser } from "@oleafly/editor/typst";
import type { DiagEdge, DiagNode, DiagramModel } from "@oleafly/latex";
import { beforeAll, describe, expect, it } from "vitest";
import { modelToFletcher } from "./fletcher";
import { readFletcher } from "./fletcher-reader";
import { modelMarkLine } from "./languages/model-mark";

let parser: Parser;

beforeAll(async () => {
  parser = await loadTypstParser();
});

function node(overrides: Partial<DiagNode> & { id: string }): DiagNode {
  return { shape: "rectangle", x: 0, y: 0, w: 80, h: 40, label: "", ...overrides };
}

function edge(overrides: Partial<DiagEdge> & { id: string; source: string; target: string }): DiagEdge {
  return { routing: "straight", arrow: "forward", style: "solid", ...overrides };
}

const read = (source: string, hint?: DiagramModel | null) => readFletcher(parser, source, { hint });

const everything: DiagramModel = {
  version: 1,
  nodes: [
    node({ id: "group", shape: "roundrect", x: -40, y: -40, w: 420, h: 400, fill: "#e9e9ec", stroke: "#c7c7cc", radius: 16 }),
    node({ id: "a", label: "Rect & [x]", fill: "#cfe8f8", stroke: "#1e293b", strokeStyle: "dashed", radius: 4 }),
    node({ id: "b", x: 160, shape: "roundrect", label: "- Rounded", stroke: "#1e293b" }),
    node({ id: "c", y: 120, shape: "circle", w: 40, h: 40, label: "+", stroke: "#1e293b", strokeStyle: "dotted", strokeWidth: 2 }),
    node({ id: "d", x: 160, y: 120, shape: "ellipse", label: "Ellipse", fontFamily: "mono" }),
    node({ id: "e", y: 240, shape: "parallelogram", w: 120, label: "I/O", stroke: "#1e293b", fontFamily: "sans" }),
    node({ id: "f", x: 160, y: 240, shape: "text", label: "$E = m c^2$", textColor: "#b91c1c", fontSize: 12 }),
    node({ id: "g", x: 280, y: 0, shape: "diamond", label: "ok?", fill: "#eef2c3" }),
  ],
  edges: [
    edge({ id: "e1", source: "a", target: "b", label: "1. go", routing: "curved", sourceHandle: "t", targetHandle: "t" }),
    edge({ id: "e2", source: "a", target: "c", arrow: "both", style: "dotted" }),
    edge({ id: "e3", source: "b", target: "d", arrow: "none", style: "dashed", routing: "orthogonal", sourceHandle: "r", targetHandle: "r" }),
    edge({ id: "e4", source: "c", target: "e", routing: "orthogonal", label: "down", sourceHandle: "l", targetHandle: "l" }),
    edge({ id: "e5", source: "e", target: "f", routing: "curved", sourceHandle: "r", targetHandle: "t" }),
    edge({ id: "e6", source: "f", target: "f" }),
    edge({ id: "e7", source: "b", target: "g", sourceHandle: "r", targetHandle: "l" }),
  ],
};

describe("readFletcher round trips", () => {
  it("gives back the exact model when the canvas model is the hint", () => {
    const code = modelToFletcher(everything);
    const result = read(code, everything);
    expect(result.model).toEqual(everything);
    expect(result.notes).toEqual([]);
  });

  it("gives back the exact model from a saved file through the embedded model line", () => {
    const file = `${modelToFletcher(everything)}\n${modelMarkLine("//", everything)}\n`;
    expect(read(file).model).toEqual(everything);
  });

  it("reads every field fletcher expresses without any hint", () => {
    const result = read(modelToFletcher(everything));
    const model = result.model as DiagramModel;
    expect(result.notes).toEqual([]);
    expect(model.nodes.map((n) => [n.id, n.shape, n.label])).toEqual([
      ["group", "roundrect", ""],
      ["a", "roundrect", "Rect & [x]"],
      ["b", "roundrect", "- Rounded"],
      ["c", "circle", "+"],
      ["d", "ellipse", "Ellipse"],
      ["e", "parallelogram", "I/O"],
      ["f", "text", "$E = m c^2$"],
      ["g", "diamond", "ok?"],
    ]);
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    for (const original of everything.nodes) {
      const back = byId.get(original.id) as DiagNode;
      expect(back.x).toBeCloseTo(original.x, 0);
      expect(back.y).toBeCloseTo(original.y, 0);
      expect(back.w).toBeCloseTo(original.w, 0);
      expect(back.h).toBeCloseTo(original.h, 0);
      expect(back.fill ?? "").toBe(original.fill ?? "");
      expect(back.stroke ?? "").toBe(original.stroke ?? "");
      expect(back.strokeStyle ?? "solid").toBe(original.strokeStyle ?? "solid");
      expect(back.textColor ?? "").toBe(original.textColor ?? "");
      expect(back.fontFamily ?? "serif").toBe(original.fontFamily ?? "serif");
      expect(back.fontSize ?? 10).toBe(original.fontSize ?? 10);
    }
    expect(byId.get("c")?.strokeWidth).toBeCloseTo(2, 3);
    expect(model.edges.map((e) => [e.source, e.target, e.arrow, e.style, e.label ?? "", e.routing])).toEqual([
      ["a", "b", "forward", "solid", "1. go", "curved"],
      ["a", "c", "both", "dotted", "", "straight"],
      ["b", "d", "none", "dashed", "", "orthogonal"],
      ["c", "e", "forward", "solid", "down", "orthogonal"],
      ["e", "f", "forward", "solid", "", "curved"],
      ["f", "f", "forward", "solid", "", "curved"],
      ["b", "g", "forward", "solid", "", "straight"],
    ]);
    expect(model.edges[2]).toMatchObject({ sourceHandle: "r", targetHandle: "r" });
    expect(model.edges[3]).toMatchObject({ sourceHandle: "l", targetHandle: "l" });
  });

  it("writes the same code back after reading it without a hint", () => {
    const code = modelToFletcher(everything);
    const result = read(code);
    expect(modelToFletcher(result.model as DiagramModel, { extras: result.extras })).toBe(code);
  });

  it("keeps a background box as the model background", () => {
    const model: DiagramModel = { ...everything, background: "#ffeedd" };
    const result = read(modelToFletcher(model));
    expect(result.model?.background).toBe("#ffeedd");
    expect(read(modelToFletcher(model), model).model).toEqual(model);
  });

  it("keeps the exact code of untouched elements after a canvas edit", () => {
    const code = modelToFletcher(everything);
    const result = read(code, everything);
    const moved: DiagramModel = {
      ...everything,
      nodes: everything.nodes.map((n) => (n.id === "g" ? { ...n, x: n.x + 40 } : n)),
    };
    const next = modelToFletcher(moved, { extras: result.extras });
    expect(next).toBe(modelToFletcher(moved));
  });
});

describe("readFletcher on hand-written code", () => {
  const IMPORT = '#import "@preview/fletcher:0.5.8": diagram, node, edge';

  it("reads grid coordinates, bare labels, implicit edges and relative edges", () => {
    const source = [
      IMPORT,
      "#diagram(",
      "  node((0, 0), [Start]),",
      '  edge("-|>"),',
      "  node((1, 0), $A$),",
      '  edge("d", "->", [down]),',
      ")",
    ].join("\n");
    const result = read(source);
    const model = result.model as DiagramModel;
    expect(model.nodes.map((n) => n.label)).toEqual(["Start", "$A$"]);
    expect(model.nodes[1].x).toBeGreaterThan(model.nodes[0].x);
    expect(model.edges).toHaveLength(1);
    expect(model.edges[0]).toMatchObject({ source: model.nodes[0].id, target: model.nodes[1].id, arrow: "forward" });
    expect(result.extras?.items).toEqual(['edge("d", "->", [down])']);
    expect(result.notes.map((n) => n.code)).toContain("danglingEdge");
    expect(result.notes.map((n) => n.code)).toContain("gridCoordinates");
  });

  it("reads a lone edge coordinate as the target, coming from the node before the edge", () => {
    const source = [
      IMPORT,
      "#diagram(",
      "  node((0, 0), [A], name: <a>),",
      "  node((1, 0), [B], name: <b>),",
      '  edge(<a>, "->"),',
      ")",
    ].join("\n");
    expect(read(source).model?.edges.map((e) => [e.source, e.target])).toEqual([["b", "a"]]);
  });

  it("reads names given as labels or strings, any argument order and other mark spellings", () => {
    const source = [
      IMPORT,
      "#diagram(",
      '  node(height: 1cm, name: <in>, (0cm, 0cm), [In], width: 2cm),',
      '  node((4cm, 0cm), name: "out", label: [Out], width: 2cm, height: 1cm, fill: blue),',
      '  node(pos: (2cm, -2cm), [Mid], name: <mid>, width: 2cm, height: 1cm, stroke: 1pt + red),',
      '  edge(<in>, <out>, [yes], "->", label-side: left),',
      '  edge(<mid>, <in>, "<-"),',
      '  edge(<in>, <mid>, "<->", dash: "dotted", bend: 30deg),',
      '  edge(<out>, <mid>, "-->"),',
      ")",
    ].join("\n");
    const result = read(source);
    const model = result.model as DiagramModel;
    expect(model.nodes.map((n) => n.id)).toEqual(["in", "out", "mid"]);
    expect(model.nodes[1]).toMatchObject({ label: "Out", fill: "#0074d9", x: 120, y: -20 });
    expect(model.nodes[2]).toMatchObject({ stroke: "#ff4136", y: 60 });
    expect(model.edges.map((e) => [e.source, e.target, e.arrow, e.style, e.routing, e.label ?? ""])).toEqual([
      ["in", "out", "forward", "solid", "straight", "yes"],
      ["in", "mid", "forward", "solid", "straight", ""],
      ["in", "mid", "both", "dotted", "curved", ""],
      ["out", "mid", "forward", "dashed", "straight", ""],
    ]);
  });

  it("keeps hand-written code exactly when nothing changed on the canvas", () => {
    const source = [
      IMPORT,
      "#let accent = rgb(\"#3366ff\")",
      "#figure(diagram(",
      "  spacing: 2em,",
      "  node((0, 0), [A], fill: accent.lighten(60%), inset: 8pt),",
      '  edge("->"),',
      "  node((1, 0), [B]),",
      "  for x in range(2) { node((x, 2), [#x]) },",
      "), caption: [A figure])",
    ].join("\n");
    const result = read(source);
    const model = result.model as DiagramModel;
    expect(model.nodes).toHaveLength(2);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        { kind: "kept", code: "outsideCode" },
        { kind: "kept", code: "wrapper" },
        { kind: "kept", code: "diagramSetting", detail: "spacing" },
        { kind: "kept", code: "scripted" },
        { kind: "approximated", code: "colorExpressions" },
      ]),
    );
    const written = modelToFletcher(model, { extras: result.extras });
    expect(written).toContain('#let accent = rgb("#3366ff")');
    expect(written).toContain("#figure(diagram(");
    expect(written).toContain("), caption: [A figure])");
    expect(written).toContain("  spacing: 2em,");
    expect(written).toContain("  node((0, 0), [A], fill: accent.lighten(60%), inset: 8pt),");
    expect(written).toContain('  edge("->"),');
    expect(written).toContain("  for x in range(2) { node((x, 2), [#x]) },");
    expect(written).not.toContain("node-inset");
  });

  it("regenerates only the node the canvas moved and keeps its raw options", () => {
    const source = [
      IMPORT,
      "#diagram(",
      "  node((0, 0), [A], fill: accent.lighten(60%), inset: 8pt),",
      '  edge("->"),',
      "  node((1, 0), [B]),",
      ")",
    ].join("\n");
    const result = read(source);
    const model = result.model as DiagramModel;
    const moved: DiagramModel = {
      ...model,
      nodes: model.nodes.map((n, index) => (index === 1 ? { ...n, x: n.x + 80 } : n)),
    };
    const written = modelToFletcher(moved, { extras: result.extras });
    const lines = written.split("\n");
    expect(lines).toContain("  node((0, 0), [A], fill: accent.lighten(60%), inset: 8pt, name: <node>),");
    expect(written).not.toContain("node-inset");
    const second = lines.find((line) => line.includes("[B]")) ?? "";
    expect(second).toContain("name: <node-1>");
    expect(second).not.toContain("(1, 0)");
    expect(second).not.toContain("width:");
    expect(written).toContain("edge(<node>, <node-1>,");
    const again = read(written, moved);
    expect(again.model?.nodes.map((n) => n.id)).toEqual(["node", "node-1"]);
  });

  it("keeps nodes it cannot place and edges it cannot connect", () => {
    const source = [
      IMPORT,
      "#diagram(",
      "  node((0cm, 0cm), [A], name: <a>, width: 2cm, height: 1cm),",
      "  node(enclose: (<a>,), stroke: red),",
      '  edge(<a>, <missing>, "->"),',
      ")",
    ].join("\n");
    const result = read(source);
    expect(result.model?.nodes).toHaveLength(1);
    expect(result.model?.edges).toHaveLength(0);
    expect(result.extras?.items).toEqual(["node(enclose: (<a>,), stroke: red)", 'edge(<a>, <missing>, "->")']);
    const written = modelToFletcher(result.model as DiagramModel, { extras: result.extras });
    expect(written).toContain("  node(enclose: (<a>,), stroke: red),");
    expect(written).toContain('  edge(<a>, <missing>, "->"),');
  });

  it("keeps an import line that brings in more than the writer needs", () => {
    const source = ['#import "@preview/fletcher:0.5.1" as fletcher: diagram, node, edge', "#diagram(node((0, 0), [A]))"].join("\n");
    const result = read(source);
    expect(result.extras?.imports).toEqual(['#import "@preview/fletcher:0.5.1" as fletcher: diagram, node, edge']);
  });

  it("reports code that has no fletcher diagram", () => {
    const result = read("= Heading\nSome text.");
    expect(result.model).toBeNull();
    expect(result.notes).toHaveLength(1);
  });
});

const NETWORK = process.env.OLEAFLY_NETWORK_TESTS === "1";

function typstSidecar(): string {
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const triple = triples[`${process.platform}-${process.arch}`];
  const suffix = process.platform === "win32" ? ".exe" : "";
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src-tauri/binaries", `typst-${triple}${suffix}`);
}

describe("fletcher written after a read compiles", () => {
  it.skipIf(!NETWORK)(
    "compiles hand-written and generated diagrams after canvas edits with the bundled Typst",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "oleafly-fletcher-read-"));
      const cache = process.env.TYPST_PACKAGE_CACHE_PATH ?? path.join(dir, "cache");
      mkdirSync(cache, { recursive: true });
      const typst = typstSidecar();
      const env = { ...process.env, TYPST_PACKAGE_CACHE_PATH: cache };
      const typstVersion = /\d+\.\d+\.\d+/.exec(
        execFileSync(typst, ["--version"], { env, encoding: "utf8", timeout: 30_000 }),
      )?.[0];
      const handWritten = [
        `#import "@preview/fletcher:0.5.8": diagram, node, edge`,
        "#let accent = rgb(\"#3366ff\")",
        "#figure(diagram(",
        "  spacing: 2em,",
        "  node((0, 0), [Start], fill: accent.lighten(60%), inset: 8pt),",
        '  edge("-|>"),',
        "  node((1, 0), $A$, stroke: 1pt + red),",
        '  edge("d", "->", [down]),',
        "  for x in range(2) { node((x, 2), [#x]) },",
        "), caption: [A figure])",
      ].join("\n");
      const sources = [handWritten, modelToFletcher(everything, { typstVersion })];
      sources.forEach((source, index) => {
        const result = read(source);
        const model = result.model as DiagramModel;
        const moved: DiagramModel = {
          ...model,
          nodes: model.nodes.map((n, at) => (at === 0 ? { ...n, x: n.x + 30, y: n.y + 10 } : n)),
        };
        const written = modelToFletcher(moved, { typstVersion, extras: result.extras });
        const file = path.join(dir, `read-${index}.typ`);
        writeFileSync(file, `#set page(width: auto, height: auto, margin: 8pt)\n${written}\n`);
        const pdf = path.join(dir, `read-${index}.pdf`);
        execFileSync(typst, ["compile", file, pdf], { env, stdio: "pipe", timeout: 120_000 });
        expect(existsSync(pdf)).toBe(true);
      });
    },
    600_000,
  );
});
