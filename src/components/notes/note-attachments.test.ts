// @vitest-environment jsdom
import type { FileEntry } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reveal = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./note-reveal", () => ({ revealNoteLocation: reveal }));

import {
  type AttachmentRows,
  type AttachmentSources,
  attachmentLine,
  attachmentType,
  filterAttachments,
  type NoteAttachment,
  noteAttachments,
  noteFileReferences,
  revealAttachment,
} from "./note-attachments";
import type { NoteItem } from "./types";

function note(id: string, updatedAt: number, title = id): NoteItem {
  return { id, title, project: "Notes", updatedAt, author: "you", summary: "" };
}

function file(path: string, is_dir = false): FileEntry {
  return { path, is_dir };
}

interface FakeNote {
  files: readonly FileEntry[];
  text: string;
}

function sources(byId: Record<string, FakeNote | Error>) {
  const found = (id: string): FakeNote => {
    const entry = byId[id];
    if (entry instanceof Error) throw entry;
    return entry;
  };
  return {
    listFiles: vi.fn(async (id: string) => found(id).files),
    fileSizes: vi.fn(async (_id: string, paths: readonly string[]) => Object.fromEntries(paths.map((path, index) => [path, (index + 1) * 1024]))),
    noteText: vi.fn(async (id: string) => found(id).text),
  } satisfies AttachmentSources;
}

beforeEach(() => {
  reveal.mockClear();
});

describe("noteFileReferences", () => {
  it("reads images, media, file links and the file blocks the editor draws", () => {
    const source = [
      "---",
      "title: Lab",
      "---",
      "",
      "![plot](./assets/plot%20one.png){width=50%}",
      "",
      "![page](assets/paper.pdf#page=3) and [slides](<assets/talk slides.key>)",
      "",
      "![talk](assets\\talk.mp4)",
      "",
      "```tsv",
      "path: assets/runs.tsv",
      "```",
      "",
      "```pdb",
      "style: stick",
      "path: assets/protein.pdb",
      "```",
      "",
      "```notebook",
      "assets/analysis.ipynb",
      "cells: 1-2",
      "```",
      "",
      "```python",
      "path: assets/not-a-block.csv",
      "```",
      "",
      "![remote](https://example.com/x.png) ![up](../secret.png) [web](https://example.com)",
    ].join("\n");
    expect(noteFileReferences(source)).toEqual([
      { path: "assets/plot one.png", line: 5 },
      { path: "assets/paper.pdf", line: 7 },
      { path: "assets/talk slides.key", line: 7 },
      { path: "assets/talk.mp4", line: 9 },
      { path: "assets/runs.tsv", line: 11 },
      { path: "assets/protein.pdb", line: 15 },
      { path: "assets/analysis.ipynb", line: 20 },
    ]);
  });

  it("gives the line of the first block that uses a file", () => {
    const source = "---\nid: x\n---\n\nIntro\n\n![a](assets/A.png)\n\n![b](assets/a.png)\n";
    expect(attachmentLine(source, "assets/a.png")).toBe(7);
    expect(attachmentLine(source, "assets/missing.png")).toBeNull();
  });
});

describe("attachmentType", () => {
  it("sorts files into images, audio, video, PDFs and everything else", () => {
    expect(["a.PNG", "b.avif", "c.mp3", "d.flac", "e.mov", "f.webm", "g.pdf", "h.csv", "i.ipynb", "j.zip"].map(attachmentType)).toEqual([
      "image",
      "image",
      "audio",
      "audio",
      "video",
      "video",
      "pdf",
      "other",
      "other",
      "other",
    ]);
  });
});

