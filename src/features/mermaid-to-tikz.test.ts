import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mermaidToFletcher, mermaidToTikz } from "./mermaid-to-tikz";

describe("mermaidToTikz", () => {
  it("converts labelled flowchart edges and common shapes", () => {
    const tikz = mermaidToTikz(`flowchart TD
      start([Start]) --> check{Ready?}
      check -->|Yes| done((Done))
      check -.->|No| start`);
    expect(tikz).toContain("rounded rectangle");
    expect(tikz).toContain("diamond, aspect=2");
    expect(tikz).toContain("node[midway");
    expect(tikz).toContain("dashed");
    expect(tikz).toContain("\\end{tikzpicture}");
  });

  it("escapes labels once", () => {
    const tikz = mermaidToTikz("flowchart LR\na[R&D 50%] --> b[result_1]");
    expect(tikz).toContain("R\\&D 50\\%");
    expect(tikz).toContain("result\\_1");
  });

  it("rejects non-flowchart Mermaid instead of returning broken TikZ", () => {
    expect(() => mermaidToTikz("sequenceDiagram\nA->>B: Hello")).toThrow(
      "Start the diagram",
    );
  });

  it("defers syntax it cannot preserve instead of returning a partial diagram", () => {
    expect(() => mermaidToTikz("flowchart TD\nsubgraph Group\nA --> B\nend")).toThrow(
      "rendered output",
    );
    expect(() => mermaidToTikz("flowchart LR\nA --> B --> C")).toThrow(
      "Chained Mermaid edges",
    );
    expect(() => mermaidToTikz("flowchart LR\nA[/Input/] --> B")).toThrow(
      "could not be read",
    );
    expect(() => mermaidToTikz("flowchart LR\nA --!> B")).toThrow("could not be read");
  });
});

const EVERY_SHAPE = `flowchart TD
  a[Box] --> b(Rounded)
  b -.->|maybe| c{Choice}
  c ==> d((Circle))
  c --- e([Stadium])`;

