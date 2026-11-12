import { describe, expect, it } from "vitest";
import {
  headingSlug,
  isLinkableId,
  noteHeadings,
  noteLinkHref,
  noteSection,
  parseNoteLink,
  plainHeading,
  targetKey,
  uniqueSlugs,
} from "./note-link-format";

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

  it("leaves no tag behind when tags are nested inside each other", () => {
    expect(plainHeading("Intro <scr<b>ipt>alert(1)</scr</b>ipt> end")).not.toContain("<");
    expect(plainHeading("<<b>script>Bold</b>")).not.toContain("<");
    expect(plainHeading("A <i>very</i> <b>bold</b> claim")).toBe("A very bold claim");
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
