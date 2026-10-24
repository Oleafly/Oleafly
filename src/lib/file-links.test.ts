import { describe, expect, it } from "vitest";
import {
  appUrlProjectPath,
  escapeLatexText,
  fileLinkSource,
  fileLinkText,
  isLinkImage,
  linkBase,
  linkLanguageFor,
  localizeAppLink,
  projectFileForHref,
} from "./file-links";

const place = { fromFile: "notes/index.md", mainDoc: "main.tex" };
const windows = { protocol: "http:", host: "tauri.localhost" };
const dev = { protocol: "http:", host: "localhost:1420" };

describe("file link syntax", () => {
  it("knows which documents can hold a link", () => {
    expect(linkLanguageFor("notes/a.md")).toBe("markdown");
    expect(linkLanguageFor("README.markdown")).toBe("markdown");
    expect(linkLanguageFor("main.typ")).toBe("typst");
    expect(linkLanguageFor("chapters/intro.tex")).toBe("latex");
    expect(linkLanguageFor("refs.bib")).toBeNull();
    expect(linkLanguageFor(null)).toBeNull();
  });

  it("names a link after the file without its extension", () => {
    expect(fileLinkText("notes/Сведения о земельном участке.md")).toBe("Сведения о земельном участке");
    expect(fileLinkText("archive.tar.gz")).toBe("archive.tar");
    expect(fileLinkText(".latexmkrc")).toBe(".latexmkrc");
  });

  it("writes a Markdown link relative to the note, in angle brackets when needed", () => {
    expect(fileLinkSource("markdown", "notes/plan.md", place)).toBe("[plan](plan.md)");
    expect(fileLinkSource("markdown", "notes/Сведения о земельном участке.md", place)).toBe(
      "[Сведения о земельном участке](<Сведения о земельном участке.md>)",
    );
    expect(fileLinkSource("markdown", "data/a (1).csv", place)).toBe("[a (1)](<../data/a (1).csv>)");
    expect(fileLinkSource("markdown", "notes/[draft]*.md", place)).toBe(String.raw`[\[draft\]\*]([draft]*.md)`);
  });

  it("keeps the caller's link text as written", () => {
    expect(fileLinkSource("markdown", "notes/plan.md", place, { text: "the *plan*" })).toBe("[the *plan*](plan.md)");
  });

  it("writes a Typst link relative to the file, with or without the hash", () => {
    const typst = { fromFile: "chapters/one.typ", mainDoc: "main.typ" };
    expect(fileLinkSource("typst", "chapters/two.typ", typst)).toBe('#link("two.typ")[two]');
    expect(fileLinkSource("typst", "data/my_notes #1.txt", typst, { typstHash: false })).toBe(
      String.raw`link("../data/my_notes #1.txt")[my\_notes \#1]`,
    );
    expect(fileLinkSource("typst", 'data/say "hi".txt', typst)).toBe(String.raw`#link("../data/say \"hi\".txt")[say "hi"]`);
  });

  it("writes a LaTeX link relative to the main document and escapes TeX specials", () => {
    const latex = { fromFile: "chapters/one.tex", mainDoc: "main.tex" };
    expect(fileLinkSource("latex", "data/results_2024.csv", latex)).toBe(String.raw`\href{data/results_2024.csv}{results\_2024}`);
    expect(fileLinkSource("latex", "docs/100% sure.pdf", latex)).toBe(String.raw`\href{docs/100\% sure.pdf}{100\% sure}`);
    expect(escapeLatexText(String.raw`a\b^c~d&e`)).toBe(String.raw`a\textbackslash{}b\^{}c\~{}d\&e`);
  });

  it("treats images per language", () => {
    expect(isLinkImage("markdown", "img/a.webp")).toBe(true);
    expect(isLinkImage("markdown", "docs/a.pdf")).toBe(false);
    expect(isLinkImage("latex", "img/a.pdf")).toBe(true);
    expect(isLinkImage("typst", "img/a.gif")).toBe(false);
  });
});

