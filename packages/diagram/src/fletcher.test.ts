import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiagEdge, DiagNode, DiagramModel } from "@oleafly/latex";
import { fletcherImport, fletcherVersionFor, modelToFletcher } from "./fletcher";

const PREAMBLE = [
  "  node-inset: 0pt,",
  "  node-defocus: 0,",
  "  edge-stroke: 0.05cm,",
  "  label-size: 9pt,",
];

function node(overrides: Partial<DiagNode> & { id: string }): DiagNode {
  return { shape: "rectangle", x: 0, y: 0, w: 80, h: 40, label: "", ...overrides };
}

function edge(overrides: Partial<DiagEdge> & { source: string; target: string }): DiagEdge {
  return { id: "e", routing: "straight", arrow: "forward", style: "solid", ...overrides };
}

function model(nodes: DiagNode[], edges: DiagEdge[] = [], background?: string): DiagramModel {
  return { version: 1, nodes, edges, ...(background === undefined ? {} : { background }) };
}

function bodyLines(source: string): string[] {
  return source.split("\n").filter((line) => line.startsWith("  node(") || line.startsWith("  edge("));
}

const A = node({ id: "a", label: "A" });
const B = node({ id: "b", x: 0, y: 120, label: "B" });
const RIGHT = node({ id: "r", x: 160, y: 0, label: "R" });

describe("fletcherVersionFor", () => {
  it.each([
    ["0.15.1", "0.5.8"],
    ["0.14.2", "0.5.8"],
    ["0.13.0", "0.5.8"],
    ["1.0.0", "0.5.8"],
    ["0.12.0", "0.5.5"],
    ["v0.12.3", "0.5.5"],
    ["0.11.1", "0.5.1"],
    ["0.10.0", "0.5.1"],
    ["not a version", "0.5.8"],
    [null, "0.5.8"],
    [undefined, "0.5.8"],
  ])("picks fletcher for Typst %j as %s", (typst, fletcher) => {
    expect(fletcherVersionFor(typst)).toBe(fletcher);
  });

  it("imports the names the writer uses", () => {
    expect(fletcherImport("0.5.5")).toBe('#import "@preview/fletcher:0.5.5": diagram, node, edge, shapes');
  });
});

