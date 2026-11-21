import { describe, expect, it } from "vitest";
import { type FigureGridSpec, figureGridAt, figureGridColumns, figureGridRect, figureGridSource, readFigureGridMarker } from "./figure-grid";

const SAME = (path: string) => path;

function grid(count: number, columns: number, aspect = 4 / 3): FigureGridSpec["images"] {
  const images = Array.from({ length: count }, (_, index) => ({ path: `figures/img-${index}.png`, aspect }));
  const rows: FigureGridSpec["images"] = [];
  for (let start = 0; start < images.length; start += columns) rows.push(images.slice(start, start + columns));
  return rows;
}

function spec(overrides: Partial<FigureGridSpec> = {}): FigureGridSpec {
  return {
    images: grid(4, 2),
    columnLabels: ["(a) Input", "(b) Ours"],
    rowLabels: [],
    width: "column",
    caption: "Comparison.",
    label: "fig:comparison",
    ...overrides,
  };
}

function rowWidths(source: string, unit = "linewidth"): number[] {
  const value = String.raw`(-?[\d.]+)\\${unit}`;
  const box = new RegExp(String.raw`^\s*(?:\\makebox\[${value}\]|\\includegraphics\[width=${value}\])`, "u");
  const bound = new RegExp(String.raw`\\useasboundingbox \(0,[^)]*\) rectangle \(${value},`, "u");
  const gap = new RegExp(String.raw`\\hspace\{${value}\}`, "u");
  const rows: number[] = [];
  let sum = 0;
  let inPicture = false;
  for (const line of source.split("\n")) {
    if (line.includes(String.raw`\begin{tikzpicture}`)) inPicture = true;
    const width = inPicture ? bound.exec(line) : box.exec(line);
    if (width) sum += Number(width[1] ?? width[2]);
    if (line.includes(String.raw`\end{tikzpicture}`)) inPicture = false;
    if (inPicture) continue;
    const space = gap.exec(line);
    if (space) sum += Number(space[1]);
    if (/\\\\(?:\[[^\]]*\])?$/u.test(line) || (sum > 0 && !line.endsWith("%"))) {
      rows.push(sum);
      sum = 0;
    }
  }
  return rows;
}

