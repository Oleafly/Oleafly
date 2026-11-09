import { describe, expect, it } from "vitest";
import {
  declaresNoteFile,
  isMarkdownFile,
  isProjectNotePath,
  noteFileFacts,
  noteFileName,
  noteFileStem,
  noteRelativePath,
  projectNoteFilePath,
  projectNoteKey,
  foldPath,
  isProjectNoteAssetPath,
  isWindowsReservedComponent,
  projectNotesFolder,
  renamedNotePath,
} from "./project-notes";

const NOTE = '---\ntitle: "Masking: a sweep"\nkind: note\nid: abc\nicon: lucide:atom\ncolor: mint\n---\n\nBody\n';

describe("project note paths", () => {
  it("recognises Markdown files", () => {
    expect(isMarkdownFile("notes/a.md")).toBe(true);
    expect(isMarkdownFile("notes/A.MD")).toBe(true);
    expect(isMarkdownFile("main.tex")).toBe(false);
  });

  it("treats Markdown files in the notes folder as project notes, but not assets", () => {
    expect(isProjectNotePath("notes/Plan.md")).toBe(true);
    expect(isProjectNotePath("notes/deep/Plan.md")).toBe(true);
    expect(isProjectNotePath("notes/assets/readme.md")).toBe(false);
    expect(isProjectNotePath("notes/data.csv")).toBe(false);
    expect(isProjectNotePath("docs/Plan.md")).toBe(false);
  });

  it("names the stem without the extension", () => {
    expect(noteFileStem("notes/Reading list.md")).toBe("Reading list");
    expect(noteFileStem("Plain.MD")).toBe("Plain");
  });

  it("builds keys from the path, so a copied note with the same front matter id gets its own key", () => {
    expect(projectNoteKey("p", "notes/a.md")).toBe("project-note:p:notes/a.md");
    expect(projectNoteKey("p", "notes/a copy.md")).not.toBe(projectNoteKey("p", "notes/a.md"));
  });

  it("finds the notes folder whatever its case", () => {
    expect(isProjectNotePath("Notes/Plan.md")).toBe(true);
    expect(isProjectNotePath("NOTES/assets/a.md")).toBe(false);
    expect(isProjectNoteAssetPath("Notes/Assets/fig.png")).toBe(true);
    expect(projectNotesFolder(["main.tex", "Notes/Plan.md"])).toBe("Notes");
    expect(projectNotesFolder(["main.tex"])).toBe("notes");
    expect(projectNoteFilePath("Plan", ["Notes", "Notes/plan.md"], "Untitled")).toBe("Notes/Plan 2.md");
  });
});

describe("note front matter", () => {
  it("reads the identity of a note file", () => {
    expect(noteFileFacts(NOTE)).toEqual({ title: "Masking: a sweep", id: "abc", icon: "lucide:atom", color: "mint" });
    expect(declaresNoteFile(NOTE)).toBe(true);
  });

  it("reads single quoted, commented and CRLF values, and a byte order mark", () => {
    const text = "﻿---\r\ntitle: 'It''s here'\r\nkind: note # a note\r\nicon:\r\n---\r\nBody";
    expect(noteFileFacts(text)).toEqual({ title: "It's here", id: null, icon: null, color: null });
  });

  it("accepts a closing dots fence and lets a later key win", () => {
    expect(noteFileFacts("---\nkind: draft\nkind: note\ntitle: A\n...\n")?.title).toBe("A");
  });

  it("drops a key whose later value is empty", () => {
    expect(noteFileFacts("---\nkind: note\ntitle: A\ntitle:\n---\n")?.title).toBeNull();
  });

  it("reads spaced and quoted keys and treats a bare comment as no value, like the Rust reader", () => {
    expect(noteFileFacts("---\nkind : note\n\"title\": A: b\nid: # none\n---\n")).toEqual({
      title: "A: b",
      id: null,
      icon: null,
      color: null,
    });
    expect(noteFileFacts("---\n---\nkind: note\n---\n")).toBeNull();
  });

  it("ignores files that are not notes", () => {
    expect(noteFileFacts(undefined)).toBeNull();
    expect(noteFileFacts("")).toBeNull();
    expect(noteFileFacts("# Heading\n")).toBeNull();
    expect(noteFileFacts("---\nkind: note\n")).toBeNull();
    expect(noteFileFacts("---\ntitle: A\n---\n")).toBeNull();
    expect(noteFileFacts('---\nkind: "note\n---\n')).toBeNull();
    expect(noteFileFacts('---\nkind: "no\\qte"\n---\n')).toBeNull();
    expect(noteFileFacts("---\nkind: 'note\n---\n")).toBeNull();
    expect(declaresNoteFile("---\nkind: notes\n---\n")).toBe(false);
  });

  it("skips lines that are not plain keys", () => {
    expect(noteFileFacts("---\n  nested: x\n- item\nkind: note\n---\n")).toEqual({
      title: null,
      id: null,
      icon: null,
      color: null,
    });
  });

  it("only reads the first few kilobytes", () => {
    expect(noteFileFacts(`---\n${"x: y\n".repeat(2000)}kind: note\n---\n`)).toBeNull();
  });
});

