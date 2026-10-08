import { describe, expect, it } from "vitest";
import { applyTextEdits, planReferenceUpdates } from "./index";

interface Scenario {
  readonly files: Record<string, string | null>;
  readonly from: string;
  readonly to: string;
  readonly main?: string;
  readonly directories?: readonly string[];
}

function remapped(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

function move(scenario: Scenario) {
  const { files, from, to } = scenario;
  const main = scenario.main ?? "main.tex";
  const before = Object.keys(files);
  const after = before.map((path) => remapped(path, from, to));
  const sources = Object.entries(files)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([path, text]) => ({ path: remapped(path, from, to), text }));
  const plan = planReferenceUpdates({
    move: { from, to },
    before: { files: before, directories: scenario.directories, mainDoc: main },
    after: {
      files: after,
      directories: scenario.directories?.map((path) => remapped(path, from, to)),
      mainDoc: remapped(main, from, to),
    },
    sources,
  });
  const texts: Record<string, string> = {};
  for (const file of plan.files) texts[file.path] = applyTextEdits(file.text, file.edits);
  return { plan, texts };
}

describe("LaTeX references", () => {
  it("keeps an omitted .tex extension when an input file is renamed", () => {
    const { plan, texts } = move({
      files: {
        "main.tex": "\\input{chapters/intro}\n\\input{chapters/outro.tex}\n",
        "chapters/intro.tex": "Intro",
        "chapters/outro.tex": "Outro",
      },
      from: "chapters/intro.tex",
      to: "chapters/introduction.tex",
    });
    expect(texts["main.tex"]).toBe("\\input{chapters/introduction}\n\\input{chapters/outro.tex}\n");
    expect(plan.references).toBe(1);
    expect(plan.files.map((file) => [file.path, file.references])).toEqual([["main.tex", 1]]);
  });

  it("keeps an explicit extension", () => {
    const { texts } = move({
      files: { "main.tex": "\\input{chapters/outro.tex}", "chapters/outro.tex": "" },
      from: "chapters/outro.tex",
      to: "back/outro.tex",
    });
    expect(texts["main.tex"]).toBe("\\input{back/outro.tex}");
  });

  it("updates include and includeonly lists item by item", () => {
    const { plan, texts } = move({
      files: {
        "main.tex":
          "\\includeonly{chapters/intro, chapters/outro}\n\\include{chapters/intro}\n\\include{chapters/outro}\n",
        "chapters/intro.tex": "",
        "chapters/outro.tex": "",
      },
      from: "chapters/intro.tex",
      to: "parts/intro.tex",
    });
    expect(texts["main.tex"]).toBe(
      "\\includeonly{parts/intro, chapters/outro}\n\\include{parts/intro}\n\\include{chapters/outro}\n",
    );
    expect(plan.references).toBe(2);
  });

  it("resolves a plain input against the main document folder, not the including file", () => {
    const { texts } = move({
      files: {
        "main.tex": "\\input{chapters/a}",
        "chapters/a.tex": "\\input{chapters/b}\n\\input{b}",
        "chapters/b.tex": "",
        "b.tex": "",
      },
      from: "chapters/b.tex",
      to: "chapters/c.tex",
    });
    expect(texts["chapters/a.tex"]).toBe("\\input{chapters/c}\n\\input{b}");
  });

  it("uses the main document folder when the main document lives in a subfolder", () => {
    const { texts } = move({
      files: {
        "paper/main.tex": "\\input{sections/intro}",
        "paper/sections/intro.tex": "",
      },
      main: "paper/main.tex",
      from: "paper/sections/intro.tex",
      to: "paper/sections/one.tex",
    });
    expect(texts["paper/main.tex"]).toBe("\\input{sections/one}");
  });

  it("leaves input paths alone when only the including file moves", () => {
    const { plan } = move({
      files: {
        "main.tex": "\\input{chapters/a}",
        "chapters/a.tex": "\\includegraphics{figures/plot}",
        "figures/plot.png": null,
      },
      from: "chapters/a.tex",
      to: "parts/deep/a.tex",
    });
    expect(plan.files.map((file) => file.path)).toEqual(["main.tex"]);
  });

  it("follows graphicspath and omitted graphics extensions", () => {
    const files = {
      "main.tex": "\\graphicspath{{figures/}}\n\\includegraphics[width=\\linewidth]{plot}\n",
      "figures/plot.png": null,
    };
    expect(move({ files, from: "figures/plot.png", to: "figures/chart.png" }).texts["main.tex"]).toBe(
      "\\graphicspath{{figures/}}\n\\includegraphics[width=\\linewidth]{chart}\n",
    );
    expect(move({ files, from: "figures/plot.png", to: "figures/sub/plot.png" }).texts["main.tex"]).toBe(
      "\\graphicspath{{figures/}}\n\\includegraphics[width=\\linewidth]{sub/plot}\n",
    );
    expect(move({ files, from: "figures/plot.png", to: "images/plot.png" }).texts["main.tex"]).toBe(
      "\\graphicspath{{figures/}}\n\\includegraphics[width=\\linewidth]{images/plot}\n",
    );
  });

  it("adds the extension when the bare name would find another graphic first", () => {
    const { texts } = move({
      files: {
        "main.tex": "\\includegraphics{figures/a}",
        "figures/a.png": null,
        "figures/b.pdf": null,
      },
      from: "figures/a.png",
      to: "figures/b.png",
    });
    expect(texts["main.tex"]).toBe("\\includegraphics{figures/b.png}");
  });

  it("updates graphicspath entries on a folder move instead of every graphic", () => {
    const { plan, texts } = move({
      files: {
        "main.tex": "\\graphicspath{{figures/}}\n\\includegraphics{plot}\n\\includegraphics{figures/other.pdf}\n",
        "figures/plot.png": null,
        "figures/other.pdf": null,
      },
      from: "figures",
      to: "images",
      directories: ["figures"],
    });
    expect(texts["main.tex"]).toBe(
      "\\graphicspath{{images/}}\n\\includegraphics{plot}\n\\includegraphics{images/other.pdf}\n",
    );
    expect(plan.references).toBe(2);
  });

  it("updates every reference into a moved folder", () => {
    const { texts } = move({
      files: {
        "main.tex": "\\input{chapters/a}\n\\include{chapters/b}\n\\includegraphics{chapters/fig}\n",
        "chapters/a.tex": "",
        "chapters/b.tex": "",
        "chapters/fig.jpg": null,
      },
      from: "chapters",
      to: "book/parts",
    });
    expect(texts["main.tex"]).toBe(
      "\\input{book/parts/a}\n\\include{book/parts/b}\n\\includegraphics{book/parts/fig}\n",
    );
  });

  it("rewrites import directories and file names", () => {
    const files = {
      "main.tex": "\\import{chapters/}{intro}",
      "chapters/intro.tex": "",
    };
    expect(move({ files, from: "chapters/intro.tex", to: "chapters/start.tex" }).texts["main.tex"]).toBe(
      "\\import{chapters/}{start}",
    );
    expect(move({ files, from: "chapters", to: "parts" }).texts["main.tex"]).toBe("\\import{parts/}{intro}");
    expect(move({ files, from: "chapters/intro.tex", to: "front/intro.tex" }).texts["main.tex"]).toBe(
      "\\import{front/}{intro}",
    );
  });

  it("resolves subimport and subfile relative to the importing file", () => {
    const { texts } = move({
      files: {
        "main.tex": "\\import{chapters/}{intro}",
        "chapters/intro.tex": "\\subimport{sections/}{a}\n\\subfile{sections/a}",
        "chapters/sections/a.tex": "",
      },
      from: "chapters/sections/a.tex",
      to: "chapters/sections/b.tex",
    });
    expect(texts["chapters/intro.tex"]).toBe("\\subimport{sections/}{b}\n\\subfile{sections/b}");
  });

  it("updates bibliography lists and addbibresource", () => {
    const files = {
      "main.tex": "\\bibliography{refs,extra}\n\\addbibresource{refs.bib}\n",
      "refs.bib": "",
      "extra.bib": "",
    };
    expect(move({ files, from: "refs.bib", to: "bib/refs.bib" }).texts["main.tex"]).toBe(
      "\\bibliography{bib/refs,extra}\n\\addbibresource{bib/refs.bib}\n",
    );
  });

  it("updates local packages and classes but never installed ones", () => {
    const files = {
      "main.tex": "\\documentclass[11pt]{thesis}\n\\usepackage{amsmath,mystyle}\n\\RequirePackage{mystyle}\n",
      "thesis.cls": "",
      "mystyle.sty": "",
    };
    expect(move({ files, from: "mystyle.sty", to: "styles/mystyle.sty" }).texts["main.tex"]).toBe(
      "\\documentclass[11pt]{thesis}\n\\usepackage{amsmath,styles/mystyle}\n\\RequirePackage{styles/mystyle}\n",
    );
    expect(move({ files, from: "thesis.cls", to: "mythesis.cls" }).texts["main.tex"]).toBe(
      "\\documentclass[11pt]{mythesis}\n\\usepackage{amsmath,mystyle}\n\\RequirePackage{mystyle}\n",
    );
  });

  it("handles svg, pdf pages, standalone figures, listings and verbatim inputs", () => {
    const { texts } = move({
      files: {
        "main.tex":
          "\\includesvg[width=2cm]{assets/diagram}\n\\includepdf[pages=-]{assets/paper}\n\\includestandalone[mode=buildnew]{assets/tikz}\n\\lstinputlisting[language=Python]{assets/run.py}\n\\verbatiminput{assets/notes.txt}\n",
        "assets/tikz.tex": "",
        "assets/diagram.svg": null,
        "assets/paper.pdf": null,
        "assets/run.py": "",
        "assets/notes.txt": "",
      },
      from: "assets",
      to: "extra",
    });
    expect(texts["main.tex"]).toBe(
      "\\includesvg[width=2cm]{extra/diagram}\n\\includepdf[pages=-]{extra/paper}\n\\includestandalone[mode=buildnew]{extra/tikz}\n\\lstinputlisting[language=Python]{extra/run.py}\n\\verbatiminput{extra/notes.txt}\n",
    );
  });

  it("ignores comments and verbatim text", () => {
    const { plan } = move({
      files: {
        "main.tex": "% \\input{chapters/intro}\n\\verb|\\input{chapters/intro}|\n\\begin{verbatim}\n\\input{chapters/intro}\n\\end{verbatim}\n",
        "chapters/intro.tex": "",
      },
      from: "chapters/intro.tex",
      to: "chapters/start.tex",
    });
    expect(plan.references).toBe(0);
    expect(plan.files).toEqual([]);
  });

  it("finds nothing when no source names the moved file", () => {
    const { plan } = move({
      files: { "main.tex": "\\input{chapters/other}", "chapters/other.tex": "", "notes.txt": "" },
      from: "notes.txt",
      to: "archive/notes.txt",
    });
    expect(plan).toEqual({ files: [], references: 0 });
  });

  it("keeps root-relative inputs when the main document moves into a folder", () => {
    const { plan, texts } = move({
      files: {
        "main.tex": "\\input{chapters/a}\n\\includegraphics{figures/plot}\n",
        "chapters/a.tex": "",
        "figures/plot.png": null,
        "index.md": "[paper](main.tex)",
      },
      main: "main.tex",
      from: "main.tex",
      to: "src/main.tex",
    });
    expect(plan.files.map((file) => file.path)).toEqual(["index.md"]);
    expect(texts["index.md"]).toBe("[paper](src/main.tex)");
  });

  it("keeps quoted names quoted", () => {
    const { texts } = move({
      files: { "main.tex": '\\includegraphics{"my plot".png}', "my plot.png": null },
      from: "my plot.png",
      to: "my chart.png",
    });
    expect(texts["main.tex"]).toBe('\\includegraphics{"my chart".png}');
  });

  it("keeps a leading ./ and leaves unrelated commands alone", () => {
    const { texts } = move({
      files: {
        "main.tex": "\\input{./chapters/a}\n\\bibliographystyle{plain}\n\\input{chapters/a}\n",
        "chapters/a.tex": "",
      },
      from: "chapters/a.tex",
      to: "chapters/b.tex",
    });
    expect(texts["main.tex"]).toBe("\\input{./chapters/b}\n\\bibliographystyle{plain}\n\\input{chapters/b}\n");
  });

  it("skips paths built from macros", () => {
    const { plan } = move({
      files: { "main.tex": "\\input{\\chapterdir/intro}", "chapters/intro.tex": "" },
      from: "chapters/intro.tex",
      to: "chapters/start.tex",
    });
    expect(plan.references).toBe(0);
  });
});

