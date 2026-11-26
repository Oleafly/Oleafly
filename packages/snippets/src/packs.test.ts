import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildLibrary,
  type LayerId,
  type ParsedSnippetFile,
  parseSnippetFile,
  renderBody,
  type RenderEnv,
  type SnippetRecord,
} from "./index";

const BUNDLED = fileURLToPath(new URL("../../../src/features/snippets/packs/", import.meta.url));
const FETCHED = fileURLToPath(new URL("../../../public/snippets/", import.meta.url));
const EDITOR_MESSAGES = fileURLToPath(new URL("../../../src/i18n/locales/en/editor.json", import.meta.url));

const ENV: RenderEnv = {
  selection: "",
  clipboard: "",
  now: new Date(2026, 10, 25),
  fileName: "main.tex",
  projectName: null,
  lineComment: "%",
  captures: ["x", "1"],
  indent: "",
  indentUnit: "  ",
};

function load(folder: string, layer: LayerId): Map<string, ParsedSnippetFile> {
  const files = new Map<string, ParsedSnippetFile>();
  for (const name of readdirSync(folder).filter((entry) => entry.endsWith(".json") && entry !== "index.json").sort()) {
    const collection = name.replace(/\.json$/u, "");
    files.set(collection, parseSnippetFile(readFileSync(`${folder}${name}`, "utf8"), collection, layer));
  }
  return files;
}

const bundled = load(BUNDLED, "builtin");
const fetched = load(FETCHED, "pack");
const all = new Map([...bundled, ...fetched]);

function records(collection: string): SnippetRecord[] {
  return all.get(collection)?.records ?? [];
}

function render(record: SnippetRecord, language: keyof SnippetRecord["bodies"] = "default"): string {
  return renderBody(record.bodies[language] ?? record.bodies.default ?? [], ENV).text;
}