describe("modelToFletcher", () => {
  it("writes an empty diagram for an empty model", () => {
    expect(modelToFletcher(model([]))).toBe(
      [fletcherImport("0.5.8"), "#diagram(", ...PREAMBLE, ")"].join("\n"),
    );
  });

  it("writes nodes at their centers in centimetres with y up and edges by name", () => {
    expect(modelToFletcher(model([A, B], [edge({ source: "a", target: "b" })]))).toBe(
      [
        '#import "@preview/fletcher:0.5.8": diagram, node, edge, shapes',
        "#diagram(",
        ...PREAMBLE,
        "  node((1cm, -0.5cm), text(size: 10pt)[A], name: <a>, width: 2cm, height: 1cm, shape: rect),",
        "  node((1cm, -3.5cm), text(size: 10pt)[B], name: <b>, width: 2cm, height: 1cm, shape: rect),",
        '  edge(<a>, <b>, "-|>"),',
        ")",
      ].join("\n"),
    );
  });

  it("imports the fletcher release that matches the Typst version", () => {
    expect(modelToFletcher(model([A]), { typstVersion: "0.12.0" }).split("\n")[0]).toBe(
      fletcherImport("0.5.5"),
    );
    expect(modelToFletcher(model([A]), { typstVersion: "0.11.1" }).split("\n")[0]).toBe(
      fletcherImport("0.5.1"),
    );
    expect(modelToFletcher(model([A]), { typstVersion: null }).split("\n")[0]).toBe(
      fletcherImport("0.5.8"),
    );
  });

  it("writes every shape", () => {
    const shapes: DiagNode[] = [
      node({ id: "rect", shape: "rectangle" }),
      node({ id: "round", shape: "roundrect", label: "R" }),
      node({ id: "circle", shape: "circle", w: 40, h: 40 }),
      node({ id: "wide-circle", shape: "circle", w: 60, h: 40 }),
      node({ id: "ellipse", shape: "ellipse" }),
      node({ id: "diamond", shape: "diamond" }),
      node({ id: "para", shape: "parallelogram", w: 100, h: 40 }),
      node({ id: "text", shape: "text", label: "Note" }),
    ];
    expect(bodyLines(modelToFletcher(model(shapes)))).toEqual([
      "  node((1cm, -0.5cm), name: <rect>, width: 2cm, height: 1cm, shape: rect),",
      "  node((1cm, -0.5cm), text(size: 10pt)[R], name: <round>, width: 2cm, height: 1cm, shape: rect, corner-radius: 0.15cm),",
      "  node((0.5cm, -0.5cm), name: <circle>, radius: 0.5cm, shape: circle),",
      "  node((0.75cm, -0.5cm), name: <wide-circle>, radius: 0.75cm, shape: circle),",
      "  node((1cm, -0.5cm), name: <ellipse>, width: 2cm, height: 1cm, shape: shapes.ellipse),",
      "  node((1cm, -0.5cm), name: <diamond>, width: 2cm, height: 1cm, shape: shapes.diamond.with(fit: 0)),",
      "  node((1.25cm, -0.5cm), name: <para>, width: 2.5cm, height: 1cm, shape: shapes.parallelogram.with(angle: 47.726deg, fit: 0)),",
      "  node((1cm, -0.5cm), text(size: 10pt)[Note], name: <text>, width: 2cm, height: 1cm, shape: rect, stroke: none),",
    ]);
  });

  it("rounds only the shapes TikZ rounds and draws an unlabeled rounded box behind the edges", () => {
    const nodes = [
      node({ id: "r4", shape: "rectangle", radius: 4, label: "x" }),
      node({ id: "t8", shape: "text", radius: 8, label: "x" }),
      node({ id: "flat", shape: "roundrect", radius: 0, label: "x" }),
      node({ id: "d4", shape: "diamond", radius: 4, label: "x" }),
      node({ id: "group", shape: "roundrect", radius: 16 }),
    ];
    expect(bodyLines(modelToFletcher(model(nodes)))).toEqual([
      "  node((1cm, -0.5cm), text(size: 10pt)[x], name: <r4>, width: 2cm, height: 1cm, shape: rect, corner-radius: 0.1cm),",
      "  node((1cm, -0.5cm), text(size: 10pt)[x], name: <t8>, width: 2cm, height: 1cm, shape: rect, stroke: none, corner-radius: 0.2cm),",
      "  node((1cm, -0.5cm), text(size: 10pt)[x], name: <flat>, width: 2cm, height: 1cm, shape: rect),",
      "  node((1cm, -0.5cm), text(size: 10pt)[x], name: <d4>, width: 2cm, height: 1cm, shape: shapes.diamond.with(fit: 0)),",
      "  node((1cm, -0.5cm), name: <group>, width: 2cm, height: 1cm, shape: rect, corner-radius: 0.4cm, layer: -1),",
    ]);
  });

  it("writes fills, strokes, dashes and text styling", () => {
    const nodes = [
      node({
        id: "styled",
        label: "S",
        fill: "#CFE8F8",
        stroke: "#1e293b",
        strokeWidth: 2,
        textColor: "#0F172A",
        fontSize: 14,
      }),
      node({ id: "dashed", stroke: "#ff0000", strokeStyle: "dashed" }),
      node({ id: "dotted", stroke: "#00ff00", strokeStyle: "dotted", strokeWidth: 3 }),
      node({ id: "solid", stroke: "#0000ff", strokeStyle: "solid" }),
      node({ id: "dash-no-color", strokeStyle: "dashed", fill: "" }),
      node({ id: "bad-colors", fill: "red", stroke: "#12345", textColor: "blue", label: "c" }),
      node({ id: "serif", label: "s", fontFamily: "serif" }),
      node({ id: "sans", label: "s", fontFamily: "sans", textColor: "#ffffff" }),
      node({ id: "mono", label: "m", fontFamily: "mono", fontSize: 8 }),
    ];
    expect(bodyLines(modelToFletcher(model(nodes)))).toEqual([
      '  node((1cm, -0.5cm), text(size: 14pt, fill: rgb("#0f172a"))[S], name: <styled>, width: 2cm, height: 1cm, shape: rect, fill: rgb("#cfe8f8"), stroke: (paint: rgb("#1e293b"), thickness: 0.05cm)),',
      '  node((1cm, -0.5cm), name: <dashed>, width: 2cm, height: 1cm, shape: rect, stroke: (paint: rgb("#ff0000"), thickness: 0.025cm, dash: "dashed")),',
      '  node((1cm, -0.5cm), name: <dotted>, width: 2cm, height: 1cm, shape: rect, stroke: (paint: rgb("#00ff00"), thickness: 0.075cm, dash: "dotted", cap: "round")),',
      '  node((1cm, -0.5cm), name: <solid>, width: 2cm, height: 1cm, shape: rect, stroke: (paint: rgb("#0000ff"), thickness: 0.025cm)),',
      "  node((1cm, -0.5cm), name: <dash-no-color>, width: 2cm, height: 1cm, shape: rect),",
      "  node((1cm, -0.5cm), text(size: 10pt)[c], name: <bad-colors>, width: 2cm, height: 1cm, shape: rect),",
      "  node((1cm, -0.5cm), text(size: 10pt)[s], name: <serif>, width: 2cm, height: 1cm, shape: rect),",
      '  node((1cm, -0.5cm), text(size: 10pt, fill: rgb("#ffffff"), font: "Arial")[s], name: <sans>, width: 2cm, height: 1cm, shape: rect),',
      '  node((1cm, -0.5cm), text(size: 8pt, font: "DejaVu Sans Mono")[m], name: <mono>, width: 2cm, height: 1cm, shape: rect),',
    ]);
  });

  it("writes every arrow and line style", () => {
    const edges = [
      edge({ source: "a", target: "b", arrow: "none" }),
      edge({ source: "a", target: "b", arrow: "forward" }),
      edge({ source: "a", target: "b", arrow: "both" }),
      edge({ source: "a", target: "b", style: "dashed" }),
      edge({ source: "a", target: "b", style: "dotted", arrow: "both" }),
    ];
    expect(bodyLines(modelToFletcher(model([A, B], edges))).slice(2)).toEqual([
      '  edge(<a>, <b>, "-"),',
      '  edge(<a>, <b>, "-|>"),',
      '  edge(<a>, <b>, "<|-|>"),',
      '  edge(<a>, <b>, "-|>", dash: "dashed"),',
      '  edge(<a>, <b>, "<|-|>", dash: "dotted"),',
    ]);
  });

  it("puts edge labels on the line", () => {
    const edges = [edge({ source: "a", target: "b", label: "yes", style: "dashed" })];
    expect(bodyLines(modelToFletcher(model([A, B], edges)))[2]).toBe(
      '  edge(<a>, <b>, "-|>", [yes], label-side: center, dash: "dashed"),',
    );
  });

  it("bends curved edges toward the handles they leave and enter", () => {
    const below = node({ id: "below", x: 160, y: 160, label: "D" });
    const edges = [
      edge({ source: "a", target: "r", routing: "curved", sourceHandle: "r", targetHandle: "l" }),
      edge({ source: "a", target: "r", routing: "curved", sourceHandle: "t", targetHandle: "t" }),
      edge({ source: "a", target: "r", routing: "curved", sourceHandle: "b", targetHandle: "b", label: "under" }),
      edge({ source: "a", target: "below", routing: "curved", sourceHandle: "r", targetHandle: "t" }),
      edge({ source: "a", target: "below", routing: "curved" }),
    ];
    expect(bodyLines(modelToFletcher(model([A, RIGHT, below], edges))).slice(3)).toEqual([
      '  edge(<a>, <r>, "-|>"),',
      '  edge(<a>, <r>, "-|>", bend: 61deg),',
      '  edge(<a>, <r>, "-|>", [under], label-side: center, bend: -61deg),',
      '  edge(<a>, <below>, "-|>", bend: 45deg),',
      '  edge(<a>, <below>, "-|>"),',
    ]);
  });

  it("routes orthogonal edges through the corners the TikZ writer uses", () => {
    const target = node({ id: "t", x: 200, y: 120, label: "T" });
    const edges = [
      edge({ source: "a", target: "t", routing: "orthogonal" }),
      edge({ source: "a", target: "t", routing: "orthogonal", label: "mid", arrow: "both" }),
      edge({ source: "a", target: "b", routing: "orthogonal" }),
    ];
    expect(bodyLines(modelToFletcher(model([A, B, target], edges))).slice(3)).toEqual([
      '  edge(<a>, (1cm, -2cm), (6cm, -2cm), <t>, "-|>", corner-radius: 0.125cm),',
      '  edge(<a>, (1cm, -2cm), (6cm, -2cm), <t>, "<|-|>", [mid], label-side: center, label-pos: 0.5, corner-radius: 0.125cm),',
      '  edge(<a>, <b>, "-|>"),',
    ]);
  });

  it("places an orthogonal label on the segment the router chose", () => {
    const target = node({ id: "t", x: 200, y: 200, label: "T" });
    const edges = [
      edge({ source: "a", target: "t", routing: "orthogonal", sourceHandle: "r", targetHandle: "t", label: "L" }),
    ];
    const line = bodyLines(modelToFletcher(model([A, target], edges)))[2];
    expect(line).toBe('  edge(<a>, (6cm, -0.5cm), <t>, "-|>", [L], label-side: center, label-pos: 0.7222, corner-radius: 0.125cm),');
  });

  it("draws a loop for an edge from a node to itself", () => {
    const edges = [edge({ source: "a", target: "a", routing: "orthogonal" })];
    expect(bodyLines(modelToFletcher(model([A], edges)))[1]).toBe('  edge(<a>, <a>, "-|>", bend: 130deg),');
  });

  it("skips edges whose ends are missing", () => {
    const edges = [edge({ source: "a", target: "gone" }), edge({ source: "gone", target: "a" })];
    expect(bodyLines(modelToFletcher(model([A], edges)))).toHaveLength(1);
  });

  it("turns node ids into unique Typst labels and keeps edges pointing at them", () => {
    const nodes = [
      node({ id: "my node" }),
      node({ id: "my-node" }),
      node({ id: "1st" }),
      node({ id: "" }),
      node({ id: "émoji✨" }),
    ];
    const edges = [edge({ source: "my-node", target: "1st" }), edge({ source: "my node", target: "" })];
    const lines = bodyLines(modelToFletcher(model(nodes, edges)));
    expect(lines.slice(0, 5).map((line) => /name: (<[^>]*>)/.exec(line)?.[1])).toEqual([
      "<my-node>",
      "<my-node-2>",
      "<n-1st>",
      "<node>",
      "<moji>",
    ]);
    expect(lines.slice(5)).toEqual(['  edge(<my-node-2>, <n-1st>, "-|>"),', '  edge(<my-node>, <node>, "-|>"),']);
  });

  it("escapes labels as Typst markup", () => {
    const cases: Array<[string, string]> = [
      ["plain words", "plain words"],
      ["x_1 *b* #f $m$ <l> @r [x] `c` \\ \"q\" ~", 'x\\_1 \\*b\\* \\#f \\$m\\$ \\<l\\> \\@r \\[x\\] \\`c\\` \\\\ \\"q\\" \\~'],
      ["- item", "\\- item"],
      ["+ item", "\\+ item"],
      ["/ term", "\\/ term"],
      ["== Head", "\\== Head"],
      ["12. step", "12\\. step"],
      ["a // b /* c", "a \\// b \\/\\* c"],
      ["two\nlines", "two lines"],
      ["-5 and =x", "-5 and =x"],
    ];
    for (const [label, escaped] of cases) {
      const lines = bodyLines(modelToFletcher(model([node({ id: "n", label })], [])));
      expect(lines[0]).toContain(`text(size: 10pt)[${escaped}], name: <n>`);
    }
    const edges = [edge({ source: "a", target: "b", label: "a]b" })];
    expect(bodyLines(modelToFletcher(model([A, B], edges)))[2]).toContain("[a\\]b]");
  });

  it("wraps the diagram in a filled box when the model has a background", () => {
    expect(modelToFletcher(model([A], [], "#FFEEDD"))).toBe(
      [
        fletcherImport("0.5.8"),
        '#box(fill: rgb("#ffeedd"), inset: 4pt, diagram(',
        ...PREAMBLE,
        "  node((1cm, -0.5cm), text(size: 10pt)[A], name: <a>, width: 2cm, height: 1cm, shape: rect),",
        "))",
      ].join("\n"),
    );
    expect(modelToFletcher(model([A], [], ""))).toContain("\n#diagram(");
    expect(modelToFletcher(model([A], [], "nope"))).toContain("\n#diagram(");
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

describe("generated fletcher compiles", () => {
  it.skipIf(!NETWORK)(
    "compiles every shape, style and routing with the bundled Typst",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "oleafly-fletcher-"));
      const cache = process.env.TYPST_PACKAGE_CACHE_PATH ?? path.join(dir, "cache");
      mkdirSync(cache, { recursive: true });
      const target = node({ id: "t", x: 200, y: 200, label: "T", shape: "diamond", fill: "#eef2c3", stroke: "#1e293b" });
      const diagrams: Record<string, DiagramModel> = {
        empty: model([]),
        shapes: model(
          [
            node({ id: "a", label: "Rect & [x]", fill: "#cfe8f8", stroke: "#1e293b", strokeStyle: "dashed" }),
            node({ id: "b", x: 160, shape: "roundrect", label: "- Rounded", stroke: "#1e293b" }),
            node({ id: "c", y: 120, shape: "circle", w: 40, h: 40, label: "+", stroke: "#1e293b", strokeStyle: "dotted" }),
            node({ id: "d", x: 160, y: 120, shape: "ellipse", label: "Ellipse", fontFamily: "mono" }),
            node({ id: "e", y: 240, shape: "parallelogram", w: 120, label: "I/O", stroke: "#1e293b", fontFamily: "sans" }),
            node({ id: "f", x: 160, y: 240, shape: "text", label: "$E = m c^2$", textColor: "#b91c1c", fontSize: 12 }),
            node({ id: "g", x: -40, y: -40, w: 320, h: 360, shape: "roundrect", radius: 16, fill: "#e9e9ec" }),
          ],
          [
            edge({ source: "a", target: "b", label: "1. go", routing: "curved", sourceHandle: "t", targetHandle: "t" }),
            edge({ source: "a", target: "c", arrow: "both", style: "dotted" }),
            edge({ source: "b", target: "d", arrow: "none", style: "dashed", routing: "orthogonal", sourceHandle: "r", targetHandle: "r" }),
            edge({ source: "c", target: "e", routing: "orthogonal", label: "down", sourceHandle: "l", targetHandle: "l" }),
            edge({ source: "e", target: "f", routing: "curved", sourceHandle: "r", targetHandle: "t" }),
            edge({ source: "f", target: "f" }),
          ],
          "#ffffff",
        ),
        routed: model(
          [A, target],
          [edge({ source: "a", target: "t", routing: "orthogonal", sourceHandle: "r", targetHandle: "t", label: "L" })],
        ),
      };
      const typst = typstSidecar();
      const env = { ...process.env, TYPST_PACKAGE_CACHE_PATH: cache };
      const typstVersion = /\d+\.\d+\.\d+/.exec(
        execFileSync(typst, ["--version"], { env, encoding: "utf8", timeout: 30_000 }),
      )?.[0];
      for (const [name, diagram] of Object.entries(diagrams)) {
        const file = path.join(dir, `${name}.typ`);
        writeFileSync(file, `#set page(width: auto, height: auto, margin: 8pt)\n${modelToFletcher(diagram, { typstVersion })}\n`);
        const pdf = path.join(dir, `${name}.pdf`);
        execFileSync(typst, ["compile", file, pdf], { env, stdio: "pipe", timeout: 120_000 });
        expect(existsSync(pdf)).toBe(true);
      }
    },
    600_000,
  );
});