describe("Typst references", () => {
  it("updates include, import and loader paths", () => {
    const { plan, texts } = move({
      main: "main.typ",
      files: {
        "main.typ":
          '#include "chapters/intro.typ"\n#import "chapters/intro.typ": helper\n#let data = json("chapters/intro.typ")\n',
        "chapters/intro.typ": "",
      },
      from: "chapters/intro.typ",
      to: "parts/intro.typ",
    });
    expect(texts["main.typ"]).toBe(
      '#include "parts/intro.typ"\n#import "parts/intro.typ": helper\n#let data = json("parts/intro.typ")\n',
    );
    expect(plan.references).toBe(3);
  });

  it("updates images, data loaders and bibliography arrays", () => {
    const { texts } = move({
      main: "main.typ",
      files: {
        "main.typ":
          '#figure(image("data/a.png", width: 50%))\n#read("data/a.png")\n#csv("data/a.png")\n#yaml("data/a.png")\n#toml("data/a.png")\n#bibliography(("data/a.png", "refs.yml"), style: "data/a.png")\n',
        "data/a.png": null,
        "refs.yml": "",
      },
      from: "data/a.png",
      to: "img/a.png",
    });
    expect(texts["main.typ"]).toBe(
      '#figure(image("img/a.png", width: 50%))\n#read("img/a.png")\n#csv("img/a.png")\n#yaml("img/a.png")\n#toml("img/a.png")\n#bibliography(("img/a.png", "refs.yml"), style: "img/a.png")\n',
    );
  });

  it("keeps root-relative paths rooted at the project", () => {
    const { texts } = move({
      main: "main.typ",
      files: {
        "main.typ": '#include "chapters/c.typ"',
        "chapters/c.typ": '#image("/assets/logo.png")\n#image("../assets/logo.png")',
        "assets/logo.png": null,
      },
      from: "assets/logo.png",
      to: "assets/img/logo.png",
    });
    expect(texts["chapters/c.typ"]).toBe('#image("/assets/img/logo.png")\n#image("../assets/img/logo.png")');
  });

  it("rewrites relative paths inside a moved Typst file", () => {
    const { texts } = move({
      main: "main.typ",
      files: {
        "main.typ": '#include "chapters/c.typ"',
        "chapters/c.typ": '#image("../figs/a.png")\n#image("/figs/a.png")',
        "figs/a.png": null,
      },
      from: "chapters/c.typ",
      to: "chapters/deep/c.typ",
    });
    expect(texts["main.typ"]).toBe('#include "chapters/deep/c.typ"');
    expect(texts["chapters/deep/c.typ"]).toBe('#image("../../figs/a.png")\n#image("/figs/a.png")');
  });

  it("ignores comments, packages and method calls", () => {
    const { plan } = move({
      main: "main.typ",
      files: {
        "main.typ":
          '// #image("figs/a.png")\n/* image("figs/a.png") */\n#import "@preview/cetz:0.3.0"\n#let x = image.decode("figs/a.png")\n`image("figs/a.png")`\n',
        "figs/a.png": null,
      },
      from: "figs/a.png",
      to: "img/a.png",
    });
    expect(plan.references).toBe(0);
  });
});