function balanced(source: string, open: string, close: string): boolean {
  let depth = 0;
  for (const character of source.replaceAll(/\\./gu, "")) {
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

const ZOOM = { rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, placement: "right", color: "red!85!black" } as const;

describe("figureGridSource", () => {
  it("writes a captioned, labelled figure with headers and only graphicx", () => {
    const { source, packages } = figureGridSource(spec(), (path) => `../${path}`);
    const lines = source.split("\n");
    expect(lines[0]).toBe(String.raw`\begin{figure}[t]`);
    expect(lines[1]).toMatch(/^ {2}% oleafly-figure-grid-v1: [A-Za-z0-9_-]+$/u);
    expect(lines[2]).toBe(String.raw`  \centering`);
    expect(lines.slice(3, 5)).toEqual([
      String.raw`  \makebox[0.49\linewidth]{\footnotesize (a) Input}\hspace{0.01\linewidth}%`,
      String.raw`  \makebox[0.49\linewidth]{\footnotesize (b) Ours}\\`,
    ]);
    expect(lines.slice(5, 9)).toEqual([
      String.raw`  \includegraphics[width=0.49\linewidth]{../figures/img-0.png}\hspace{0.01\linewidth}%`,
      String.raw`  \includegraphics[width=0.49\linewidth]{../figures/img-1.png}\\[0.01\linewidth]`,
      String.raw`  \includegraphics[width=0.49\linewidth]{../figures/img-2.png}\hspace{0.01\linewidth}%`,
      String.raw`  \includegraphics[width=0.49\linewidth]{../figures/img-3.png}`,
    ]);
    expect(lines.slice(-3)).toEqual([String.raw`  \caption{Comparison.}`, String.raw`  \label{fig:comparison}`, String.raw`\end{figure}`]);
    expect(packages).toEqual(["graphicx"]);
    expect(source).not.toContain("tikz");
  });

  it("uses figure* and the text width for a page-wide grid", () => {
    const { source } = figureGridSource(spec({ width: "page" }), SAME);
    expect(source.startsWith(String.raw`\begin{figure*}[t]`)).toBe(true);
    expect(source.endsWith(String.raw`\end{figure*}`)).toBe(true);
    expect(source).toContain(String.raw`\includegraphics[width=0.49\textwidth]{figures/img-0.png}`);
    expect(source).not.toContain(String.raw`\linewidth`);
  });

  it("adds rotated row labels, pads a short last row and skips empty headers, caption and label", () => {
    const { source } = figureGridSource(
      spec({ images: grid(5, 3, 2), columnLabels: ["", "", ""], rowLabels: ["Scene 1", ""], caption: " ", label: "" }),
      SAME,
    );
    expect(source).not.toContain(String.raw`\footnotesize (`);
    expect(source).toContain(String.raw`\makebox[0.04\linewidth]{\rotatebox{90}{\makebox[0.1533\linewidth]{\footnotesize Scene 1}}}`);
    expect(source).toContain(String.raw`\makebox[0.04\linewidth]{\rotatebox{90}{\makebox[0.1533\linewidth]{\footnotesize }}}`);
    expect(source.split("\n").at(-2)).toBe(String.raw`  \makebox[0.3066\linewidth]{}`);
    expect(source).not.toContain(String.raw`\caption`);
    expect(source).not.toContain(String.raw`\label`);
  });

  it("keeps every row just under the line width", () => {
    for (const columns of [1, 2, 3, 4, 5, 6]) {
      for (const rowLabels of [[], ["A", "B"]]) {
        for (const zoom of [undefined, ZOOM, { ...ZOOM, placement: "below" as const }, { ...ZOOM, rect: { x: 0, y: 0, w: 0.9, h: 0.05 } }]) {
          const { source } = figureGridSource(spec({ images: grid(columns * 2 - 1, columns), rowLabels, zoom }), SAME);
          const widths = rowWidths(source);
          expect(widths.length).toBeGreaterThanOrEqual(2);
          for (const width of widths) {
            expect(width).toBeLessThanOrEqual(0.99 + 1e-9);
            expect(width).toBeGreaterThan(0.985);
          }
        }
      }
    }
  });

  it("draws the zoom box on each image and clips a scaled copy into the inset", () => {
    const { source, packages } = figureGridSource(
      spec({ images: [[{ path: "a.png", aspect: 1 }]], columnLabels: [], zoom: ZOOM }),
      SAME,
    );
    expect(packages).toEqual(["graphicx", "tikz"]);
    expect(source.split("\n").slice(3, 15)).toEqual([
      String.raw`  \begin{tikzpicture}`,
      String.raw`    \useasboundingbox (0,0) rectangle (0.99\linewidth,0.49\linewidth);`,
      String.raw`    \node[anchor=south west,inner sep=0] (img) at (0,0) {\includegraphics[width=0.49\linewidth]{a.png}};`,
      String.raw`    \begin{scope}[x={(img.south east)},y={(img.north west)}]`,
      String.raw`      \draw[red!85!black,thick] (0.25,0.25) rectangle (0.75,0.75);`,
      String.raw`    \end{scope}`,
      String.raw`    \begin{scope}`,
      String.raw`      \clip (0.5\linewidth,0) rectangle ++(0.49\linewidth,0.49\linewidth);`,
      String.raw`      \node[anchor=south west,inner sep=0] at (0.255\linewidth,-0.245\linewidth) {\includegraphics[width=0.98\linewidth]{a.png}};`,
      String.raw`    \end{scope}`,
      String.raw`    \draw[red!85!black,thick] (0.5\linewidth,0) rectangle ++(0.49\linewidth,0.49\linewidth);`,
      String.raw`  \end{tikzpicture}`,
    ]);
  });

  it("keeps a wide inset no wider than its image and lines it up with the image top", () => {
    const zoom = { rect: { x: 0, y: 0, w: 0.8, h: 0.2 }, placement: "right", color: "red" } as const;
    const { source } = figureGridSource(spec({ images: [[{ path: "a.png", aspect: 1 }]], columnLabels: [], zoom }), SAME);
    expect(source).toContain(String.raw`\includegraphics[width=0.49\linewidth]{a.png}`);
    expect(source).toContain(String.raw`\clip (0.5\linewidth,0.3675\linewidth) rectangle ++(0.49\linewidth,0.1225\linewidth);`);
  });

  it("puts the inset under the image when asked and keeps the output balanced", () => {
    const zoom = { rect: { x: 0.1, y: 0.6, w: 0.2, h: 0.4 }, placement: "below", color: "blue" } as const;
    const { source } = figureGridSource(spec({ images: grid(6, 3, 1.5), rowLabels: ["One", "Two"], zoom }), SAME);
    expect(source.match(/\\begin\{tikzpicture\}/gu)).toHaveLength(6);
    expect(source.match(/\\end\{tikzpicture\}/gu)).toHaveLength(6);
    expect(source.match(/\\begin\{scope\}/gu)).toHaveLength(12);
    expect(source.match(/\\end\{scope\}/gu)).toHaveLength(12);
    expect(balanced(source, "{", "}")).toBe(true);
    expect(balanced(source, "[", "]")).toBe(true);
    expect(balanced(source, "(", ")")).toBe(true);
    const single = figureGridSource(spec({ images: grid(2, 2, 1), columnLabels: [], zoom }), SAME).source;
    expect(single).toContain(String.raw`\useasboundingbox (0,-0.5\linewidth) rectangle (0.49\linewidth,0.49\linewidth);`);
    expect(single).toContain(String.raw`\clip (0.1225\linewidth,-0.5\linewidth) rectangle ++(0.245\linewidth,0.49\linewidth);`);
    expect(single).toContain(String.raw`at (0,-0.5\linewidth) {\includegraphics[width=1.225\linewidth]{figures/img-0.png}};`);
  });
});

describe("readFigureGridMarker", () => {
  it("round-trips the spec through the marker", () => {
    const original = spec({
      images: [[{ path: "figures/ü image.png", aspect: 1.7778 }, { path: "b.jpg", aspect: 0.5 }], [{ path: "c.pdf", aspect: 1 }]],
      columnLabels: ["(a) Entrée", String.raw`(b) $\alpha$`],
      rowLabels: ["Row"],
      width: "page",
      caption: String.raw`Zoom on the \emph{edges}, 100% crop.`,
      zoom: { rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 }, placement: "below", color: "teal" },
    });
    expect(readFigureGridMarker(figureGridSource(original, (path) => `x/${path}`).source)).toEqual(original);
    const plain = spec();
    expect(readFigureGridMarker(figureGridSource(plain, SAME).source)).toEqual(plain);
  });

  it("rejects missing, corrupt or unsafe markers", () => {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("=", "");
    const marker = (value: unknown) => `% oleafly-figure-grid-v1: ${encode(value)}`;
    expect(readFigureGridMarker(String.raw`\begin{figure}\includegraphics{a}\end{figure}`)).toBeNull();
    expect(readFigureGridMarker("% oleafly-figure-grid-v1: !!!")).toBeNull();
    expect(readFigureGridMarker("% oleafly-figure-grid-v1: bm90IGpzb24")).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), width: "huge" }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), images: [[{ path: "a.png", aspect: 0 }]] }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), images: [[{ path: "", aspect: 1 }]] }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), rowLabels: [1] }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), zoom: { ...ZOOM, color: "red]{x}" } }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), zoom: { ...ZOOM, rect: { x: 0.9, y: 0, w: 0.2, h: 0.2 } } }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), zoom: { ...ZOOM, rect: { x: 0, y: 0, w: 0.01, h: 0.2 } } }))).toBeNull();
    expect(readFigureGridMarker(marker({ ...spec(), zoom: { ...ZOOM, placement: "left" } }))).toBeNull();
    expect(readFigureGridMarker(marker(spec()))).toEqual(spec());
  });
});