describe("noteAttachments", () => {
  it("lists the files in each note's assets folder and marks the ones no note uses", async () => {
    const read = sources({
      lab: {
        files: [
          file("note.md"),
          file("assets", true),
          file("assets/plot.png"),
          file("assets/Unused.csv"),
          file("assets/.DS_Store"),
          file("assets/origins/plot.png.json"),
          file("assets/sub/talk.MP4"),
        ],
        text: "![plot](Assets/PLOT.png)\n\n![talk](assets/sub/talk.MP4)\n",
      },
      older: { files: [file("note.md"), file("assets/paper.pdf")], text: "No files here.\n" },
      empty: { files: [file("note.md")], text: "![gone](assets/gone.png)\n" },
    });
    const found = await noteAttachments([note("older", 1), note("lab", 5), note("empty", 3)], read);
    expect(found.map(({ noteId, path, name, size, type, used }) => ({ noteId, path, name, size, type, used }))).toEqual([
      { noteId: "lab", path: "assets/plot.png", name: "plot.png", size: 1024, type: "image", used: true },
      { noteId: "lab", path: "assets/sub/talk.MP4", name: "talk.MP4", size: 3072, type: "video", used: true },
      { noteId: "lab", path: "assets/Unused.csv", name: "Unused.csv", size: 2048, type: "other", used: false },
      { noteId: "older", path: "assets/paper.pdf", name: "paper.pdf", size: 1024, type: "pdf", used: false },
    ]);
    expect(read.noteText).not.toHaveBeenCalledWith("empty");
    expect(read.fileSizes).toHaveBeenCalledWith("lab", ["assets/plot.png", "assets/Unused.csv", "assets/sub/talk.MP4"]);
  });

  it("reads again only the notes that changed since the last scan", async () => {
    const known: AttachmentRows = new Map();
    const vault: Record<string, FakeNote> = {
      edited: { files: [file("assets/plot.png")], text: "![plot](assets/plot.png)\n" },
      kept: { files: [file("assets/table.csv")], text: "" },
    };
    const read = sources(vault);
    const calls = () => read.listFiles.mock.calls.map(([id]) => id).sort();
    const used = (found: readonly NoteAttachment[]) => found.map((item) => [item.noteId, item.used]);
    expect(used(await noteAttachments([note("edited", 1), note("kept", 1)], read, known))).toEqual([
      ["edited", true],
      ["kept", false],
    ]);
    expect(calls()).toEqual(["edited", "kept"]);

    read.listFiles.mockClear();
    vault.edited = { ...vault.edited, text: "Rewritten.\n" };
    expect(used(await noteAttachments([note("edited", 2), note("kept", 1)], read, known))).toEqual([
      ["edited", false],
      ["kept", false],
    ]);
    expect(calls()).toEqual(["edited"]);
    expect(read.noteText.mock.calls.map(([id]) => id)).toEqual(["edited", "kept", "edited"]);

    read.listFiles.mockClear();
    await noteAttachments([note("edited", 2), note("kept", 1)], read, known, ["kept"]);
    expect(calls()).toEqual(["kept"]);

    read.listFiles.mockClear();
    await noteAttachments([note("edited", 2)], read, known);
    expect(calls()).toEqual([]);
    expect([...known.keys()]).toEqual(["edited"]);
  });

  it("reads a note again after it failed once", async () => {
    const known: AttachmentRows = new Map();
    const read = sources({ flaky: { files: [file("assets/a.png")], text: "" }, steady: { files: [], text: "" } });
    read.listFiles.mockRejectedValueOnce(new Error("busy"));
    expect(await noteAttachments([note("flaky", 2), note("steady", 1)], read, known)).toEqual([]);
    read.listFiles.mockClear();
    expect((await noteAttachments([note("flaky", 2), note("steady", 1)], read, known)).map((item) => item.path)).toEqual(["assets/a.png"]);
    expect(read.listFiles.mock.calls.map(([id]) => id)).toEqual(["flaky"]);
  });

  it("skips a note it cannot read and fails only when it can read none", async () => {
    const broken = new Error("gone");
    const found = await noteAttachments(
      [note("bad", 2), note("good", 1)],
      sources({ bad: broken, good: { files: [file("assets/a.png")], text: "" } }),
    );
    expect(found.map((item) => item.noteId)).toEqual(["good"]);
    await expect(noteAttachments([note("bad", 1)], sources({ bad: broken }))).rejects.toBe(broken);
    await expect(noteAttachments([], sources({}))).resolves.toEqual([]);
  });
});

describe("filterAttachments", () => {
  const item = (name: string, type: NoteAttachment["type"], used: boolean, noteId = "lab"): NoteAttachment => ({
    key: `${noteId}/${name}`,
    noteId,
    path: `assets/${name}`,
    name,
    size: 1,
    type,
    used,
  });
  const items = [item("plot.png", "image", true), item("talk.mp3", "audio", false), item("paper.pdf", "pdf", true, "cafe")];
  const titles: Record<string, string> = { lab: "Lab plan", cafe: "Café notes" };
  const names = (filters: Parameters<typeof filterAttachments>[1]) =>
    filterAttachments(items, filters, (id) => titles[id] ?? "").map((found) => found.name);

  it("filters by type, by use and by words in the file name or note title", () => {
    expect(names({ type: "all", use: "all", search: "" })).toEqual(["plot.png", "talk.mp3", "paper.pdf"]);
    expect(names({ type: "audio", use: "all", search: "" })).toEqual(["talk.mp3"]);
    expect(names({ type: "all", use: "unused", search: "" })).toEqual(["talk.mp3"]);
    expect(names({ type: "all", use: "all", search: "cafe" })).toEqual(["paper.pdf"]);
    expect(names({ type: "all", use: "all", search: "lab PLOT" })).toEqual(["plot.png"]);
    expect(names({ type: "video", use: "all", search: "" })).toEqual([]);
  });
});

describe("revealAttachment", () => {
  it("shows the block that uses the file once the note opens", async () => {
    const source = "Intro\n\n![plot](assets/plot.png)\n";
    const loadNote = vi.fn(async () => ({ text: source, version: "v1" }));
    await revealAttachment("lab", "assets/plot.png", loadNote);
    expect(reveal).toHaveBeenCalledWith("lab", source, { path: "note.md", line: 3 }, expect.any(AbortSignal), { select: true, focus: true });
    reveal.mockClear();
    await revealAttachment("lab", "assets/other.png", loadNote);
    expect(reveal).not.toHaveBeenCalled();
  });
});
