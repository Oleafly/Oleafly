import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composerContextBlock,
  expandComposerContext,
  markComposerContextSent,
  registerComposerContextKind,
  withComposerContext,
  type ComposerContextItem,
} from "./composer-context";

vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

const unregister: Array<() => void> = [];

function item(kind: string, refId: string, label = `${kind} ${refId}`): ComposerContextItem {
  return { id: `${kind}:${refId}`, kind, refId, label };
}

function register(kind: string, handler: Parameters<typeof registerComposerContextKind>[1]) {
  unregister.push(registerComposerContextKind(kind, handler));
}

afterEach(() => {
  for (const stop of unregister.splice(0)) stop();
});

describe("composer context registry", () => {
  it("expands each kind once, in the order the items were added", async () => {
    const notes = vi.fn(async (_projectId: string, refIds: readonly string[]) =>
      refIds.map((refId) => ({ refId, path: `notes/${refId}.md`, text: `note ${refId}` })),
    );
    const marks = vi.fn(async (_projectId: string, refIds: readonly string[]) =>
      refIds.map((refId) => ({ refId, path: null, text: `mark ${refId}` })),
    );
    register("note", { expand: notes });
    register("mark", { expand: marks });

    const items = [item("note", "a"), item("mark", "m"), item("note", "b")];
    const expanded = await expandComposerContext("paper", items);

    expect(notes).toHaveBeenCalledExactlyOnceWith("paper", ["a", "b"]);
    expect(marks).toHaveBeenCalledExactlyOnceWith("paper", ["m"]);
    expect(expanded.map((entry) => [entry.item.id, entry.path, entry.text])).toEqual([
      ["note:a", "notes/a.md", "note a"],
      ["mark:m", null, "mark m"],
      ["note:b", "notes/b.md", "note b"],
    ]);
  });

  it("expands unknown kinds and missing references to nothing", async () => {
    register("note", { expand: async () => [{ refId: "a", path: null, text: "kept" }] });
    const expanded = await expandComposerContext("paper", [item("note", "a"), item("note", "gone"), item("other", "x")]);
    expect(expanded.map((entry) => entry.item.id)).toEqual(["note:a"]);
    expect(await expandComposerContext("paper", [])).toEqual([]);
  });

  it("lets an expansion error reach the caller", async () => {
    register("note", { expand: async () => { throw new Error("unreadable"); } });
    await expect(expandComposerContext("paper", [item("note", "a")])).rejects.toThrow("unreadable");
  });

  it("tells each kind which of its references were sent, and keeps going past a failing kind", () => {
    const sent = vi.fn();
    register("broken", { expand: async () => [], sent: () => { throw new Error("boom"); } });
    register("note", { expand: async () => [], sent });
    register("quiet", { expand: async () => [] });

    markComposerContextSent("paper", [item("broken", "x"), item("note", "a"), item("quiet", "q"), item("note", "b")]);

    expect(sent).toHaveBeenCalledExactlyOnceWith("paper", ["a", "b"]);
  });

  it("forgets a kind once it is unregistered, but not a newer handler for it", async () => {
    const first = registerComposerContextKind("note", { expand: async () => [{ refId: "a", path: null, text: "old" }] });
    register("note", { expand: async () => [{ refId: "a", path: null, text: "new" }] });
    first();
    const [entry] = await expandComposerContext("paper", [item("note", "a")]);
    expect(entry?.text).toBe("new");
  });
});

describe("composer context prompt text", () => {
  it("puts each item in a fenced block after its label and path", () => {
    const block = composerContextBlock([
      { item: item("note", "a", "Note on page 2"), refId: "a", path: "main.tex", text: "Fix the sign" },
      { item: item("note", "b", "Note on page 3"), refId: "b", path: null, text: "Has ``` inside" },
    ]);
    expect(block).toBe(
      "Note on page 2 (main.tex):\n```\nFix the sign\n```\n\nNote on page 3:\n````\nHas ``` inside\n````",
    );
  });

  it("uses an item's own heading when it gives one, so stale labels never reach the prompt", () => {
    const block = composerContextBlock([
      { item: item("note", "a", "1 · main.tex:12"), refId: "a", path: "main.tex", heading: "PDF annotation 1", text: "body" },
    ]);
    expect(block).toBe("PDF annotation 1:\n```\nbody\n```");
  });

  it("appends the blocks after the typed text, or stands alone without it", () => {
    const expanded = [{ item: item("note", "a", "Note"), refId: "a", path: null, text: "body" }];
    expect(withComposerContext("Please check", expanded)).toBe("Please check\n\nNote:\n```\nbody\n```");
    expect(withComposerContext("  ", expanded)).toBe("Note:\n```\nbody\n```");
    expect(withComposerContext("Please check", [])).toBe("Please check");
  });
});