describe("bundled and fetched packs", () => {
  it("has the four bundled packs and the three fetched ones", () => {
    expect([...bundled.keys()]).toEqual([
      "builtin-latex-at",
      "builtin-latex-slash",
      "builtin-markdown-slash",
      "builtin-typst-slash",
    ]);
    expect([...fetched.keys()]).toEqual(["fast-math-latex", "fast-math-typst", "paper-structure"]);
  });

  it("parses every pack without problems", () => {
    for (const file of all.values()) expect({ collection: file.collection, problems: file.problems }).toEqual({
      collection: file.collection,
      problems: [],
    });
  });

  it("keeps the counts of today's menus", () => {
    expect(records("builtin-latex-slash")).toHaveLength(14);
    expect(records("builtin-typst-slash")).toHaveLength(19);
    expect(records("builtin-markdown-slash")).toHaveLength(2);
    expect(records("builtin-latex-at")).toHaveLength(66);
  });

  it("names every slash record with an existing editor message", () => {
    const messages = JSON.parse(readFileSync(EDITOR_MESSAGES, "utf8")).package;
    for (const collection of ["builtin-latex-slash", "builtin-typst-slash", "builtin-markdown-slash"]) {
      for (const record of records(collection)) {
        const message = (record.nameKey as string).split(".").reduce((node, key) => node?.[key], messages);
        expect({ id: record.id, name: message }).toEqual({ id: record.id, name: record.name });
        expect(record).toMatchObject({ expand: "list", place: "text", layer: "builtin" });
      }
    }
  });

  it("keeps the Typst version gate", () => {
    expect(records("builtin-typst-slash").filter((record) => record.typstSince)).toEqual([
      expect.objectContaining({ id: "typst.slash.partbibliography", typstSince: [0, 15] }),
    ]);
  });

  it("credits LaTeX Workshop in the @ pack", () => {
    expect(all.get("builtin-latex-at")?.header).toEqual({
      name: "LaTeX @ shortcuts",
      nameKey: "snippets.packs.latexAt",
      source: "https://github.com/James-Yu/LaTeX-Workshop",
      licence: "MIT",
    });
    expect(records("builtin-latex-at").every((record) => record.id.startsWith("at.") && record.place === "math")).toBe(true);
  });

  it("reuses the built-in @ ids for the Fast math Greek letters", () => {
    const builtin = new Map(records("builtin-latex-at").map((record) => [record.id, record]));
    const greek = records("fast-math-latex").filter((record) => record.id.startsWith("at."));
    expect(greek).toHaveLength(40);
    for (const record of greek) {
      const original = builtin.get(record.id) as SnippetRecord;
      expect({ id: record.id, trigger: record.trigger, body: render(record) }).toEqual({
        id: original.id,
        trigger: original.trigger,
        body: render(original),
      });
      expect(record.expand).toBe("auto");
    }
    const snippets = buildLibrary({
      files: [all.get("builtin-latex-at"), all.get("fast-math-latex")] as ParsedSnippetFile[],
      disabledCollections: new Set(),
      overrides: [],
      disabledRegex: new Set(),
    });
    expect(snippets.byId("at.alpha")?.collection).toBe("fast-math-latex");
  });

  it("writes Fast math only as you type and mostly in math", () => {
    for (const collection of ["fast-math-latex", "fast-math-typst"]) {
      const list = records(collection);
      expect(list.every((record) => record.expand === "auto")).toBe(true);
      expect(list.filter((record) => record.place !== "math").map((record) => record.trigger)).toEqual(["mk", "dm"]);
    }
  });

  it("renders the Fast math bodies as the spec writes them", () => {
    const latex = new Map(records("fast-math-latex").map((record) => [record.id, record]));
    const typst = new Map(records("fast-math-typst").map((record) => [record.id, record]));
    const text = (map: Map<string, SnippetRecord>, id: string) => render(map.get(id) as SnippetRecord);
    expect(text(latex, "fm.inline-math")).toBe("$$");
    expect(text(latex, "fm.display-math")).toBe("\\[\n  \n\\]");
    expect(text(latex, "fm.left-brace")).toBe("\\left\\{  \\right\\}");
    expect(text(latex, "fm.norm")).toBe("\\|\\|");
    expect(text(latex, "fm.dint")).toBe("\\int_{a}^{b}  \\, dx");
    expect(text(latex, "fm.subscript")).toBe("x_1");
    expect(text(latex, "fm.postfix-fraction")).toBe("\\frac{x}{}");
    expect(text(typst, "fm-typst.display-math")).toBe("$  $");
    expect(text(typst, "fm-typst.varepsilon")).toBe("epsilon.alt");
    expect(text(typst, "fm-typst.bmatrix")).toBe('mat(delim: "[", )');
    expect(latex.get("fm.subscript")?.regex?.exec("$x1")?.slice(1)).toEqual(["x", "1"]);
    expect(latex.get("fm.postfix-fraction")?.regex?.exec("a+\\alpha/")?.slice(1)).toEqual(["\\alpha"]);
  });

  it("gives every Paper structure record a LaTeX and a Typst body", () => {
    const paper = records("paper-structure");
    expect(paper.map((record) => record.trigger)).toEqual(["fig", "figs", "tab", "eq", "ali", "thm", "lem", "defn", "prf", "alg"]);
    for (const record of paper) {
      expect(Object.keys(record.bodies).sort()).toEqual(["latex", "typst"]);
      expect(record).toMatchObject({ expand: "tab", place: "text", lineStart: true, languages: ["latex", "typst"] });
    }
    const figure = paper[0];
    expect(render(figure, "latex")).toBe(
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{}\n  \\caption{Caption}\n  \\label{fig:caption}\n\\end{figure}",
    );
    expect(render(paper[2], "latex")).toContain("Method & Score & Time \\\\\n");
  });

  it("lists the fetched packs in the index with their defaults", () => {
    const index = JSON.parse(readFileSync(`${FETCHED}index.json`, "utf8"));
    expect(index).toEqual([
      { file: "fast-math-latex.json", collection: "fast-math-latex", defaultOn: false },
      { file: "fast-math-typst.json", collection: "fast-math-typst", defaultOn: false },
      { file: "paper-structure.json", collection: "paper-structure", defaultOn: true },
    ]);
  });
});
