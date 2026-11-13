import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NoteDraftApproval } from "@/components/notes/note-assistant-tools";
import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { ToolConfirm } from "./ToolConfirm";

function html(noteDraft: NoteDraftApproval): string {
  const req = { tool: "create_note", summary: `Create the note "${noteDraft.title}"`, noteDraft } as ToolApprovalRequest & {
    noteDraft: NoteDraftApproval;
  };
  return renderToStaticMarkup(createElement(ToolConfirm, { req, onApprove: vi.fn(), onReject: vi.fn() }));
}

describe("ToolConfirm for a new note", () => {
  it("shows the title, linked project, tags and the start of the text as plain text", () => {
    const markup = html({
      title: "Reading list",
      tags: ["ml", "vision"],
      project: "Encoder paper",
      excerpt: "![pixel](https://tracker.example.com/p.gif)\n- Paper A",
      truncated: true,
    });
    expect(markup).toContain("The assistant wants to create a note");
    expect(markup).toContain('aria-label="Confirm new note"');
    expect(markup).not.toContain("change your files");
    expect(markup).toMatch(/Title<\/span><span[^>]*>Reading list</u);
    expect(markup).toMatch(/Linked project<\/span><span[^>]*>Encoder paper</u);
    expect(markup).toMatch(/Tags<\/span><span[^>]*>ml, vision</u);
    expect(markup).toContain("![pixel](https://tracker.example.com/p.gif)\n- Paper A");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("The note goes on past this point.");
  });

  it("says when the note has no linked project, tags or text", () => {
    const markup = html({ title: "Empty", tags: [], project: null, excerpt: "", truncated: false });
    expect(markup).toMatch(/Linked project<\/span><span[^>]*>None</u);
    expect(markup).not.toContain("Tags</span>");
    expect(markup).toContain("No text");
    expect(markup).not.toContain("The note goes on past this point.");
  });
});
