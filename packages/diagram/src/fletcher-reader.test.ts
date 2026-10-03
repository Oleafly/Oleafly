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

describe("readFletcher number and text forms", () => {
  it("reads decimal, leading-dot and exponent lengths and angles", () => {
    const source = [
      "#diagram(",
      "  node((0, 0), [A], name: <a>, width: .5cm, height: 1.25cm),",
      "  node((1, 0), [B], name: <b>, width: 2e1pt, height: 10mm),",
      "  node((2, 0), [C], name: <c>, width: 1.5em, height: 0.5in),",
      '  edge(<a>, <b>, "->", bend: .25turn),',
      '  edge(<b>, <c>, "->", bend: -1.5rad),',
      '  edge(<c>, <a>, "->", bend: 45deg),',
      ")",
    ].join("\n");
    const { model } = read(source);
    expect(model?.nodes.map((n) => [n.w, n.h])).toEqual([
      [20, 50],
      [28.222222222222225, 40],
      [23.283333333333335, 50.8],
    ]);
    expect(model?.edges.map((e) => [e.routing, e.sourceHandle, e.targetHandle])).toEqual([
      ["straight", undefined, undefined],
      ["curved", "b", "b"],
      ["curved", "b", "r"],
    ]);
  });

  it("leaves a length with a trailing dot unread", () => {
    const source = "#diagram(\n  node((0, 0), [A], name: <a>, width: 12cm),\n  node((1, 0), [B], name: <b>, width: 3.cm),\n)";
    expect(read(source).model?.nodes.map((n) => n.w)).toEqual([480, 40]);
  });

  it("joins label lines with one space and trims the spaces around each break", () => {
    const source = "#diagram(\n  node((0, 0), [Two  \n   lines \t\r\n\n  here], name: <a>),\n  node((1,0), text(size: 9pt)[x  \n  y], name: <b>),\n)";
    expect(read(source).model?.nodes.map((n) => n.label)).toEqual(["Two lines  here", "x y"]);
  });
});

