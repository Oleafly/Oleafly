import { describe, expect, it } from "vitest";
import {
  findTerminalLinks,
  isAbsoluteTerminalPath,
  safeTerminalUrl,
  terminalPathResolver,
  type TerminalLinkMatch,
} from "./terminal-links";

function linkText(text: string, match: TerminalLinkMatch): string {
  return text.slice(match.start, match.end);
}

function only(text: string): TerminalLinkMatch {
  const links = findTerminalLinks(text);
  expect(links).toHaveLength(1);
  return links[0];
}

function pathOf(match: TerminalLinkMatch): string | null {
  return match.kind === "file" ? match.path : null;
}

describe("findTerminalLinks: compiler and tool output", () => {
  it("reads pdflatex's file:line: error prefix", () => {
    const text = "./main.tex:3: Undefined control sequence.";
    const link = only(text);
    expect(link).toMatchObject({ kind: "file", path: "./main.tex", line: 3 });
    expect(link).not.toHaveProperty("column");
    expect(linkText(text, link)).toBe("./main.tex:3");
  });

  it("reads Tectonic's error: file:line: prefix without a column", () => {
    const text = "error: main.tex:3: Undefined control sequence";
    const link = only(text);
    expect(link).toMatchObject({ kind: "file", path: "main.tex", line: 3 });
    expect(link).not.toHaveProperty("column");
    expect(linkText(text, link)).toBe("main.tex:3");
  });

  it("reads Typst's ┌─ file:line:column pointer", () => {
    const text = "  ┌─ main.typ:3:1";
    const link = only(text);
    expect(link).toMatchObject({ kind: "file", path: "main.typ", line: 3, column: 1 });
    expect(linkText(text, link)).toBe("main.typ:3:1");
  });

  it("reads gcc-style file:line:column: output", () => {
    const text = "plot.c:12:7: warning: unused variable";
    expect(only(text)).toMatchObject({ path: "plot.c", line: 12, column: 7 });
  });

  it("links the quoted path in a Python traceback frame", () => {
    const text = '  File "scripts/plot.py", line 4, in <module>';
    const link = only(text);
    expect(link).toMatchObject({ kind: "file", path: "scripts/plot.py", line: 4 });
    expect(linkText(text, link)).toBe("scripts/plot.py");
  });

  it("matches an absolute Python frame so the resolver can decide", () => {
    const text = '  File "/private/tmp/proj/scripts/plot.py", line 4, in <module>';
    expect(only(text)).toMatchObject({ path: "/private/tmp/proj/scripts/plot.py", line: 4 });
    expect(terminalPathResolver(["scripts/plot.py"])("/private/tmp/proj/scripts/plot.py")).toBeNull();
  });

  it("links bare paths printed by git and TeX", () => {
    expect(only("?? main.tex")).toMatchObject({ path: "main.tex" });
    expect(only("\tmodified:   chapters/intro.tex")).toMatchObject({ path: "chapters/intro.tex" });
    const tex = "(./chapters/intro.tex";
    const link = only(tex);
    expect(link).toMatchObject({ path: "./chapters/intro.tex" });
    expect(linkText(tex, link)).toBe("./chapters/intro.tex");
    expect(only("Wrote .oleafly/build/main.pdf")).toMatchObject({ path: ".oleafly/build/main.pdf" });
  });

  it("finds several links on one line in order", () => {
    const text = "main.tex figures/fig1.pdf refs.bib";
    expect(findTerminalLinks(text).map((link) => linkText(text, link))).toEqual([
      "main.tex",
      "figures/fig1.pdf",
      "refs.bib",
    ]);
  });

  it("measures offsets in UTF-16 units after wide and astral characters", () => {
    const text = "中文 🎉 main.tex:3:1";
    const link = only(text);
    expect(linkText(text, link)).toBe("main.tex:3:1");
  });

  it("keeps a Typst package path whole instead of linking its last file", () => {
    const text = "  ┌─ @preview/charged-ieee:0.1.0/lib.typ:40:5";
    const link = only(text);
    expect(link).toMatchObject({ path: "@preview/charged-ieee:0.1.0/lib.typ", line: 40, column: 5 });
    expect(linkText(text, link)).toBe("@preview/charged-ieee:0.1.0/lib.typ:40:5");
    expect(terminalPathResolver(["lib.typ", "main.typ"])(pathOf(link) ?? "")).toBeNull();

    const cetz = only("  ┌─ @preview/cetz:0.2.2/src/draw.typ:12:3");
    expect(cetz).toMatchObject({ path: "@preview/cetz:0.2.2/src/draw.typ", line: 12, column: 3 });
    expect(terminalPathResolver(["src/draw.typ"])(pathOf(cetz) ?? "")).toBeNull();
  });

  it("ignores out of range lines and zero columns", () => {
    expect(findTerminalLinks("main.tex:0")).toEqual([]);
    expect(findTerminalLinks("main.tex:123456789")).toEqual([]);
    const link = only("main.tex:3:0");
    expect(link).toMatchObject({ path: "main.tex", line: 3 });
    expect(link).not.toHaveProperty("column");
  });
});

