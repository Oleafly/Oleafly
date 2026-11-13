// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./tests/setup";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { base64ToBytes } from "@/lib/base64";
import { useSettingsStore } from "@/store/settings";
import { hasCitations, notePaperText, type PaperPlace, preambleTheorems } from "./note-to-paper";

const drawings = vi.hoisted(() => ({
  d2: vi.fn(async (_source: string, _theme: string) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'),
  tikz: vi.fn(async (_document: string) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5" width="5pt" height="5pt"><path d="M0 0"/></svg>'),
}));

vi.mock("./d2-render", async (load) => ({ ...(await load<typeof import("./d2-render")>()), renderD2: drawings.d2 }));
vi.mock("@/lib/tauri", async (load) => ({ ...(await load<typeof import("@/lib/tauri")>()), notesRenderTikz: drawings.tikz }));
vi.mock("smiles-drawer", () => ({
  default: {
    SvgDrawer: class {
      draw(tree: { smiles: string }) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("data-smiles", tree.smiles);
        return svg;
      }
    },
    Parser: { parse: (smiles: string) => ({ smiles }) },
  },
}));

const PNG = new Uint8Array([137, 80, 78, 71]);

function place(overrides: Partial<PaperPlace> = {}): PaperPlace {
  return { format: "latex", folder: "figures", from: "main.tex", taken: () => false, citations: { kind: "command" }, ...overrides };
}

async function sent(markdown: string, overrides: Partial<PaperPlace> = {}, files: Readonly<Record<string, Uint8Array>> = {}) {
  return notePaperText(markdown, async (path) => files[path] ?? null, place(overrides));
}

describe("a note's text on its way into a paper", () => {
  it("writes LaTeX citations as commands and keeps a prefix and a page", async () => {
    const { text } = await sent("Shown before [@he2022; @chen_2020] and again [see @he2022, p. 12].");
    expect(text).toContain("\\cite{he2022,chen_2020}");
    expect(text).toContain("see \\cite[p. 12]{he2022}");
  });

  it("leaves a citation as text when its key would break a LaTeX command", async () => {
    const { text } = await sent("Odd key [@a%b] here.");
    expect(text).not.toContain("\\cite");
    expect(text).toContain("a%b");
  });

  it("keeps citations a Typst paper knows and escapes the ones it does not", async () => {
    const known = (key: string) => key === "he2022";
    const { text } = await sent("Known [@he2022] and unknown [@ghost].", { format: "typst", from: "main.typ", citations: { kind: "keys", known } });
    expect(text).toContain("[@he2022]");
    expect(text).toContain("\\[\\@ghost\\]");
  });

  it("writes citations out as labels for an export, and leaves an unknown key alone", async () => {
    const entries = new Map([["he2022", { key: "he2022", label: "He 2022", fields: { author: "He, Kaiming", year: "2022" } }]]);
    const { text } = await sent("Known [@he2022, p. 3] and unknown [@ghost].", { format: "markdown", citations: { kind: "labels", entries } });
    expect(text).toContain("(He 2022, p. 3)");
    expect(text).toContain("[@ghost]");
  });

  it("drops highlights, note links and wikilinks but keeps their words and ordinary links", async () => {
    const { text } = await sent("Keep ==this== and [the plan](oleafly://note/p1), [[List#Part|the list]], [[Solo]] and [a site](https://example.org).");
    expect(text).toBe("Keep this and the plan, the list, Solo and [a site](https://example.org).");
  });

  it("writes superscript and subscript the way pandoc reads them", async () => {
    const { text } = await sent("H<sub>2</sub>O and x<sup>n 1</sup>.");
    expect(text).toContain("H~2~O");
    expect(text).toContain("x^n\\ 1^");
  });

  it("turns a callout into the paper's own theorem environment, or a quote with a bold title", async () => {
    const callout = "> [!theorem] Main result\n> Every mask leaks.";
    const theorems = preambleTheorems("\\newtheorem{theorem}{Theorem}\n\\begin{document}\n\\newtheorem{lemma}{Lemma}");
    expect([...theorems]).toEqual(["theorem"]);
    const latex = await sent(callout, { theorems });
    expect(latex.text).toContain("\\begin{theorem}[Main result]");
    expect(latex.text).toContain("\\end{theorem}");
    const quote = await sent(callout);
    expect(quote.text).toContain("> **Main result**");
    const untitled = await sent("> [!warning]\n> Careful.", { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } });
    expect(untitled.text).toContain(`> **${enNotes.kb.callouts.types.warning}**`);
  });

  it("copies an image under a free name and points at it from the file it lands in", async () => {
    const taken = (path: string) => path === "figures/loss.png";
    const { text, files } = await sent("![Loss curve](assets/loss.png)", { from: "chapters/results.tex", taken }, { "assets/loss.png": PNG });
    expect(files.map((file) => file.path)).toEqual(["figures/loss-2.png"]);
    expect(text).toContain("\\includegraphics[width=\\linewidth]{../figures/loss-2.png}");
    expect(text).toContain("\\caption{Loss curve}");
  });

  it("leaves the caption words when an image is missing, remote, or a kind LaTeX cannot include", async () => {
    const { text, files } = await sent("![Missing plot](assets/gone.png)\n\n![Remote](https://example.org/a.png)\n\n![Clip](assets/clip.gif)", {}, {
      "assets/clip.gif": PNG,
    });
    expect(files).toEqual([]);
    expect(text).toContain("Missing plot");
    expect(text).toContain("Remote");
    expect(text).toContain("Clip");
    expect(text).not.toContain("includegraphics");
  });

  it("embeds files as data for a single-file export", async () => {
    const { text, files } = await sent("![Loss](assets/loss.png)", { format: "markdown", inline: true, citations: { kind: "labels", entries: new Map() } }, {
      "assets/loss.png": PNG,
    });
    expect(files).toEqual([]);
    expect(text).toContain("data:image/png;base64,");
  });

  it("makes a LaTeX block display math and passes a Typst block through to a Typst paper only", async () => {
    const latex = await sent("```latex\nE = mc^2\n```");
    expect(latex.text).toContain("$$\nE = mc^2\n$$");
    const typst = "```typst\n#let x = 1\n```";
    const inTypst = await sent(typst, { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } });
    expect(inTypst.text).toContain("```{=typst}\n#let x = 1\n```");
    const inLatex = await sent(typst);
    expect(inLatex.text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "Typst"));
  });

  it("fences a Typst block that holds its own code fence with a longer one", async () => {
    const note = "````typst\n```rust\nfn main() {}\n```\n````";
    const { text } = await sent(note, { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } });
    expect(text).toContain("````{=typst}\n```rust\nfn main() {}\n```\n````");
  });

  it("says which block stayed behind, and leaves code alone", async () => {
    const { text } = await sent("```html\n<b>Live</b>\n```\n\n```python\nprint('[@he2022] ==x==')\n```\n\nInline `[@he2022]` stays.");
    expect(text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "HTML"));
    expect(text).not.toContain("<b>Live</b>");
    expect(text).toContain("print('[@he2022] ==x==')");
    expect(text).toContain("`[@he2022]`");
  });

  it("draws an SVG block as a figure file and refuses one that is not an image", async () => {
    const drawing = '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>\n```';
    const { text, files } = await sent(drawing, { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } });
    expect(files.map((file) => file.path)).toEqual(["figures/svg.svg"]);
    expect(text).toContain("](figures/svg.svg)");
    const broken = await sent("```svg\nnot an image\n```", { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } });
    expect(broken.files).toEqual([]);
    expect(broken.text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "SVG"));
  });

  it("sends TikZ to a LaTeX paper as its own source and asks for the packages it needs", async () => {
    const note = "```circuitikz\n\\usetikzlibrary{calc}\n\\draw (0,0) to[R] (2,0);\n```\n\n```tikz\n\\begin{tikzpicture}\\draw (0,0) -- (1,0);\\end{tikzpicture}\n```";
    const { text, files, packages } = await sent(note);
    expect(files).toEqual([]);
    expect(packages).toEqual([
      { name: "circuitikz", options: "" },
      { name: "tikz", options: "" },
    ]);
    expect(text).toContain("```{=latex}\n\\usetikzlibrary{calc}\n\\begin{figure}[htbp]\n  \\centering\n\\begin{circuitikz}\n\\draw (0,0) to[R] (2,0);\n\\end{circuitikz}\n\\end{figure}\n```");
    expect(text).toContain("\\begin{tikzpicture}\\draw (0,0) -- (1,0);\\end{tikzpicture}");
    expect(drawings.tikz).not.toHaveBeenCalled();
    const exported = await sent(note, { format: "markdown", rawLatex: true, citations: { kind: "labels", entries: new Map() } });
    expect(exported.text).toContain("\\begin{circuitikz}");
    expect(exported.packages).toHaveLength(2);
  });

  it("draws D2 and TikZ blocks as figure files for other papers and exports", async () => {
    const note = "```d2\na -> b\n```\n\n```tikz\n\\draw (0,0) -- (1,0);\n```";
    const typst = { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } } as const;
    const { text, files, packages } = await sent(note, typst);
    expect(files.map((file) => file.path)).toEqual(["figures/d2.svg", "figures/tikz.svg"]);
    expect(text).toContain("](figures/d2.svg)");
    expect(text).toContain("](figures/tikz.svg)");
    expect(packages).toEqual([]);
    expect(drawings.d2).toHaveBeenCalledWith("a -> b", "light");
    expect(drawings.tikz.mock.lastCall?.[0]).toContain("\\begin{tikzpicture}");
    drawings.tikz.mockRejectedValueOnce(new Error("no desktop"));
    const left = await sent("```circuitikz\n\\draw (0,0) to[R] (1,0);\n```", typst);
    expect(left.text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "CircuiTikZ"));
  });

  it("keeps the words of a D2 Markdown label in the exported figure", async () => {
    drawings.d2.mockResolvedValueOnce(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><script>alert(1)</script><g><foreignObject requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility" x="0" y="0" width="120" height="60"><div xmlns="http://www.w3.org/1999/xhtml" class="md"><h1>Hello</h1>\n<ul>\n<li>one</li>\n</ul>\n</div></foreignObject></g><text x="40" y="100">plain</text></svg>',
    );
    const typst = { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } } as const;
    const { files } = await sent("```d2\na: |md\n# Hello\n- one\n|\nb: plain\na -> b\n```", typst);
    const svg = new TextDecoder().decode(base64ToBytes(files[0]?.dataBase64 ?? ""));
    expect(svg).toContain("Hello");
    expect(svg).toContain("one");
    expect(svg).toContain("plain");
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("script");
  });

  it("leaves block ids out of the text it sends", async () => {
    const note = "First paragraph ^abc123\n\n- item one ^def456\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n^tab123\n\n## Head ^hd1\n\n```js\nx\n```\n\n^cb1";
    const { text } = await sent(note, { format: "markdown", citations: { kind: "labels", entries: new Map() } });
    expect(text).toContain("First paragraph");
    expect(text).toContain("- item one");
    expect(text).toContain("## Head");
    for (const id of ["abc123", "def456", "tab123", "hd1", "cb1"]) expect(text).not.toContain(id);
  });

  it("leaves a shared note's TikZ figure behind until it has been drawn here", async () => {
    drawings.tikz.mockClear();
    const typst = { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true }, shared: true } as const;
    const { text, files } = await sent("```tikz\n\\draw (0,0) -- (4,0);\n```", typst);
    expect(files).toEqual([]);
    expect(text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "TikZ"));
    expect(drawings.tikz).not.toHaveBeenCalled();
  });

  it("sends the shared TikZ preamble along with TikZ source", async () => {
    useSettingsStore.getState().setNotesAppearance("notesTikzPreamble", "\\usepackage{xcolor}\n\\usetikzlibrary{calc}");
    try {
      const { text, packages } = await sent("```tikz\n\\draw (0,0) -- (1,0);\n```");
      expect(packages).toEqual([
        { name: "tikz", options: "" },
        { name: "xcolor", options: "" },
      ]);
      expect(text).toContain("```{=latex}\n\\usetikzlibrary{calc}\n\\begin{figure}[htbp]");
    } finally {
      useSettingsStore.getState().setNotesAppearance("notesTikzPreamble", "");
    }
  });

  it("draws a chart's legend into its figure, so the series can be told apart in the paper", async () => {
    const chart = JSON.stringify({
      type: "line",
      categories: ["A", "B"],
      series: [
        { name: "Baseline run", values: [1, 2] },
        { name: "Masked run", values: [2, 3] },
      ],
    });
    const { files } = await sent(`\`\`\`chart\n${chart}\n\`\`\``, { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } });
    expect(files.map((file) => file.path)).toEqual(["figures/chart.svg"]);
    const figure = new DOMParser().parseFromString(atob(files[0].dataBase64), "image/svg+xml").documentElement;
    const labels = [...figure.querySelectorAll("text")].map((node) => node.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Baseline run", "Masked run"]));
    const [, , , height] = (figure.getAttribute("viewBox") ?? "").split(" ").map(Number);
    expect(height).toBeGreaterThan(280);
    expect(document.querySelector("[aria-hidden='true'].light")).toBeNull();
  });

  it("names the files of several figures one after another, in the order the note shows them", async () => {
    const note = [
      "![First](assets/plot.png)",
      "```smiles\nWater: O\nEthanol: CCO\n```",
      "> ![Quoted](assets/plot.png)",
      "```d2\na -> b\n```",
      "![Last](other/plot.png)",
    ].join("\n\n");
    const typst = { format: "typst", from: "main.typ", citations: { kind: "keys", known: () => true } } as const;
    const taken = (path: string) => path === "figures/plot.png";
    const { text, files } = await sent(note, { ...typst, taken }, { "assets/plot.png": PNG, "other/plot.png": PNG });
    expect(files.map((file) => file.path)).toEqual([
      "figures/plot-2.png",
      "figures/smiles.svg",
      "figures/smiles-2.svg",
      "figures/plot-3.png",
      "figures/d2.svg",
      "figures/plot-4.png",
    ]);
    expect([...text.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/gu)].map(([, alt, path]) => [alt, path])).toEqual([
      ["First", "figures/plot-2.png"],
      ["Water", "figures/smiles.svg"],
      ["Ethanol", "figures/smiles-2.svg"],
      ["Quoted", "figures/plot-3.png"],
      ["", "figures/d2.svg"],
      ["Last", "figures/plot-4.png"],
    ]);
  });

  it("knows whether a note cites anything", () => {
    expect(hasCitations("See [@he2022].")).toBe(true);
    expect(hasCitations("No sources here.")).toBe(false);
  });
});