describe("readFletcher styling, shapes and edge forms", () => {
  const noteCodes = (notes: { code: string; detail?: string }[]) => notes.map((n) => (n.detail ? `${n.code}:${n.detail}` : n.code));

  it("reads colour literals, channels and adjusted colours", () => {
    const source = [
      "#diagram(",
      "  node((0, 0), [A], name: <a>, fill: rgb(\"#abc\")),",
      "  node((1, 0), [B], name: <b>, fill: rgb(10%, 20, 30)),",
      "  node((2, 0), [C], name: <c>, fill: rgb(1, 2, 3, 50%)),",
      "  node((3, 0), [D], name: <d>, fill: luma(128)),",
      "  node((4, 0), [E], name: <e>, fill: red.lighten(20%)),",
      "  node((5, 0), [F], name: <f>, fill: gray.lighter),",
      "  node((6, 0), [G], name: <g>, fill: rgb(\"#zz\")),",
      "  node((7, 0), [H], name: <h>, fill: none, stroke: none),",
      "  node((8, 0), [I], name: <i>, fill: teal),",
      ")",
    ].join("\n");
    const result = read(source);
    expect(result.model?.nodes).toEqual([
      { id: "a", shape: "rectangle", x: -20, y: -15, w: 40, h: 30, label: "A", fontSize: 11, fill: "#aabbcc" },
      { id: "b", shape: "rectangle", x: 90, y: -15, w: 40, h: 30, label: "B", fontSize: 11, fill: "#1a141e" },
      { id: "c", shape: "rectangle", x: 200, y: -15, w: 40, h: 30, label: "C", fontSize: 11, fill: "#010203" },
      { id: "d", shape: "rectangle", x: 310, y: -15, w: 40, h: 30, label: "D", fontSize: 11, fill: "#808080" },
      { id: "e", shape: "rectangle", x: 420, y: -15, w: 40, h: 30, label: "E", fontSize: 11, fill: "#ff4136" },
      { id: "f", shape: "rectangle", x: 530, y: -15, w: 40, h: 30, label: "F", fontSize: 11, fill: "#aaaaaa" },
      { id: "g", shape: "rectangle", x: 640, y: -15, w: 40, h: 30, label: "G", fontSize: 11 },
      { id: "h", shape: "text", x: 750, y: -15, w: 40, h: 30, label: "H", fontSize: 11, fill: "" },
      { id: "i", shape: "rectangle", x: 860, y: -15, w: 40, h: 30, label: "I", fontSize: 11, fill: "#39cccc" },
    ]);
    expect(noteCodes(result.notes)).toEqual(["gridCoordinates", "estimatedSize", "colorAdjustments", "colorExpressions"]);
  });

  it("reads stroke lengths, sums and dictionaries", () => {
    const source = [
      "#diagram(",
      "  node((0, 0), [A], name: <a>, stroke: 2pt + red),",
      "  node((1, 0), [B], name: <b>, stroke: red + 2pt),",
      "  node((2, 0), [C], name: <c>, stroke: (paint: blue, thickness: 1.5pt, dash: \"dashed\", cap: \"round\")),",
      "  node((3, 0), [D], name: <d>, stroke: (paint: blue, dash: \"dash-dotted\")),",
      "  node((4, 0), [E], name: <e>, stroke: (paint: oops)),",
      "  node((5, 0), [F], name: <f>, stroke: (thickness: auto)),",
      "  node((6, 0), [G], name: <g>, stroke: (dash: none, miter-limit: 2)),",
      "  node((7, 0), [H], name: <h>, stroke: auto),",
      "  node((8, 0), [I], name: <i>, stroke: 1pt),",
      "  node((9, 0), [J], name: <j>, stroke: (dash: \"loosely-dotted\")),",
      "  node((10, 0), [K], name: <k>, stroke: (dash: 5)),",
      "  node((11, 0), [L], name: <l>, stroke: 2pt + 3pt + red),",
      ")",
    ].join("\n");
    const result = read(source);
    expect(result.model?.nodes).toEqual([
      { id: "a", shape: "rectangle", x: -20, y: -15, w: 40, h: 30, label: "A", fontSize: 11, stroke: "#ff4136", strokeWidth: 2.822 },
      { id: "b", shape: "rectangle", x: 90, y: -15, w: 40, h: 30, label: "B", fontSize: 11, stroke: "#ff4136", strokeWidth: 2.822 },
      { id: "c", shape: "rectangle", x: 200, y: -15, w: 40, h: 30, label: "C", fontSize: 11, stroke: "#0074d9", strokeWidth: 2.117, strokeStyle: "dashed" },
      { id: "d", shape: "rectangle", x: 310, y: -15, w: 40, h: 30, label: "D", fontSize: 11, stroke: "#0074d9", strokeWidth: 1.411, strokeStyle: "dotted" },
      { id: "e", shape: "rectangle", x: 420, y: -15, w: 40, h: 30, label: "E", fontSize: 11 },
      { id: "f", shape: "rectangle", x: 530, y: -15, w: 40, h: 30, label: "F", fontSize: 11 },
      { id: "g", shape: "rectangle", x: 640, y: -15, w: 40, h: 30, label: "G", fontSize: 11, stroke: "#000000", strokeWidth: 1.411 },
      { id: "h", shape: "rectangle", x: 750, y: -15, w: 40, h: 30, label: "H", fontSize: 11 },
      { id: "i", shape: "rectangle", x: 860, y: -15, w: 40, h: 30, label: "I", fontSize: 11, stroke: "#000000", strokeWidth: 1.411 },
      { id: "j", shape: "rectangle", x: 970, y: -15, w: 40, h: 30, label: "J", fontSize: 11, stroke: "#000000", strokeWidth: 1.411, strokeStyle: "dotted" },
      { id: "k", shape: "rectangle", x: 1080, y: -15, w: 40, h: 30, label: "K", fontSize: 11, stroke: "#000000", strokeWidth: 1.411, strokeStyle: "dashed" },
      { id: "l", shape: "rectangle", x: 1190, y: -15, w: 40, h: 30, label: "L", fontSize: 11, stroke: "#000000", strokeWidth: 1.411 },
    ]);
    expect(noteCodes(result.notes)).toEqual(["gridCoordinates", "estimatedSize", "strokeStyles"]);
  });

  it("reads styled text labels and other label forms", () => {
    const source = [
      "#diagram(",
      "  node((0, 0), text(size: 9pt, fill: red, font: \"Courier New\")[x], name: <a>),",
      "  node((1, 0), text(font: \"Helvetica\")[y], name: <b>),",
      "  node((2, 0), text(font: \"Times\")[z], name: <c>),",
      "  node((3, 0), text(red)[p], name: <d>),",
      "  node((4, 0), text(weight: \"bold\")[w], name: <e>),",
      "  node((5, 0), text(size: auto)[s], name: <f>),",
      "  node((6, 0), text(font: (\"A\", \"B\"))[f], name: <g>),",
      "  node((7, 0), text(fill: red.darken(10%))[q], name: <h>),",
      "  node((8, 0), $x^2$, name: <i>),",
      "  node((9, 0), \"plain\", name: <j>),",
      String.raw`  node((10, 0), [*bold* \u{41}], name: <k>),`,
      "  node((11, 0), label: [named], pos: (11, 1), name: <l>),",
      "  node((12, 0), text(font: \"DejaVu Sans Mono\")[m], name: <m>),",
      "  node((13, 0), text(font: \"Arial\")[n], name: <n>),",
      ")",
    ].join("\n");
    const result = read(source);
    expect(result.model?.nodes).toEqual([
      { id: "a", shape: "rectangle", x: -20, y: -15, w: 40, h: 30, label: "x", fontSize: 9, textColor: "#ff4136", fontFamily: "mono" },
      { id: "b", shape: "rectangle", x: 90, y: -15, w: 40, h: 30, label: "y", fontFamily: "sans" },
      { id: "c", shape: "rectangle", x: 200, y: -15, w: 40, h: 30, label: "z" },
      { id: "d", shape: "rectangle", x: 310, y: -15, w: 40, h: 30, label: "p" },
      { id: "e", shape: "rectangle", x: 420, y: -15, w: 40, h: 30, label: "w" },
      { id: "f", shape: "rectangle", x: 530, y: -15, w: 40, h: 30, label: "s" },
      { id: "g", shape: "rectangle", x: 640, y: -15, w: 40, h: 30, label: "f" },
      { id: "h", shape: "rectangle", x: 750, y: -15, w: 40, h: 30, label: "q", textColor: "#ff4136" },
      { id: "i", shape: "rectangle", x: 852.5, y: -15, w: 55, h: 30, label: "$x^2$", fontSize: 11 },
      { id: "j", shape: "rectangle", x: 962.5, y: -15, w: 55, h: 30, label: "plain", fontSize: 11 },
      { id: "k", shape: "rectangle", x: 1062, y: -15, w: 76, h: 30, label: "*bold* A", fontSize: 11 },
      { id: "l", shape: "rectangle", x: 1182.5, y: 65, w: 55, h: 30, label: "named", fontSize: 11 },
      { id: "m", shape: "rectangle", x: 1300, y: -15, w: 40, h: 30, label: "m", fontFamily: "mono" },
      { id: "n", shape: "rectangle", x: 1410, y: -15, w: 40, h: 30, label: "n", fontFamily: "sans" },
    ]);
    expect(noteCodes(result.notes)).toEqual(["gridCoordinates", "formattedLabels", "estimatedSize"]);
  });

  it("reads shapes, sizes and unplaced nodes", () => {
    const source = [
      "#diagram(",
      "  node((0, 0), [A], name: <a>, radius: 1cm),",
      "  node((1, 0), [B], name: <b>, shape: pill),",
      "  node((2, 0), [C], name: <c>, shape: fletcher.shapes.hexagon),",
      "  node((3, 0), [D], name: <d>, corner-radius: 3pt),",
      "  node((4, 0), [E], name: <e>, stroke: none),",
      "  node((5, 0), [F], name: <f>, shape: circle, width: 2cm, height: 1cm),",
      "  node((6, 0), [G], name: <g>, shape: circle),",
      "  node((7, 0), [H], name: <h>, radius: 5mm, shape: rect),",
      "  node((8, 0), [I], name: <i>, shape: shapes.diamond.with(fit: 0)),",
      "  node(enclose: (<a>, <b>)),",
      "  node((0, 0), [x], [y], [z]),",
      "  node((9, 0), [Trailing],),",
      "  node((10cm, 2cm)),",
      "  node([no pos]),",
      "  node((11, 0), [Pill], shape: pill, corner-radius: 2pt),",
      ")",
    ].join("\n");
    const result = read(source);
    expect(result.model?.nodes).toEqual([
      { id: "a", shape: "circle", x: -40, y: -40, w: 80, h: 80, label: "A", fontSize: 11 },
      { id: "b", shape: "roundrect", x: 90, y: -15, w: 40, h: 30, label: "B", fontSize: 11, radius: 15 },
      { id: "c", shape: "rectangle", x: 200, y: -15, w: 40, h: 30, label: "C", fontSize: 11 },
      { id: "d", shape: "roundrect", x: 310, y: -15, w: 40, h: 30, label: "D", fontSize: 11, radius: 4.233 },
      { id: "e", shape: "text", x: 420, y: -15, w: 40, h: 30, label: "E", fontSize: 11 },
      { id: "f", shape: "circle", x: 510, y: -40, w: 80, h: 80, label: "F", fontSize: 11 },
      { id: "g", shape: "circle", x: 640, y: -20, w: 40, h: 40, label: "G", fontSize: 11 },
      { id: "h", shape: "rectangle", x: 750, y: -20, w: 40, h: 40, label: "H", fontSize: 11 },
      { id: "i", shape: "diamond", x: 860, y: -15, w: 40, h: 30, label: "I", fontSize: 11 },
      { id: "node-2", shape: "rectangle", x: 952, y: -15, w: 76, h: 30, label: "Trailing", fontSize: 11 },
      { id: "node-3", shape: "rectangle", x: 380, y: -95, w: 40, h: 30, label: "" },
      { id: "node-5", shape: "roundrect", x: 1186, y: -15, w: 48, h: 30, label: "Pill", fontSize: 11, radius: 2.822 },
    ]);
    expect(result.extras?.items).toEqual([
      "node(enclose: (<a>, <b>))",
      "node((0, 0), [x], [y], [z])",
      "node([no pos])",
    ]);
    expect(noteCodes(result.notes)).toEqual(["gridCoordinates", "unknownShapes", "estimatedSize", "unplacedNode"]);
  });

  it("reads edge endpoints, marks, flags, labels and bends", () => {
    const source = [
      "#diagram(",
      "  node((0, 0), [A], name: <a>),",
      "  node((2, 0), [B], name: <b>),",
      "  node((2, 2), [C], name: <c>),",
      "  edge((0, 0), (2, 0), \"->\"),",
      "  edge(<a>, \"r\", \"->\"),",
      "  edge(<a>, \"dd,rr\", \"-->\"),",
      "  edge(<a>, <b>, \"->\", left, [lab]),",
      "  edge(<a>, <b>, [lab], \"->\"),",
      "  edge(<a>, <b>, \"dashed\", \"wave\"),",
      "  edge(<a>, <b>, marks: \"<->\", label: [x], bend: 20deg, dash: \"dotted\"),",
      "  edge(<a>, <b>, dash: \"densely-dotted\"),",
      "  edge(<a>, <b>, \"<-\"),",
      "  edge(<a>, <c>, \"->\", vertices: ((0, 2),)),",
      "  edge(<a>, (1, 1), (1, 3), <c>, \"->\"),",
      "  edge(<a>, (0, 2), <c>, \"<-\"),",
      "  edge(<zz>, <b>),",
      "  edge(<a>, <b>, \"x->\", stroke: red),",
      "  edge(<a>, <b>, \"|=|\"),",
      "  edge(<a>, <b>, \"-->\"),",
      "  edge(<a>, <b>, \"..\"),",
      "  edge(<a>, <b>, \"->-\"),",
      "  edge(<a>, <b>, \"-\", \"dotted\"),",
      "  edge(<a>, <b>, arrow.r),",
      "  edge(<b>, <b>, \"->\", bend: 130deg),",
      "  edge(<a>, <c>, \"->\", bend: -40deg),",
      "  edge(<b>, <a>, \"<->\", bend: 1rad),",
      "  edge(\"->\"),",
      "  edge(<a>, auto, \"->\"),",
      "  edge(<a>, <b>, \"->\", [one], [two]),",
      "  edge(<a>, <b>, \"->\", label-side: right, label-pos: 0.2),",
      "  edge(<c>, \"u\", \"l\", \"->\"),",
      "  edge(<a>, <c>, \"->\", vertices: ((1, 0), (1, 2))),",
      "  edge(<c>, <a>, \"<-\", vertices: ((1, 2), (1, 0))),",
      "  edge(\"r\", \"->\"),",
      ")",
    ].join("\n");
    const result = read(source);
    expect(result.model?.nodes).toEqual([
      { id: "a", shape: "rectangle", x: -20, y: -15, w: 40, h: 30, label: "A", fontSize: 11 },
      { id: "b", shape: "rectangle", x: 200, y: -15, w: 40, h: 30, label: "B", fontSize: 11 },
      { id: "c", shape: "rectangle", x: 200, y: 145, w: 40, h: 30, label: "C", fontSize: 11 },
    ]);
    expect(result.model?.edges).toEqual([
      { id: "edge", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid" },
      { id: "edge-1", source: "a", target: "c", routing: "orthogonal", arrow: "forward", style: "dashed", sourceHandle: "b", targetHandle: "l" },
      { id: "edge-2", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid", label: "lab" },
      { id: "edge-3", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid", label: "lab" },
      { id: "edge-4", source: "a", target: "b", routing: "straight", arrow: "none", style: "dashed" },
      { id: "edge-5", source: "a", target: "b", routing: "curved", arrow: "both", style: "dotted", label: "x", sourceHandle: "r", targetHandle: "l" },
      { id: "edge-6", source: "a", target: "b", routing: "straight", arrow: "none", style: "dotted" },
      { id: "edge-7", source: "b", target: "a", routing: "straight", arrow: "forward", style: "solid" },
      { id: "edge-8", source: "a", target: "c", routing: "straight", arrow: "forward", style: "solid" },
      { id: "edge-9", source: "c", target: "a", routing: "orthogonal", arrow: "forward", style: "solid", sourceHandle: "l", targetHandle: "b" },
      { id: "edge-10", source: "a", target: "b", routing: "straight", arrow: "both", style: "solid" },
      { id: "edge-11", source: "a", target: "b", routing: "straight", arrow: "both", style: "solid" },
      { id: "edge-12", source: "a", target: "b", routing: "straight", arrow: "forward", style: "dashed" },
      { id: "edge-13", source: "a", target: "b", routing: "straight", arrow: "none", style: "dotted" },
      { id: "edge-14", source: "a", target: "b", routing: "straight", arrow: "none", style: "solid" },
      { id: "edge-15", source: "a", target: "b", routing: "straight", arrow: "none", style: "dotted" },
      { id: "edge-16", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid" },
      { id: "edge-17", source: "b", target: "b", routing: "curved", arrow: "forward", style: "solid" },
      { id: "edge-18", source: "a", target: "c", routing: "curved", arrow: "forward", style: "solid", sourceHandle: "b", targetHandle: "l" },
      { id: "edge-19", source: "b", target: "a", routing: "curved", arrow: "both", style: "solid", sourceHandle: "b", targetHandle: "b" },
      { id: "edge-20", source: "a", target: "b", routing: "straight", arrow: "forward", style: "solid" },
    ]);
    expect(result.extras?.items).toEqual([
      "edge(<a>, <b>, \"->\", [one], [two])",
      "edge(<a>, \"r\", \"->\")",
      "edge(<a>, <c>, \"->\", vertices: ((0, 2),))",
      "edge(<zz>, <b>)",
      "edge(\"->\")",
      "edge(<a>, auto, \"->\")",
      "edge(<c>, \"u\", \"l\", \"->\")",
      "edge(<a>, <c>, \"->\", vertices: ((1, 0), (1, 2)))",
      "edge(<c>, <a>, \"<-\", vertices: ((1, 2), (1, 0)))",
      "edge(\"r\", \"->\")",
    ]);
    expect(noteCodes(result.notes)).toEqual(["gridCoordinates", "estimatedSize", "edgeOption:wave", "strokeStyles", "arrowMarks", "unreadEdge", "danglingEdge", "freePoints"]);
  });

  it("reads background boxes, kept wrappers and diagram settings", () => {
    const body = '  node((0, 0), [A], name: <a>),\n  node((1, 0), [B], name: <b>),\n  edge(<a>, <b>, "->"),\n';
    const wrapped = (open: string, close: string) => read(`${open}${body}${close}\n// after`);
    const cases = [
      ["#import \"@preview/fletcher:0.5.8\": diagram, node, edge, shapes\n#diagram(\n", ")"],
      ["#import \"@preview/fletcher:0.5.8\" as fl\n#box(fill: rgb(\"#ffeedd\"), inset: 4pt, fl.diagram(\n", "))"],
      ["#import \"@preview/fletcher:0.5.8\": *\n#align(center, diagram(\n", "))"],
      ["#box(fill: red, inset: 2pt, diagram(\n", "))"],
      ["#box(fill: red.lighten(5%), inset: 4pt, diagram(\n", "))"],
      ["#box(stroke: red, inset: 4pt, diagram(\n", "))"],
      ["#diagram(\n  spacing: 3em,\n  node-stroke: 1pt,\n  mystery: 2,\n", ")"],
    ];
    expect(
      cases.map(([open, close]) => {
        const result = wrapped(open, close);
        return {
          background: result.model?.background ?? null,
          open: result.extras?.open,
          close: result.extras?.close,
          imports: result.extras?.imports,
          diagramArgs: result.extras?.diagramArgs.map((arg) => arg.key),
          notes: noteCodes(result.notes),
        };
      }),
    ).toEqual([
      { background: null, open: null, close: null, imports: [], diagramArgs: [], notes: ["outsideCode", "gridCoordinates", "estimatedSize"] },
      { background: "#ffeedd", open: null, close: null, imports: ["#import \"@preview/fletcher:0.5.8\" as fl"], diagramArgs: [], notes: ["outsideCode", "gridCoordinates", "estimatedSize"] },
      { background: null, open: "#align(center, ", close: ")", imports: ["#import \"@preview/fletcher:0.5.8\": *"], diagramArgs: [], notes: ["outsideCode", "wrapper", "gridCoordinates", "estimatedSize"] },
      { background: null, open: "#box(fill: red, inset: 2pt, ", close: ")", imports: [], diagramArgs: [], notes: ["outsideCode", "wrapper", "gridCoordinates", "estimatedSize"] },
      { background: null, open: "#box(fill: red.lighten(5%), inset: 4pt, ", close: ")", imports: [], diagramArgs: [], notes: ["outsideCode", "wrapper", "gridCoordinates", "estimatedSize"] },
      { background: null, open: "#box(stroke: red, inset: 4pt, ", close: ")", imports: [], diagramArgs: [], notes: ["outsideCode", "wrapper", "gridCoordinates", "estimatedSize"] },
      { background: null, open: null, close: null, imports: [], diagramArgs: ["spacing", "node-stroke", "mystery"], notes: ["outsideCode", "diagramSetting:spacing", "diagramSetting:node-stroke", "diagramSetting:mystery", "gridCoordinates", "estimatedSize"] },
    ]);
  });
});

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