describe("figureGridAt", () => {
  it("finds the whole grid environment around a position inside it", () => {
    const { source } = figureGridSource(spec({ width: "page" }), SAME);
    const doc = `Intro.\n\n${source}\n\nAfter.\n`;
    const from = doc.indexOf(String.raw`\begin{figure*}`);
    const to = doc.indexOf(String.raw`\end{figure*}`) + String.raw`\end{figure*}`.length;
    const inside = doc.indexOf("img-2.png");
    expect(figureGridAt(doc, inside)).toEqual({ from, to, spec: spec({ width: "page" }) });
    expect(figureGridAt(doc, from)).toMatchObject({ from, to });
    expect(figureGridAt(doc, to)).toMatchObject({ from, to });
    expect(figureGridAt(doc, 2)).toBeNull();
    expect(figureGridAt(doc, doc.length - 2)).toBeNull();
  });

  it("ignores ordinary figures and picks the grid that holds the position", () => {
    const first = figureGridSource(spec({ caption: "First" }), SAME).source;
    const second = figureGridSource(spec({ caption: "Second" }), SAME).source;
    const plain = String.raw`\begin{figure}[t]
  \centering
  \includegraphics{plain.png}
\end{figure}`;
    const doc = [first, plain, second].join("\n\n");
    expect(figureGridAt(doc, doc.indexOf("plain.png"))).toBeNull();
    expect(figureGridAt(doc, doc.lastIndexOf("img-1.png"))?.spec.caption).toBe("Second");
    expect(figureGridAt(doc, doc.indexOf("img-1.png"))?.spec.caption).toBe("First");
    expect(figureGridAt(`${first.slice(0, -12)}\n`, 40)).toBeNull();
  });
});

describe("figureGridRect", () => {
  it("normalizes a drag in any direction and clamps it to the image", () => {
    expect(figureGridRect({ x: 0.6, y: 0.7, }, { x: 0.2, y: 0.3 })).toEqual({ x: 0.2, y: 0.3, w: 0.4, h: 0.4 });
    expect(figureGridRect({ x: -0.5, y: 0.5 }, { x: 0.3, y: 1.4 })).toEqual({ x: 0, y: 0.5, w: 0.3, h: 0.5 });
  });

  it("keeps a minimum size inside the image for a click or a thin drag", () => {
    expect(figureGridRect({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5, w: 0.05, h: 0.05 });
    expect(figureGridRect({ x: 0.99, y: 1 }, { x: 0.999, y: 1 })).toEqual({ x: 0.95, y: 0.95, w: 0.05, h: 0.05 });
    expect(figureGridRect({ x: 0.123456, y: 0 }, { x: 0.654321, y: 0.01 })).toEqual({ x: 0.1235, y: 0, w: 0.5309, h: 0.05 });
  });
});

describe("figureGridColumns", () => {
  it("counts the widest row", () => {
    expect(figureGridColumns({ images: grid(5, 3) })).toBe(3);
    expect(figureGridColumns({ images: [] })).toBe(1);
  });
});