describe("Markdown references", () => {
  it("updates links, images and reference definitions relative to the file", () => {
    const { plan, texts } = move({
      main: "notes/index.md",
      files: {
        "notes/index.md":
          '![Plot](../figs/a.png "Plot")\n[guide](guide.md#install)\n[logo]: ../figs/a.png "Logo"\n',
        "notes/guide.md": "",
        "figs/a.png": null,
      },
      from: "figs/a.png",
      to: "figs/plots/a.png",
    });
    expect(texts["notes/index.md"]).toBe(
      '![Plot](../figs/plots/a.png "Plot")\n[guide](guide.md#install)\n[logo]: ../figs/plots/a.png "Logo"\n',
    );
    expect(plan.references).toBe(2);
  });

  it("keeps anchors and leaves URLs, code and absolute paths alone", () => {
    const { texts } = move({
      main: "index.md",
      files: {
        "index.md":
          "[a](docs/guide.md#install)\n[b](https://example.com/docs/guide.md)\n`[c](docs/guide.md)`\n```\n[d](docs/guide.md)\n```\n<!-- [e](docs/guide.md) -->\n[f](/docs/guide.md)\n",
        "docs/guide.md": "",
      },
      from: "docs/guide.md",
      to: "docs/manual.md",
    });
    expect(texts["index.md"]).toBe(
      "[a](docs/manual.md#install)\n[b](https://example.com/docs/guide.md)\n`[c](docs/guide.md)`\n```\n[d](docs/guide.md)\n```\n<!-- [e](docs/guide.md) -->\n[f](/docs/guide.md)\n",
    );
  });

  it("rewrites relative links inside a moved Markdown file", () => {
    const { texts } = move({
      main: "index.md",
      files: {
        "index.md": "[ch](chapters/one.md)",
        "chapters/one.md": "![x](../figs/a.png)",
        "figs/a.png": null,
      },
      from: "chapters/one.md",
      to: "one.md",
    });
    expect(texts["index.md"]).toBe("[ch](one.md)");
    expect(texts["one.md"]).toBe("![x](figs/a.png)");
  });

  it("keeps angle brackets and percent encoding", () => {
    const { texts } = move({
      main: "index.md",
      files: {
        "index.md": "![a](<my figs/a b.png>)\n![b](my%20figs/a%20b.png)\n",
        "my figs/a b.png": null,
      },
      from: "my figs/a b.png",
      to: "my figs/c d.png",
    });
    expect(texts["index.md"]).toBe("![a](<my figs/c d.png>)\n![b](my%20figs/c%20d.png)\n");
  });
});