describe("mermaidToTikz output", () => {
  it("keeps its exact TikZ for every shape, edge style and direction", () => {
    expect(mermaidToTikz(EVERY_SHAPE)).toMatchInlineSnapshot(`
      "% Requires: \\usepackage{tikz}
      % The rounded-rectangle shape uses the shapes.misc library.
      \\usetikzlibrary{arrows.meta,shapes.geometric,shapes.misc}
      \\begin{tikzpicture}[>=Latex, every node/.style={font=\\small}]
        \\node[draw, align=center, inner sep=6pt] (n1) at (0.00,0.00) {Box};
        \\node[draw, align=center, inner sep=6pt, rounded corners=3pt] (n2) at (0.00,-2.40) {Rounded};
        \\node[draw, align=center, inner sep=6pt, diamond, aspect=2] (n3) at (0.00,-4.80) {Choice};
        \\node[draw, align=center, inner sep=6pt, circle] (n4) at (-2.10,-7.20) {Circle};
        \\node[draw, align=center, inner sep=6pt, rounded rectangle, rounded rectangle arc length=180] (n5) at (2.10,-7.20) {Stadium};
        \\draw[->] (n1) -- (n2);
        \\draw[->, dashed] (n2) -- node[midway, fill=white, inner sep=2pt] {maybe} (n3);
        \\draw[->, very thick] (n3) -- (n4);
        \\draw[-] (n3) -- (n5);
      \\end{tikzpicture}"
    `);
    expect(mermaidToTikz("graph LR\nstart([Start]) --> check{Ready?}\ncheck -->|Yes| done((Done))\ncheck -.->|No| start")).toMatchInlineSnapshot(`
      "% Requires: \\usepackage{tikz}
      % The rounded-rectangle shape uses the shapes.misc library.
      \\usetikzlibrary{arrows.meta,shapes.geometric,shapes.misc}
      \\begin{tikzpicture}[>=Latex, every node/.style={font=\\small}]
        \\node[draw, align=center, inner sep=6pt, rounded rectangle, rounded rectangle arc length=180] (n1) at (0.00,0.00) {Start};
        \\node[draw, align=center, inner sep=6pt, diamond, aspect=2] (n2) at (4.20,0.00) {Ready?};
        \\node[draw, align=center, inner sep=6pt, circle] (n3) at (8.40,0.00) {Done};
        \\draw[->] (n1) -- (n2);
        \\draw[->] (n2) -- node[midway, fill=white, inner sep=2pt] {Yes} (n3);
        \\draw[->, dashed] (n2) -- node[midway, fill=white, inner sep=2pt] {No} (n1);
      \\end{tikzpicture}"
    `);
    expect(mermaidToTikz("flowchart BT\na --> b\na --> c")).toMatchInlineSnapshot(`
      "% Requires: \\usepackage{tikz}
      % The rounded-rectangle shape uses the shapes.misc library.
      \\usetikzlibrary{arrows.meta,shapes.geometric,shapes.misc}
      \\begin{tikzpicture}[>=Latex, every node/.style={font=\\small}]
        \\node[draw, align=center, inner sep=6pt] (n1) at (0.00,0.00) {a};
        \\node[draw, align=center, inner sep=6pt] (n2) at (-2.10,2.40) {b};
        \\node[draw, align=center, inner sep=6pt] (n3) at (2.10,2.40) {c};
        \\draw[->] (n1) -- (n2);
        \\draw[->] (n1) -- (n3);
      \\end{tikzpicture}"
    `);
    expect(mermaidToTikz("flowchart RL\na --> b\nc")).toMatchInlineSnapshot(`
      "% Requires: \\usepackage{tikz}
      % The rounded-rectangle shape uses the shapes.misc library.
      \\usetikzlibrary{arrows.meta,shapes.geometric,shapes.misc}
      \\begin{tikzpicture}[>=Latex, every node/.style={font=\\small}]
        \\node[draw, align=center, inner sep=6pt] (n1) at (0.00,1.20) {a};
        \\node[draw, align=center, inner sep=6pt] (n2) at (-4.20,0.00) {b};
        \\node[draw, align=center, inner sep=6pt] (n3) at (0.00,-1.20) {c};
        \\draw[->] (n1) -- (n2);
      \\end{tikzpicture}"
    `);
  });
});

const IMPORT = '#import "@preview/fletcher:0.5.8": diagram, node, edge, shapes';

