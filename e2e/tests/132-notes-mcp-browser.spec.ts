import type { Page } from "@playwright/test";
import { expect, test } from "../notes-page";

function mcp(page: Page, name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ([tool, args]) => {
      const { createNoteMcpTools } = await import("/src/components/notes/note-mcp-tools.ts");
      const { proposeNoteEdits, reviewedNoteSource } = await import("/src/components/notes/note-pending-suggestions.ts");
      const fixture = (window as unknown as { __notes: { snapshot(): { notes: { id: string; noteId?: string }[]; loadNote(id: string): Promise<{ text: string }> } } }).__notes;
      const data = fixture.snapshot();
      const tools = createNoteMcpTools(
        {
          snapshot: async () => ({
            notes: data.notes as never,
            facts: data.notes.map((note) => ({ id: note.id, noteId: note.noteId ?? null })) as never,
          }),
          readNote: (id) => reviewedNoteSource(id, () => data.loadNote(id)),
          propose: proposeNoteEdits,
          todayNote: async () => null,
          todayTitle: () => "",
          projects: () => [],
          searchNotes: async () => [],
          noteTags: async () => [],
          noteLinks: async () => [],
          noteTasks: async () => [],
        },
        { confirm: async () => true },
      );
      return (await tools[tool].execute?.(args)) as Record<string, unknown>;
    },
    [name, input] as const,
  );
}

test.describe("Notes over MCP", () => {
  test("an outside agent's section edit waits in the open note until it is accepted", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    const before = await notes.text("masking");

    const result = await mcp(page, "edit_note_section", {
      id: "masking",
      heading: "Open questions",
      content: "- Does the schedule still help at 0.9?",
    });
    expect(result).toMatchObject({ success: true, id: "masking", suggestions: 1 });
    const change = notes.diffs.filter({ hasText: "Does the schedule still help at 0.9?" });
    await change.scrollIntoViewIfNeeded();
    await expect(change).toBeVisible();
    await expect(notes.button("Accept")).toBeVisible();
    expect(await notes.text("masking")).toBe(before);

    await notes.button("Accept").click();
    await expect.poll(() => notes.text("masking")).toContain("- Does the schedule still help at 0.9?");
    const after = await notes.text("masking");
    expect(after).not.toContain("Should the decoder share the positional embedding?");
    expect(after).toContain("## Sampling code");
  });

  test("text added to a closed note shows up for review the next time it opens", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Masking strategy report");
    const before = await notes.text("abstract");

    const row = notes.sidebar.locator('[data-note-row="abstract"]');
    await expect(row.locator("[data-note-suggestions]")).toHaveCount(0);
    const result = await mcp(page, "append_to_note", { id: "abstract", text: "A third dataset is still running." });
    expect(result).toMatchObject({ success: true, id: "abstract", suggestions: 1 });
    expect(await notes.text("abstract")).toBe(before);
    await expect(row.getByRole("img", { name: "Suggested changes are waiting in this note" })).toBeVisible();

    await notes.openNote("Abstract draft");
    const change = notes.diffs.filter({ hasText: "A third dataset is still running." });
    await change.scrollIntoViewIfNeeded();
    await expect(change).toBeVisible();
    await notes.button("Accept").click();
    await expect.poll(() => notes.text("abstract")).toContain("A third dataset is still running.");
    await expect(row.locator("[data-note-suggestions]")).toHaveCount(0);
  });

  test("reads return the live text of an open note, unsaved suggestions included", async ({ notes }) => {
    const { page } = await notes.open();
    await notes.openNote("Abstract draft");
    await mcp(page, "append_to_note", { id: "abstract", text: "Pending line from an agent." });
    const read = await mcp(page, "read_note_by_id", { id: "abstract" });
    expect(read).toMatchObject({ untrusted: true, id: "abstract" });
    expect(String(read.markdown)).toContain("Pending line from an agent.");
    expect(await notes.text("abstract")).not.toContain("Pending line from an agent.");
  });
});