describe("findTerminalLinks: paths with spaces", () => {
  it.each([
    ["Typst", "  ┌─ figures/old main.typ:3:1", "figures/old main.typ", 3, 1, "main.typ"],
    ["pdflatex", "./chapter 1/main.tex:3: Undefined control sequence.", "./chapter 1/main.tex", 3, undefined, "1/main.tex"],
    ["Tectonic", "error: My Chapter.tex:3: Undefined control sequence", "My Chapter.tex", 3, undefined, "Chapter.tex"],
    ["Tectonic warning", "warning: My Chapter.tex:8: Reference `fig:plot' on page 1 undefined", "My Chapter.tex", 8, undefined, "Chapter.tex"],
  ])("links the whole %s path, never its last piece", (_tool, text, path, line, column, piece) => {
    const link = only(text);
    expect(link).toMatchObject({ kind: "file", path, line });
    if (column === undefined) expect(link).not.toHaveProperty("column");
    else expect(link).toMatchObject({ column });
    expect(linkText(text, link)).toBe(column === undefined ? `${path}:${line}` : `${path}:${line}:${column}`);
    expect(findTerminalLinks(text).map(pathOf)).not.toContain(piece);
  });

  it("keeps the column of a ./ location with spaces", () => {
    const text = "./chapter 1/plot.c:12:7: warning: unused variable";
    const link = only(text);
    expect(link).toMatchObject({ path: "./chapter 1/plot.c", line: 12, column: 7 });
    expect(linkText(text, link)).toBe("./chapter 1/plot.c:12:7");
  });

  it("still links a plain token after a Tectonic message that names no file", () => {
    const text = "error: halted on potentially-recoverable error: see chapters/intro.tex:3:";
    expect(only(text)).toMatchObject({ path: "chapters/intro.tex", line: 3 });
  });
});

describe("findTerminalLinks: prose before a path on an error: line", () => {
  const resolve = terminalPathResolver([
    "src/main.py",
    "chapters/intro.tex",
    "My Chapter.tex",
    "appendix/Chapter.tex",
    "my notes/a b.tex",
  ]);
  const accept = (path: string) => resolve(path) !== null;

  it.each([
    ["ruff's syntax error", "error: Failed to parse src/main.py:3:5: Simple statements must be separated", "src/main.py:3:5"],
    ["a hint", "error: see chapters/intro.tex:3 for details", "chapters/intro.tex:3"],
    ["a warning", "warning: unused thing in chapters/intro.tex:3", "chapters/intro.tex:3"],
  ])("links only the path in %s", (_kind, text, location) => {
    const links = findTerminalLinks(text, accept);
    expect(links).toHaveLength(1);
    expect(linkText(text, links[0])).toBe(location);
    expect(resolve(pathOf(links[0]) ?? "")).not.toBeNull();
  });

  it("prefers the longest spaced path that names a project file", () => {
    const text = "error: My Chapter.tex:3: Undefined control sequence";
    const links = findTerminalLinks(text, accept);
    expect(links.map(pathOf)).toEqual(["My Chapter.tex"]);

    const hint = "error: see my notes/a b.tex:3 for details";
    const [link] = findTerminalLinks(hint, accept);
    expect(link).toMatchObject({ path: "my notes/a b.tex", line: 3 });
    expect(linkText(hint, link)).toBe("my notes/a b.tex:3");
  });

  it("keeps a Typst or ./ spaced path whole even when it names no project file", () => {
    const none = () => false;
    expect(findTerminalLinks("  ┌─ figures/old main.typ:3:1", none).map(pathOf)).toEqual([
      "figures/old main.typ",
    ]);
    expect(findTerminalLinks("./chapter 1/main.tex:3: oops", none).map(pathOf)).toEqual([
      "./chapter 1/main.tex",
    ]);
  });
});

