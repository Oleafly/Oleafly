import { describe, expect, it } from "vitest";
import {
  headingSlug,
  isLinkableId,
  linkTargets,
  noteHeadings,
  noteLinkHref,
  noteSection,
  parseNoteLink,
  plainHeading,
  SNIPPET_CHARS,
  targetKey,
  uniqueSlugs,
} from "./note-link-format";

const words = (count: number, word: string) => Array.from({ length: count }, () => word).join(" ");

describe("note link addresses", () => {
  it("writes and reads note and project links", () => {
    expect(noteLinkHref("note", "abc-1")).toBe("oleafly://note/abc-1");
    expect(noteLinkHref("project", "p_9")).toBe("oleafly://project/p_9");
    expect(parseNoteLink("oleafly://note/abc-1")).toEqual({ kind: "note", id: "abc-1" });
    expect(parseNoteLink(" OLEAFLY://Project/x_y/ ")).toEqual({ kind: "project", id: "x_y" });
    expect(targetKey({ kind: "note", id: "a" })).toBe("note:a");
  });

  it.each([
    "oleafly://note/",
    "oleafly://note/a/b",
    "oleafly://note/a b",
    "oleafly://note/a.b",
    "oleafly://note/a?x=1",
    "oleafly://template/a",
    "oleafly://note",
    "https://note/a",
    "oleafly:note/a",
    "",
  ])("refuses %s", (href) => {
    expect(parseNoteLink(href)).toBeNull();
  });

  it("refuses a missing address and ids that are too long or unsafe", () => {
    expect(parseNoteLink(null)).toBeNull();
    expect(parseNoteLink(undefined)).toBeNull();
    expect(isLinkableId("a".repeat(128))).toBe(true);
    expect(isLinkableId("a".repeat(129))).toBe(false);
    expect(parseNoteLink(`oleafly://note/${"a".repeat(129)}`)).toBeNull();
    expect(isLinkableId("")).toBe(false);
    expect(isLinkableId(null)).toBe(false);
    expect(isLinkableId("a b")).toBe(false);
  });
});

describe("link targets in a note", () => {
  it("reads every target once with plain text around it", () => {
    const text =
      "---\ntitle: Abstract\nid: note-2\n---\n\nSee [Masking ablation](oleafly://note/note-1) and the [Encoder study](oleafly://project/p_9 \"study\").\n";
    expect(linkTargets(text)).toEqual([
      { kind: "note", id: "note-1", snippet: "See Masking ablation and the Encoder study." },
      { kind: "project", id: "p_9", snippet: "See Masking ablation and the Encoder study." },
    ]);
  });

  it("treats an unclosed front matter fence as text", () => {
    expect(linkTargets("---\n[x](oleafly://note/b)\n")).toEqual([{ kind: "note", id: "b", snippet: "x" }]);
    expect(linkTargets("---\nid: a\n---\n[x](oleafly://note/b)")).toEqual([{ kind: "note", id: "b", snippet: "x" }]);
  });

  it("skips code and other links", () => {
    const text =
      "```\n[a](oleafly://note/fenced)\n```\n~~~md\n[b](oleafly://note/tilde)\n~~~\nUse `[c](oleafly://note/code)` or ``[d](oleafly://note/x)``.\n![e](images/e.png) [f](https://example.org) [g](oleafly://template/a/b)\n";
    expect(linkTargets(text)).toEqual([]);
  });

  it("keeps a backtick line inside a tilde fence, and reads four spaces of indent as text", () => {
    const text = "~~~\n```\n[a](oleafly://note/hidden)\n~~~\n[b](oleafly://note/after)\n    ```\n[c](oleafly://note/shown)\n";
    expect(linkTargets(text).map((mention) => mention.id)).toEqual(["after", "shown"]);
    expect(noteHeadings("~~~\n```\n# Hidden\n~~~\n# Shown").map((heading) => heading.text)).toEqual(["Shown"]);
  });

  it("reads an unmatched backtick run as text, the way the Rust index does", () => {
    expect(linkTargets("``a`b [x](oleafly://note/a) `c")).toEqual([]);
    expect(linkTargets("``a [x](oleafly://note/b)").map((mention) => mention.id)).toEqual(["b"]);
  });

  it("counts embeds and heading links as links to the note", () => {
    expect(linkTargets("![Method](oleafly://note/m1)\nSee [Setup](oleafly://note/m2#set-up).\n")).toEqual([
      { kind: "note", id: "m1", snippet: "Method" },
      { kind: "note", id: "m2", snippet: "See Setup." },
    ]);
  });

  it("reads autolinks, angle destinations and links after block markers", () => {
    const text =
      "## [Heading link](oleafly://note/h)\n> - [x] Task [Ref](<oleafly://project/p>) done\n1. <oleafly://note/auto> and <https://example.org>\n| a | [Cell](oleafly://note/c) |\n";
    expect(linkTargets(text)).toEqual([
      { kind: "note", id: "h", snippet: "Heading link" },
      { kind: "project", id: "p", snippet: "Task Ref done" },
      { kind: "note", id: "auto", snippet: "oleafly://note/auto and https://example.org" },
      { kind: "note", id: "c", snippet: "a Cell" },
    ]);
  });

  it("keeps the first mention and strips inline markup", () => {
    const text = `${String.raw`First **bold** [A\] *b*](oleafly://note/a) ~~gone~~ \*kept\*.`}\r\nAgain [A](oleafly://note/a).\n`;
    expect(linkTargets(text)).toEqual([{ kind: "note", id: "a", snippet: "First bold A] b gone *kept*." }]);
  });

  it("ignores unclosed and odd markup", () => {
    const text =
      "[open](oleafly://note/a\n[x] (oleafly://note/b)\n[y](<oleafly://note/c)\n[z](oleafly://note/d \"t)\n<oleafly://note/e\n<not a link> `unclosed [w](oleafly://note/f)\n[nested [inner] text](oleafly://note/g) [](oleafly://note/h) [p](a(b)c)\n#nospace [q](oleafly://note/i)\n12345678901. [r](oleafly://note/j)\n-x [s](oleafly://note/k)\n- [ ]x [t](oleafly://note/l)\n[never closed (oleafly://note/m)\n``a`b`` [u](oleafly://note/n)\n<b>[v](oleafly://note/o)</b>\n";
    expect(linkTargets(text)).toEqual([
      { kind: "note", id: "f", snippet: "<not a link> unclosed w" },
      { kind: "note", id: "g", snippet: "nested [inner] text p" },
      { kind: "note", id: "h", snippet: "nested [inner] text p" },
      { kind: "note", id: "i", snippet: "#nospace q" },
      { kind: "note", id: "j", snippet: "12345678901. r" },
      { kind: "note", id: "k", snippet: "-x s" },
      { kind: "note", id: "l", snippet: "[ ]x t" },
      { kind: "note", id: "n", snippet: "a`b u" },
      { kind: "note", id: "o", snippet: "<b>v</b>" },
    ]);
  });

  it("reads escaped characters inside a destination and a title", () => {
    expect(linkTargets(String.raw`[a](<oleafly://note/a\>>) [b](oleafly://note/b "t \" q") [c](x\)y) end\ `)).toEqual([
      { kind: "note", id: "b", snippet: "a b c end" },
    ]);
  });

  it("cuts long lines around the link at word boundaries", () => {
    const middle = linkTargets(`${words(30, "before")} [Target](oleafly://note/a) ${words(30, "after")}\n`)[0].snippet;
    expect(middle.startsWith("…before")).toBe(true);
    expect(middle.endsWith("after…")).toBe(true);
    expect(middle).toContain("before Target after");
    expect(Array.from(middle).length).toBeLessThanOrEqual(SNIPPET_CHARS + 2);

    const start = linkTargets(`[Target](oleafly://note/a) ${words(40, "after")}\n`)[0].snippet;
    expect(start.startsWith("Target after")).toBe(true);
    expect(start.endsWith("…")).toBe(true);

    const end = linkTargets(`${words(40, "before")} [Target](oleafly://note/a)\n`)[0].snippet;
    expect(end.startsWith("…")).toBe(true);
    expect(end.endsWith("before Target")).toBe(true);

    const long = linkTargets(`x [${"Long".repeat(SNIPPET_CHARS / 2)}](oleafly://note/a) y\n`)[0].snippet;
    expect(long.startsWith("…Long")).toBe(true);
    expect(long.endsWith("…")).toBe(true);

    const unbroken = linkTargets(`${"b".repeat(90)}[T](oleafly://note/a)${"a".repeat(90)}\n`)[0].snippet;
    expect(Array.from(unbroken)).toHaveLength(SNIPPET_CHARS + 2);
  });
});

