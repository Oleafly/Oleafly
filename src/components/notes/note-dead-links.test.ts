// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNoteEditor } from "@/lib/open-note-editors";
import type { NoteLinkRecord } from "@/lib/tauri";
import { findDeadLinks, firstLinkLabel, fixNoteLinks, linkMatches, rewriteDocLinks, rewriteNoteLinks } from "./note-dead-links";
import { noteLinkExtensions, type LinkableNote } from "./note-links";
import { destroyKbEditors, kbEditor, kbMarkdown } from "./tests/kb-editor-fixtures";
import "./tests/setup";

afterEach(destroyKbEditors);

const NOTES: LinkableNote[] = [
  { noteId: "n-1", projectId: "lib-1", title: "Masking report" },
  { noteId: "n-2", projectId: "lib-2", title: "Abstract draft" },
];

function record(projectId: string, links: NoteLinkRecord["links"], blocks: string[] = []): NoteLinkRecord {
  return { projectId, noteId: projectId.replace("lib", "n"), title: projectId, links, blocks };
}

describe("finding dead links", () => {
  it("lists links to missing notes and to missing blocks of existing notes", () => {
    const records = [
      record("lib-1", [
        { kind: "note", id: "gone", snippet: "See gone", line: 5 },
        { kind: "note", id: "n-2", snippet: "ok", line: 6 },
        { kind: "note", id: "n-2", snippet: "block gone", block: "zzz", line: 7 },
        { kind: "note", id: "n-2", snippet: "block ok", block: "acc", line: 8 },
        { kind: "project", id: "p", snippet: "project", line: 9 },
      ]),
      record("lib-2", [{ kind: "note", id: "n-1", snippet: "fine", block: "unknown-but-no-record", line: 3 }], ["acc"]),
    ];
    const dead = findDeadLinks(records, NOTES);
    expect(dead.map((link) => [link.sourceId, link.missing, link.targetId, link.block, link.line])).toEqual([
      ["lib-1", "note", "gone", null, 5],
      ["lib-1", "block", "n-2", "zzz", 7],
      ["lib-2", "block", "n-1", "unknown-but-no-record", 3],
    ]);
    expect(dead[1].target?.title).toBe("Abstract draft");
    expect(findDeadLinks([record("lib-1", [{ kind: "note", id: "n-2", snippet: "", block: "x" }])], NOTES)).toEqual([]);
  });
});

describe("fixing dead links in text", () => {
  const TEXT = [
    "See [old](oleafly://note/gone) and [Old \\[draft\\]](<oleafly://note/gone#^b1> \"t\").",
    "Keep [other](oleafly://note/n-2) and ![embed](oleafly://note/gone#intro).",
    "```",
    "[code](oleafly://note/gone)",
    "```",
    "Block [one](oleafly://note/n-2#^zzz) and [two](oleafly://note/n-2#%5Ezzz) and [fine](oleafly://note/n-2#^acc).",
  ].join("\n");

  it("removes every link to a missing note but leaves code alone", () => {
    const { text, count } = rewriteNoteLinks(TEXT, { noteId: "gone", block: null }, { kind: "remove" });
    expect(count).toBe(3);
    expect(text.split("\n").slice(0, 4)).toEqual([
      "See old and Old \\[draft\\].",
      "Keep [other](oleafly://note/n-2) and embed.",
      "```",
      "[code](oleafly://note/gone)",
    ]);
  });

  it("points block links back at the note, or at a new note", () => {
    const relinked = rewriteNoteLinks(TEXT, { noteId: "n-2", block: "zzz" }, { kind: "relink", noteId: "n-2" });
    expect(relinked.count).toBe(2);
    expect(relinked.text.split("\n")[5]).toBe(
      "Block [one](oleafly://note/n-2) and [two](oleafly://note/n-2) and [fine](oleafly://note/n-2#^acc).",
    );
    const created = rewriteNoteLinks(TEXT, { noteId: "gone", block: null }, { kind: "relink", noteId: "new-1" });
    expect(created.text.split("\n")[1]).toBe("Keep [other](oleafly://note/n-2) and ![embed](oleafly://note/new-1).");
    expect(firstLinkLabel(TEXT, { noteId: "gone", block: null })).toBe("old");
    expect(firstLinkLabel(TEXT, { noteId: "gone", block: "b1" })).toBe("Old [draft]");
    expect(firstLinkLabel(TEXT, { noteId: "none", block: null })).toBeNull();
    expect(linkMatches("oleafly://project/gone", { noteId: "gone", block: null })).toBe(false);
  });

  it("edits the open editor when the note is open, and the file otherwise", async () => {
    const editor = kbEditor("See [old](oleafly://note/gone) and [b](oleafly://note/n-2#^zzz) and ![e](oleafly://note/gone)", null, noteLinkExtensions({ getNotes: () => NOTES, getProjects: () => [], onOpenNote: vi.fn(), onOpenProject: vi.fn() }));
    expect(rewriteDocLinks(editor.view, { noteId: "n-2", block: "zzz" }, { kind: "relink", noteId: "n-2" })).toBe(1);
    expect(kbMarkdown(editor)).toContain("[b](oleafly://note/n-2)");
    const stop = registerNoteEditor("lib-1", {
      editor,
      root: null,
      text: () => "",
      flush: () => Promise.resolve(null),
      busy: () => false,
      history: () => undefined,
      title: () => "",
      timedOut: () => "",
    });
    const store = { load: vi.fn(), save: vi.fn() };
    expect(await fixNoteLinks("lib-1", { noteId: "gone", block: null }, { kind: "remove" }, store)).toBe(2);
    expect(kbMarkdown(editor)).not.toContain("oleafly://note/gone");
    expect(store.load).not.toHaveBeenCalled();
    stop();
    const closed = { load: vi.fn(async () => ({ text: "A [x](oleafly://note/gone)", version: "v1" })), save: vi.fn(async () => undefined) };
    expect(await fixNoteLinks("lib-9", { noteId: "gone", block: null }, { kind: "remove" }, closed)).toBe(1);
    expect(closed.save).toHaveBeenCalledWith("lib-9", "A x", "v1");
    editor.setEditable(false);
    expect(rewriteDocLinks(editor.view, { noteId: "n-2", block: null }, { kind: "remove" })).toBe(0);
  });
});