describe("note file names", () => {
  it("cleans titles into portable names", () => {
    expect(noteFileName('  Results: run 3/4 <final>?  ', "Untitled")).toBe("Results run 3 4 final");
    expect(noteFileName("...", "Untitled")).toBe("Untitled");
    expect(noteFileName("con", "Untitled")).toBe("con note");
    expect(noteFileName("x".repeat(120), "Untitled")).toHaveLength(80);
  });

  it("follows the portable name rules the Rust side uses", () => {
    expect(noteFileName("con.backup", "Untitled")).toBe("con note.backup");
    expect(noteFileName("COM\u00b9", "Untitled")).toBe("COM\u00b9 note");
    expect(noteFileName("Lpt9.draft.v2", "Untitled")).toBe("Lpt9 note.draft.v2");
    expect(noteFileName("Re\u00adsults\u200b \u202eplan", "Untitled")).toBe("Results plan");
    expect(noteFileName("Cafe\u0301", "Untitled")).toBe("Caf\u00e9");
    expect(noteFileName(`${"x".repeat(79)}.y`, "Untitled")).toBe("x".repeat(79));
    expect(isWindowsReservedComponent("nul.txt")).toBe(true);
    expect(isWindowsReservedComponent("console.md")).toBe(false);
  });

  it("folds case and normalization like portable.rs", () => {
    expect(foldPath("Notes/Cafe\u0301.MD")).toBe(foldPath("notes/caf\u00e9.md"));
    expect(foldPath("STRASSE")).toBe("strasse");
  });

  it("renames a note next to where it is, numbering names that are taken", () => {
    expect(renamedNotePath("notes/deep/Old.md", "New", ["notes/deep/new.md"], "Untitled")).toBe("notes/deep/New 2.md");
    expect(renamedNotePath("notes/Old.md", "Old", [], "Untitled")).toBe("notes/Old.md");
  });

  it("numbers names that are taken, ignoring case", () => {
    expect(projectNoteFilePath("Plan", ["main.tex"], "Untitled")).toBe("notes/Plan.md");
    expect(projectNoteFilePath("Plan", ["notes/plan.md", "notes/Plan 2.md"], "Untitled")).toBe("notes/Plan 3.md");
    expect(projectNoteFilePath("", [], "Untitled")).toBe("notes/Untitled.md");
  });
});

describe("paths relative to a note", () => {
  it("resolves asset paths next to the note file", () => {
    expect(noteRelativePath("notes/Plan.md", "assets/fig-1a2b3c4d.png")).toBe("notes/assets/fig-1a2b3c4d.png");
    expect(noteRelativePath("notes/Plan.md", "./assets\\x.png")).toBe("notes/assets/x.png");
    expect(noteRelativePath("notes/Plan.md", "../data.csv")).toBe("data.csv");
    expect(noteRelativePath("Plan.md", "a.png")).toBe("a.png");
  });

  it("refuses paths that leave the project", () => {
    expect(noteRelativePath("notes/Plan.md", "../../secret")).toBeNull();
    expect(noteRelativePath("notes/Plan.md", "..")).toBeNull();
  });
});