describe("heading links", () => {
  it("writes and reads a heading on a note link", () => {
    expect(noteLinkHref("note", "abc", "café-au-lait")).toBe("oleafly://note/abc#caf%C3%A9-au-lait");
    expect(parseNoteLink("oleafly://note/abc#caf%C3%A9-au-lait")).toEqual({ kind: "note", id: "abc", heading: "café-au-lait" });
    expect(parseNoteLink("oleafly://note/abc/#setup")).toEqual({ kind: "note", id: "abc", heading: "setup" });
    expect(parseNoteLink("oleafly://note/abc#%E0%A4%A")).toEqual({ kind: "note", id: "abc", heading: "%E0%A4%A" });
    expect(parseNoteLink("oleafly://note/abc#")).toEqual({ kind: "note", id: "abc" });
    expect(parseNoteLink("oleafly://project/p#x")).toEqual({ kind: "project", id: "p" });
  });

  it("makes GitHub style slugs and numbers repeats", () => {
    expect(headingSlug(" Results & Discussion ")).toBe("results--discussion");
    expect(headingSlug("Ünïcode Straße_2")).toBe("ünïcode-straße_2");
    expect(headingSlug("C++ (2024)!")).toBe("c-2024");
    expect(uniqueSlugs(["Intro", "Intro", "", "Intro"])).toEqual(["intro", "intro-1", "", "intro-2"]);
  });

  it("reads heading text without inline markup", () => {
    expect(plainHeading("**Bold** and _it_ with `code` [link](x) ![alt](y.png) <b>t</b> \\# ==hi==")).toBe(
      "Bold and it with code link alt t # hi",
    );
    expect(plainHeading("a   b")).toBe("a b");
  });

  it("lists ATX headings outside fences and front matter", () => {
    const text = "---\ntitle: x\n---\n# One\n```\n# not\n```\n## Two ##\n#nospace\n###\n## Two\n~~~\n# also not\n";
    expect(noteHeadings(text)).toEqual([
      { level: 1, text: "One", slug: "one" },
      { level: 2, text: "Two", slug: "two" },
      { level: 2, text: "Two", slug: "two-1" },
    ]);
  });

  it("cuts the section under a heading", () => {
    const text = "# A\nintro\n## B\nbee\n### C\nsee\n```\n# fence\n```\n## D\ndee\n# E\n";
    expect(noteSection(text, "b")).toBe("## B\nbee\n### C\nsee\n```\n# fence\n```");
    expect(noteSection(text, "e")).toBe("# E");
    expect(noteSection(text, "missing")).toBeNull();
  });
});
