import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";
import { fencedLines } from "@/lib/code-fences";
import { frontMatterBody, frontMatterValues } from "@/lib/front-matter";
import type { NoteDraft } from "./notes-data";
import { blocksGallery, createStarterNote } from "./starter-note";
import shipped from "./tests/blocks-gallery.md?raw";
import type { NoteItem } from "./types";
import "./tests/setup";

const GERMAN = {
  blocks: { source: "Quelltext", artifact: { run: "Ausführen" } },
  starter: {
    blocksGallery: {
      title: "Blockgalerie",
      intro: "Jeder Block, den eine Notiz enthalten kann. Klicke auf {{source}}, und tippe {{slash}} in eine leere Zeile.",
      charts: "Diagramme",
      functionPlots: "Funktionsgraphen",
      tables: "Tabellen",
      csvTable: "Ein CSV-Block lässt sich sortieren und filtern:",
      markdownTable: "Einfache Markdown-Tabellen gehen auch:",
      math: "Mathematik und Chemie",
      typst: "Typst-Satz",
      diagrams: "Schaubilder",
      svg: "SVG-Grafik",
      html: "HTML, drücke {{run}}",
      react: "React, drücke {{run}}",
      structures: "Strukturformeln",
      molecule: "Molekül in 3D",
      sequences: "Sequenzen",
      code: "Quellcode",
    },
  },
};

const english = i18n.getFixedT("en", ["notes"]);
const german = i18n.getFixedT("de", ["notes"]);
const shippedBody = frontMatterBody(shipped).replace(/^\n/u, "");

function blockLines(text: string): string[] {
  return fencedLines(text).flatMap((line) => (line.fenced ? [line.text] : []));
}

function note(title: string): NoteItem {
  return { id: title, title, project: "", updatedAt: 0, author: "you", summary: "" };
}

function created() {
  return vi.fn((_draft: NoteDraft) => Promise.resolve("note-1"));
}

beforeAll(() => {
  i18n.addResourceBundle("de", "notes", GERMAN, true, true);
});

afterAll(() => {
  i18n.removeResourceBundle("de", "notes");
});

describe("blocksGallery", () => {
  it("builds the shipped Blocks gallery note in English", () => {
    const values = frontMatterValues(shipped);
    const draft = blocksGallery(english);

    expect(draft.body).toBe(shippedBody);
    expect(draft).toEqual({
      title: values.get("title"),
      body: shippedBody,
      icon: values.get("icon"),
      color: values.get("color"),
      tags: ["guide"],
    });
    expect(values.get("tags")).toBe("[guide]");
  });

  it("keeps every block source the same in another language", () => {
    const blocks = blockLines(shippedBody);

    expect(blocks.filter((line) => line.startsWith("```")).length).toBe(40);
    expect(blockLines(blocksGallery(english).body ?? "")).toEqual(blocks);
    expect(blockLines(blocksGallery(german).body ?? "")).toEqual(blocks);
  });

  it("changes only the title and the prose lines in another language", () => {
    const before = (blocksGallery(english).body ?? "").split("\n");
    const draft = blocksGallery(german);
    const after = (draft.body ?? "").split("\n");
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [line]));
    const prose = fencedLines(shippedBody).flatMap((line) =>
      !line.fenced && line.text !== "" && !line.text.startsWith("|") ? [line.text] : [],
    );

    expect(after).toHaveLength(before.length);
    expect(prose).toHaveLength(16);
    expect(changed).toEqual(prose);
    expect(draft.title).toBe("Blockgalerie");
    expect(after[0]).toBe("Jeder Block, den eine Notiz enthalten kann. Klicke auf **Quelltext**, und tippe `/` in eine leere Zeile.");
    expect(after).toContain("## HTML, drücke Ausführen");
    expect(after).toContain("## React, drücke Ausführen");
    expect({ icon: draft.icon, color: draft.color, tags: draft.tags }).toEqual({ icon: "lucide:shapes", color: "lilac", tags: ["guide"] });
  });
});

describe("createStarterNote", () => {
  it("creates the note in the interface language when this data folder has not had it", async () => {
    const createNoteFrom = created();
    const claim = vi.fn(() => Promise.resolve(true));

    await expect(createStarterNote({ createNoteFrom, t: german, notes: () => [], claim })).resolves.toBe("note-1");

    expect(claim).toHaveBeenCalledTimes(1);
    expect(createNoteFrom).toHaveBeenCalledTimes(1);
    expect(createNoteFrom).toHaveBeenCalledWith(blocksGallery(german));
  });

  it("never brings the note back after it is deleted or the app restarts", async () => {
    const folder = { created: false };
    const claim = () => {
      const first = !folder.created;
      folder.created = true;
      return Promise.resolve(first);
    };
    const createNoteFrom = created();

    await createStarterNote({ createNoteFrom, t: english, notes: () => [], claim });
    await createStarterNote({ createNoteFrom, t: english, notes: () => [], claim });
    await expect(createStarterNote({ createNoteFrom: created(), t: english, notes: () => [], claim })).resolves.toBeNull();

    expect(createNoteFrom).toHaveBeenCalledTimes(1);
  });

  it("creates one note when two Notes views open at once", async () => {
    let taken = false;
    const claim = async () => {
      await Promise.resolve();
      const first = !taken;
      taken = true;
      return first;
    };
    const createNoteFrom = created();

    const results = await Promise.all([
      createStarterNote({ createNoteFrom, t: english, notes: () => [], claim }),
      createStarterNote({ createNoteFrom, t: english, notes: () => [], claim }),
    ]);

    expect(results.filter((id) => id !== null)).toEqual(["note-1"]);
    expect(createNoteFrom).toHaveBeenCalledTimes(1);
  });

  it("does not claim the note where notes cannot be created", async () => {
    const claim = vi.fn(() => Promise.resolve(true));

    await expect(createStarterNote({ createNoteFrom: undefined, t: english, notes: () => [], claim })).resolves.toBeNull();

    expect(claim).not.toHaveBeenCalled();
  });

  it("creates nothing when the claim is refused or answers with something else", async () => {
    const createNoteFrom = created();

    await createStarterNote({ createNoteFrom, t: english, notes: () => [], claim: () => Promise.resolve(false) });
    await createStarterNote({ createNoteFrom, t: english, notes: () => [], claim: () => Promise.resolve(undefined as unknown as boolean) });

    expect(createNoteFrom).not.toHaveBeenCalled();
  });

  it("leaves a note with the same title alone", async () => {
    const createNoteFrom = created();

    await expect(
      createStarterNote({ createNoteFrom, t: english, notes: () => [note("Blocks gallery")], claim: () => Promise.resolve(true) }),
    ).resolves.toBeNull();

    expect(createNoteFrom).not.toHaveBeenCalled();
  });
});
