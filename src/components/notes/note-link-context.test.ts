// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  noteFacts: vi.fn(),
  readFileContent: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  noteFacts: tauri.noteFacts,
  readFileContent: tauri.readFileContent,
}));
import { base64ToBytes } from "@/lib/base64";
import type { NoteFacts } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { linkedNoteTexts, noteAddressesIn, noteLinkAttachments, noteLinkSelections } from "./note-link-context";

const TEXT = "---\nid: n-1\n---\n## Results ^res\n\nAccuracy rose to 64% ^acc\n\nMore text.\n";

function fact(id: string, noteId: string | null, title: string): NoteFacts {
  return {
    id,
    noteId,
    title,
    icon: null,
    color: null,
    agent: null,
    tags: [],
    aliases: [],
    properties: {},
    preview: "",
    relatedProject: null,
    updatedAt: 0,
    knowledge: "",
    taskDigest: "",
  };
}

const sources = {
  facts: () => Promise.resolve([fact("lib-1", "n-1", "Masking report"), fact("lib-2", null, "No id")]),
  read: vi.fn((id: string) => (id === "lib-1" ? Promise.resolve(TEXT) : Promise.reject(new Error("io")))),
};

function decoded(dataUrl: string): string {
  return new TextDecoder().decode(base64ToBytes(dataUrl.split(",")[1] ?? ""));
}

afterEach(() => {
  useSettingsStore.setState({ notes: false });
});

describe("note links in chat messages", () => {
  it("finds note addresses once each and decodes their fragments", () => {
    expect(
      noteAddressesIn("See oleafly://note/n-1#^acc, (oleafly://note/n-1#^acc) and <oleafly://note/n-2#two%20words> or oleafly://note/n-3/"),
    ).toEqual([
      { noteId: "n-1", fragment: "^acc" },
      { noteId: "n-2", fragment: "two words" },
      { noteId: "n-3", fragment: null },
    ]);
    expect(noteAddressesIn("no links")).toEqual([]);
  });

  it("reads the linked block, heading or note and skips what it can't find", async () => {
    const found = await linkedNoteTexts(
      "oleafly://note/n-1#^acc oleafly://note/n-1#results oleafly://note/n-1 oleafly://note/n-1#^gone oleafly://note/zzz",
      sources,
    );
    expect(found.map((entry) => [entry.fragment, entry.label, entry.markdown])).toEqual([
      ["^acc", "Accuracy rose to 64%", "Accuracy rose to 64%"],
      ["results", "Results", "## Results\n\nAccuracy rose to 64%\n\nMore text."],
      [null, "", "## Results\n\nAccuracy rose to 64%\n\nMore text."],
    ]);
  });

  it("attaches linked blocks only while Notes is on", async () => {
    expect(await noteLinkAttachments("oleafly://note/n-1#^acc", sources)).toEqual([]);
    useSettingsStore.setState({ notes: true });
    const [attachment] = await noteLinkAttachments("Use oleafly://note/n-1#^acc please", sources);
    expect(attachment).toMatchObject({ id: "note-link:n-1#^acc", name: "Masking report > Accuracy rose to 64%", mediaType: "text/plain" });
    const text = decoded(attachment.dataUrl);
    expect(text).toContain('A block of the note "Masking report" > "Accuracy rose to 64%"');
    expect(text).toContain("untrusted reference data");
    const [selection] = await noteLinkSelections("oleafly://note/n-1#^acc", sources);
    expect(selection.path).toBeNull();
    expect(selection.text).toContain("Accuracy rose to 64%");
  });

  it("reads notes through the app when no readers are given", async () => {
    tauri.noteFacts.mockResolvedValue([fact("lib-1", "n-1", "Masking report")]);
    tauri.readFileContent.mockResolvedValue(TEXT);
    useFilesStore.setState({ projects: [{ id: "lib-1", main_doc: "notes.md" }] } as unknown as ReturnType<typeof useFilesStore.getState>);
    const [found] = await linkedNoteTexts("oleafly://note/n-1#^acc");
    expect(found.markdown).toBe("Accuracy rose to 64%");
    expect(tauri.readFileContent).toHaveBeenCalledWith("lib-1", "notes.md");
    useFilesStore.setState({ projects: [] } as unknown as ReturnType<typeof useFilesStore.getState>);
    await linkedNoteTexts("oleafly://note/n-1#%E0%A4%A");
    expect(tauri.readFileContent).toHaveBeenLastCalledWith("lib-1", "note.md");
  });
});