describe("links on the app's own origin", () => {
  const encoded =
    "/%D0%A1%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F%20%D0%BE%20%D0%B7%D0%B5%D0%BC%D0%B5%D0%BB%D1%8C%D0%BD%D0%BE%D0%BC%20%D1%83%D1%87%D0%B0%D1%81%D1%82%D0%BA%D0%B5.md";

  it("turns the Windows webview origin from issue #316 back into a project path", () => {
    expect(appUrlProjectPath(`http://tauri.localhost${encoded}`, windows)).toEqual({
      path: "Сведения о земельном участке.md",
      fragment: "",
    });
  });

  it("recognises every Tauri origin and the dev server, whichever platform runs", () => {
    expect(appUrlProjectPath("tauri://localhost/notes/a.md", windows)?.path).toBe("notes/a.md");
    expect(appUrlProjectPath("https://tauri.localhost/notes/a.md", null)?.path).toBe("notes/a.md");
    expect(appUrlProjectPath("http://localhost:1420/notes/a.md", dev)?.path).toBe("notes/a.md");
  });

  it("leaves other sites, the bare origin and broken escapes alone", () => {
    expect(appUrlProjectPath("http://localhost:1420/notes/a.md", windows)).toBeNull();
    expect(appUrlProjectPath("https://example.com/notes/a.md", windows)).toBeNull();
    expect(appUrlProjectPath("http://tauri.localhost/", windows)).toBeNull();
    expect(appUrlProjectPath("http://tauri.localhost/%E0%A4%A.md", windows)).toBeNull();
    expect(appUrlProjectPath("notes/a.md", windows)).toBeNull();
  });

  it("writes the target relative to the document and keeps the heading", () => {
    expect(localizeAppLink("http://tauri.localhost/notes/b.md#%D0%BF%D0%BB%D0%B0%D0%BD", "notes/a.md", windows)).toEqual({
      path: "b.md",
      fragment: "#план",
    });
    expect(localizeAppLink("tauri://localhost/img/x%20y.png", "notes/deep/a.md", windows)).toEqual({
      path: "../../img/x y.png",
      fragment: "",
    });
    expect(localizeAppLink("https://example.com/x", "notes/a.md", windows)).toBeNull();
  });
});

describe("the project file a link points at", () => {
  it("reads a relative destination from the note it is written in", () => {
    expect(projectFileForHref("notes/index.md", "plan%20B.md#Goals", windows)).toEqual({ path: "notes/plan B.md", fragment: "#Goals" });
    expect(projectFileForHref("notes/deep/a.md", "../../img/x.png", windows)).toEqual({ path: "img/x.png", fragment: "" });
    expect(projectFileForHref("notes/index.md", "a%23b.md", windows)?.path).toBe("notes/a#b.md");
  });

  it("follows a link that was saved with the app's own address", () => {
    expect(projectFileForHref("notes/index.md", "http://tauri.localhost/%D0%A1%D0%B2.md", windows)?.path).toBe("Св.md");
    expect(projectFileForHref("notes/index.md", "tauri://localhost/notes/b.md", windows)?.path).toBe("notes/b.md");
  });

  it("leaves other sites, in-page anchors and broken escapes alone", () => {
    for (const href of ["https://example.com/a.md", "mailto:a@b.c", "#section", "//cdn/x.md", "100%.md", "", undefined]) {
      expect(projectFileForHref("notes/index.md", href, windows), String(href)).toBeNull();
    }
  });

  it("measures LaTeX links from the main document and every other link from its own file", () => {
    expect(linkBase("chapters/one.tex", "main.tex")).toBe("main.tex");
    expect(linkBase("notes/index.md", "main.tex")).toBe("notes/index.md");
    expect(linkBase("chapters/one.typ", "main.typ")).toBe("chapters/one.typ");
  });
});