describe("mermaidToFletcher", () => {
  it("writes a top-down flowchart with every shape and edge style on the grid", () => {
    expect(mermaidToFletcher(EVERY_SHAPE, "0.5.8")).toBe(
      [
        IMPORT,
        "#diagram(",
        "  node-stroke: 0.4pt,",
        "  spacing: (4em, 3em),",
        "  node((0, 0), [Box], name: <n1>, shape: rect),",
        "  node((0, 1), [Rounded], name: <n2>, shape: rect, corner-radius: 3pt),",
        "  node((0, 2), [Choice], name: <n3>, shape: shapes.diamond),",
        "  node((-0.5, 3), [Circle], name: <n4>, shape: circle),",
        "  node((0.5, 3), [Stadium], name: <n5>, shape: shapes.pill),",
        '  edge(<n1>, <n2>, "-|>"),',
        '  edge(<n2>, <n3>, "-|>", [maybe], label-side: center, dash: "dashed"),',
        '  edge(<n3>, <n4>, "-|>", stroke: 1.2pt),',
        '  edge(<n3>, <n5>, "-"),',
        ")",
      ].join("\n"),
    );
  });

  it("writes a left-to-right flowchart and bends edges that run both ways", () => {
    expect(
      mermaidToFletcher(
        "graph LR\nstart([Start]) --> check{Ready?}\ncheck -->|Yes| done((Done))\ncheck -.->|No| start",
        "0.5.5",
      ),
    ).toBe(
      [
        '#import "@preview/fletcher:0.5.5": diagram, node, edge, shapes',
        "#diagram(",
        "  node-stroke: 0.4pt,",
        "  spacing: (4em, 3em),",
        "  node((0, 0), [Start], name: <n1>, shape: shapes.pill),",
        "  node((1, 0), [Ready?], name: <n2>, shape: shapes.diamond),",
        "  node((2, 0), [Done], name: <n3>, shape: circle),",
        '  edge(<n1>, <n2>, "-|>", bend: 25deg),',
        '  edge(<n2>, <n3>, "-|>", [Yes], label-side: center),',
        '  edge(<n2>, <n1>, "-|>", [No], label-side: center, dash: "dashed", bend: 25deg),',
        ")",
      ].join("\n"),
    );
  });

  it("honors every direction with y growing down", () => {
    const positions = (source: string) =>
      mermaidToFletcher(source, "0.5.8")
        .split("\n")
        .filter((line) => line.startsWith("  node(("))
        .map((line) => /node\((\([^)]*\))/.exec(line)?.[1]);
    expect(positions("flowchart TB\na --> b")).toEqual(["(0, 0)", "(0, 1)"]);
    expect(positions("flowchart BT\na --> b\na --> c")).toEqual(["(0, 0)", "(-0.5, -1)", "(0.5, -1)"]);
    expect(positions("flowchart LR\na --> b")).toEqual(["(0, 0)", "(1, 0)"]);
    expect(positions("flowchart RL\na --> b\nc")).toEqual(["(0, -0.5)", "(-1, 0)", "(0, 0.5)"]);
  });

  it("escapes labels as Typst markup and loops an edge back to its own node", () => {
    const output = mermaidToFletcher("flowchart LR\na[R&D 50% #1] -->|x_1| b[*y* <z>]\nb --> b", "0.5.8");
    expect(output).toContain("node((0, 0), [R&D 50% \\#1], name: <n1>, shape: rect)");
    expect(output).toContain("node((1, 0), [\\*y\\* \\<z\\>], name: <n2>, shape: rect)");
    expect(output).toContain('edge(<n1>, <n2>, "-|>", [x\\_1], label-side: center)');
    expect(output).toContain('edge(<n2>, <n2>, "-|>", bend: 130deg)');
  });

  it("rejects what mermaidToTikz rejects with the same messages", () => {
    const cases: Array<[string, string]> = [
      ["sequenceDiagram\nA->>B: Hello", "Start the diagram"],
      ["flowchart TD\nsubgraph Group\nA --> B\nend", "rendered output"],
      ["flowchart LR\nA --> B --> C", "Chained Mermaid edges"],
      ["flowchart LR\nA[/Input/] --> B", "could not be read"],
      ["flowchart LR\nA --!> B", "could not be read"],
    ];
    for (const [source, message] of cases) {
      expect(() => mermaidToTikz(source)).toThrow(message);
      expect(() => mermaidToFletcher(source, "0.5.8")).toThrow(message);
    }
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
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src-tauri/binaries", `typst-${triple}${suffix}`);
}

describe("generated Mermaid fletcher compiles", () => {
  it.skipIf(!NETWORK)(
    "compiles flowcharts in every direction with the bundled Typst",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "oleafly-mermaid-fletcher-"));
      const cache = process.env.TYPST_PACKAGE_CACHE_PATH ?? path.join(dir, "cache");
      mkdirSync(cache, { recursive: true });
      const env = { ...process.env, TYPST_PACKAGE_CACHE_PATH: cache };
      const sources = {
        td: EVERY_SHAPE,
        lr: "graph LR\nstart([Start]) --> check{Ready?}\ncheck -->|Yes| done((Done))\ncheck -.->|No| start\ndone --> done",
        bt: "flowchart BT\na[R&D #1] --> b(x_1)\na ==> c{*y*}",
        rl: "flowchart RL\na --> b\nc --- a",
      };
      for (const [name, source] of Object.entries(sources)) {
        const file = path.join(dir, `${name}.typ`);
        writeFileSync(file, `#set page(width: auto, height: auto, margin: 8pt)\n${mermaidToFletcher(source, "0.5.8")}\n`);
        const pdf = path.join(dir, `${name}.pdf`);
        execFileSync(typstSidecar(), ["compile", file, pdf], { env, stdio: "pipe", timeout: 120_000 });
        expect(existsSync(pdf)).toBe(true);
      }
    },
    600_000,
  );
});