describe("findTerminalLinks: URLs", () => {
  it("drops a sentence's trailing dot", () => {
    const text = "See https://typst.app/docs.";
    const link = only(text);
    expect(link).toMatchObject({ kind: "url", url: "https://typst.app/docs" });
    expect(linkText(text, link)).toBe("https://typst.app/docs");
  });

  it("keeps balanced parentheses and drops the wrapping one", () => {
    const text = "(https://x.org/a_(b))";
    expect(only(text)).toMatchObject({ kind: "url", url: "https://x.org/a_(b)" });
  });

  it("does not also link a path inside a URL", () => {
    const text = "Serving at http://localhost:8888/lab/tree/main.ipynb now";
    expect(only(text)).toMatchObject({
      kind: "url",
      url: "http://localhost:8888/lab/tree/main.ipynb",
    });
  });
});

describe("findTerminalLinks: text that is not a link", () => {
  it.each([
    "v0.4.3",
    "released 0.4.3 today",
    "12:30:45",
    "listening on localhost:8888",
    "bound 127.0.0.1:8080",
    "--output=foo.pdf",
    "Done.",
    "",
  ])("finds nothing in %j", (text) => {
    expect(findTerminalLinks(text)).toEqual([]);
  });
});

describe("terminalPathResolver", () => {
  const files = [
    "main.tex",
    "chapters/intro.tex",
    "cast/a/notes.md",
    "cast/b/notes.md",
    "scripts/plot.py",
    "figures/fig1.pdf",
  ];
  const resolve = terminalPathResolver(files);

  it("resolves exact, ./ and unique suffix paths", () => {
    expect(resolve("main.tex")).toBe("main.tex");
    expect(resolve("./chapters/intro.tex")).toBe("chapters/intro.tex");
    expect(resolve("intro.tex")).toBe("chapters/intro.tex");
    expect(resolve("../figures/fig1.pdf")).toBe("figures/fig1.pdf");
  });

  it("refuses an ambiguous basename", () => {
    expect(resolve("notes.md")).toBeNull();
  });

  it("never links absolute paths", () => {
    for (const path of [
      "/Users/me/other/main.tex",
      "~/thesis/main.tex",
      "C:\\thesis\\main.tex",
      "C:/thesis/main.tex",
      "\\\\server\\share\\main.tex",
      "file:///Users/me/main.tex",
    ]) {
      expect(resolve(path)).toBeNull();
    }
  });

  it("never links paths that lead out of the project", () => {
    for (const path of [
      "../../other-project/main.tex",
      "other-project/main.tex",
      "build/old/chapters/intro.tex",
      "$HOME/proj/main.tex",
      "%USERPROFILE%\\x\\main.tex",
      "@preview/cetz:0.2.2/main.tex",
    ]) {
      expect(resolve(path)).toBeNull();
    }
  });

  it("links a parent path only to the file it names exactly", () => {
    const parent = terminalPathResolver([
      "main.tex",
      "chapters/intro.tex",
      "docs/notes.md",
      "figures/fig1.pdf",
    ]);
    for (const path of ["../intro.tex", "../../notes.md", "../../fig1.pdf", "./../intro.tex", "..\\intro.tex"]) {
      expect(parent(path)).toBeNull();
    }
    expect(parent("../main.tex")).toBe("main.tex");
    expect(parent("../figures/fig1.pdf")).toBe("figures/fig1.pdf");
    expect(parent("./intro.tex")).toBe("chapters/intro.tex");
  });

  it("does not add .tex to a bare name", () => {
    expect(resolve("intro")).toBeNull();
    expect(resolve("chapters/intro")).toBeNull();
  });

  it("does not link a folder", () => {
    expect(resolve("chapters")).toBeNull();
    expect(resolve("chapters/")).toBeNull();
  });
});

describe("isAbsoluteTerminalPath", () => {
  it("tells absolute paths from relative ones", () => {
    expect(isAbsoluteTerminalPath("/tmp/a.py")).toBe(true);
    expect(isAbsoluteTerminalPath("~/a.py")).toBe(true);
    expect(isAbsoluteTerminalPath("D:\\a.py")).toBe(true);
    expect(isAbsoluteTerminalPath("file:/a.py")).toBe(true);
    expect(isAbsoluteTerminalPath("./a.py")).toBe(false);
    expect(isAbsoluteTerminalPath("a/b.py")).toBe(false);
  });
});

describe("safeTerminalUrl", () => {
  it("accepts http and https", () => {
    expect(safeTerminalUrl("https://typst.app/docs")).toBe("https://typst.app/docs");
    expect(safeTerminalUrl("http://localhost:8888/lab")).toBe("http://localhost:8888/lab");
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "mailto:someone@example.org",
    "https://user:secret@example.org/",
    "https://example.org/\u0007bell",
    "data:text/html,hi",
    "not a url",
  ])("rejects %j", (url) => {
    expect(safeTerminalUrl(url)).toBeNull();
  });
});
