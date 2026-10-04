import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/acp", async (original) => ({
  ...(await original<typeof import("@/lib/acp")>()),
  acpSessionExport: vi.fn(),
  acpSessionEventsAll: vi.fn(),
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: vi.fn() }));
vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof import("@/lib/tauri")>()),
  writeBytesFile: vi.fn(),
}));

import { acpSessionEventsAll, acpSessionExport } from "@/lib/acp";
import { pickSavePath } from "@/lib/native-file-dialog";
import { writeBytesFile } from "@/lib/tauri";
import { formatDateTime } from "@/lib/intl";
import { event, initTestI18n, session } from "./tests/ui-fixtures";
import { conversationMarkdown, exportConversation } from "./export-conversation";

beforeAll(async () => {
  await initTestI18n();
});
beforeEach(() => {
  vi.resetAllMocks();
});

const started = Date.UTC(2026, 8, 20, 9, 30);
const updated = Date.UTC(2026, 8, 20, 10, 5);

function transcript() {
  return [
    event(1, "user_message", { text: "Audit the claims", skill: { id: "oleafly-verify-claims", name: "Verify claims" } }),
    event(2, "agent_thought_chunk", { content: { type: "text", text: "private reasoning" } }),
    event(3, "tool_call", {
      toolCallId: "edit",
      title: "Edit main.tex",
      status: "completed",
      content: [{ type: "diff", path: "main.tex", oldText: "a", newText: "b" }],
    }),
    event(4, "agent_message_chunk", { content: { type: "text", text: "I wrote research/claims.md." } }),
    event(5, "turn_changes", {
      turnId: "turn",
      snapshotId: "snap",
      files: [
        { index: 0, path: "main.tex", change: "modified", beforeSize: 1, afterSize: 1, added: 3, removed: 1, alsoEditedHere: false, build: false },
        { index: 1, path: "research/claims.md", change: "added", beforeSize: null, afterSize: 9, added: 9, removed: 0, alsoEditedHere: false, build: false },
        { index: 2, path: "main.aux", change: "modified", beforeSize: 1, afterSize: 1, added: null, removed: null, alsoEditedHere: false, build: true },
      ],
      moreFiles: 2,
      skipped: [],
      overlapped: false,
      unavailable: null,
    }),
    event(6, "turn_complete", { stopReason: "end_turn" }),
  ];
}

describe("conversationMarkdown", () => {
  it("writes a readable header with the project name, agent, model, start commit and dates", () => {
    const markdown = conversationMarkdown({
      session: session("saved", {
        projectPath: "/Users/someone/Papers/thesis",
        title: "Claim audit",
        createdAt: started,
        updatedAt: updated,
        startRevision: "0123456789abcdef",
        startDirty: true,
      }),
      events: transcript(),
      projectName: "Thesis",
      agentName: "Research CLI",
    });
    expect(markdown.startsWith("# Claim audit\n\n")).toBe(true);
    expect(markdown).toContain("- Project: Thesis\n");
    expect(markdown).toContain("- Agent: Research CLI 1.2.3\n");
    expect(markdown).toContain("- Model: First model\n");
    expect(markdown).toContain("- Started at commit: 0123456 with uncommitted changes\n");
    expect(markdown).toContain(`- Started: ${formatDateTime(started)}\n`);
    expect(markdown).toContain(`- Last updated: ${formatDateTime(updated)}\n`);
    expect(markdown).not.toContain("/Users/someone");
  });

  it("lists turns, skills, tools and each turn's changed files without the agent's private reasoning", () => {
    const markdown = conversationMarkdown({
      session: session("saved", { title: "", startRevision: "abcdef0123", startDirty: false }),
      events: transcript(),
      projectName: "Thesis",
      agentName: "Research CLI",
    });
    expect(markdown.startsWith("# Conversation\n")).toBe(true);
    expect(markdown).toContain("- Started at commit: abcdef0\n");
    expect(markdown).toContain("## You\n\nAudit the claims\n\n_Skill: Verify claims_\n");
    expect(markdown).toContain("## Research CLI\n");
    expect(markdown).toContain("- Tool: Edit main.tex\n  - main.tex\n");
    expect(markdown).toContain("I wrote research/claims.md.");
    expect(markdown).toContain(
      "**Changed files**\n\n- main.tex (Modified, +3 -1)\n- research/claims.md (Added, +9 -0)\n- main.aux (Modified)\n- and 2 more files\n",
    );
    expect(markdown).not.toContain("private reasoning");
    expect(markdown.match(/## Research CLI/g)).toHaveLength(1);
  });

  it("says when the agent chose the model", () => {
    const markdown = conversationMarkdown({
      session: session("saved", { controls: { modelId: null, modelConfigId: null, models: [] } }),
      events: [],
      projectName: null,
      agentName: "Pi",
    });
    expect(markdown).toContain("- Model: Chosen by the agent\n");
    expect(markdown).not.toContain("- Project:");
    expect(markdown).not.toContain("Started at commit");
  });
});

describe("exportConversation", () => {
  const target = session("saved", { title: "Claim audit: part 2/3" });

  it("offers Markdown first and writes it from every stored event", async () => {
    vi.mocked(pickSavePath).mockResolvedValue("/tmp/out.md");
    vi.mocked(acpSessionEventsAll).mockResolvedValue(transcript());
    await expect(exportConversation({ projectId: "paper", session: target, projectName: "Thesis", agentName: "Research CLI" })).resolves.toBe(true);
    expect(pickSavePath).toHaveBeenCalledWith({
      defaultPath: "Claim audit part 2 3.md",
      filters: [{ name: "Markdown", extensions: ["md"] }, { name: "JSON", extensions: ["json"] }],
    });
    expect(acpSessionEventsAll).toHaveBeenCalledWith("paper", "saved");
    const [path, base64] = vi.mocked(writeBytesFile).mock.calls[0];
    expect(path).toBe("/tmp/out.md");
    const text = new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
    expect(text).toContain("- Tool: Edit main.tex");
    expect(text).toContain("+3 -1");
    expect(acpSessionExport).not.toHaveBeenCalled();
  });

  it("lets the backend write JSON when the file name ends in .json", async () => {
    vi.mocked(pickSavePath).mockResolvedValue("/tmp/Out.JSON");
    await exportConversation({ projectId: "paper", session: target, projectName: "Thesis", agentName: "Research CLI" });
    expect(acpSessionExport).toHaveBeenCalledWith("paper", "saved", "/tmp/Out.JSON");
    expect(acpSessionEventsAll).not.toHaveBeenCalled();
    expect(writeBytesFile).not.toHaveBeenCalled();
  });

  it("does nothing when the save dialog is cancelled", async () => {
    vi.mocked(pickSavePath).mockResolvedValue(null);
    await expect(exportConversation({ projectId: "paper", session: target, projectName: null, agentName: "Pi" })).resolves.toBe(false);
    expect(acpSessionExport).not.toHaveBeenCalled();
    expect(writeBytesFile).not.toHaveBeenCalled();
  });
});

describe("conversationMarkdown edge cases", () => {
  it("names a model missing from the list by its id, and an agent without a version", () => {
    const markdown = conversationMarkdown({
      session: session("saved", { agentVersion: null, controls: { modelId: "house-model", modelConfigId: null, models: [] } }),
      events: [],
      projectName: null,
      agentName: "Pi",
    });

    expect(markdown).toContain("- Agent: Pi\n");
    expect(markdown).toContain("- Model: house-model\n");
  });

  it("keeps tools without diffs and skips a turn that changed nothing", () => {
    const markdown = conversationMarkdown({
      session: session(),
      events: [
        event(1, "user_message", { text: "Tidy up" }),
        event(2, "tool_call", { toolCallId: "read", title: "Read notes", status: "completed" }),
        event(3, "turn_changes", {
          turnId: "turn", snapshotId: null, files: [], moreFiles: 0, skipped: [], overlapped: false, unavailable: null,
        }),
        event(4, "turn_complete", { stopReason: "end_turn" }),
      ],
      projectName: "Thesis",
      agentName: "Research CLI",
    });

    expect(markdown).toContain("- Tool: Read notes\n");
    expect(markdown).not.toContain("- Tool: Read notes\n  -");
    expect(markdown).not.toContain("Changed files");
  });

  it("writes a deleted file with only its removed lines counted", () => {
    const markdown = conversationMarkdown({
      session: session(),
      events: [
        event(1, "user_message", { text: "Remove the old draft" }),
        event(2, "agent_message_chunk", { content: { type: "text", text: "Removed." } }),
        event(3, "turn_changes", {
          turnId: "turn", snapshotId: "snap",
          files: [{ index: 0, path: "old.tex", change: "deleted", beforeSize: 4, afterSize: null, added: null, removed: 12, alsoEditedHere: false, build: false }],
          moreFiles: 0, skipped: [], overlapped: false, unavailable: null,
        }),
        event(4, "turn_complete", { stopReason: "end_turn" }),
      ],
      projectName: "Thesis",
      agentName: "Research CLI",
    });

    expect(markdown).toContain("**Changed files**\n\n- old.tex (Deleted, +0 -12)\n");
    expect(markdown).not.toContain("more files");
  });
});

describe("exportConversation file names", () => {
  it("falls back to the untitled name when the title is only punctuation", async () => {
    vi.mocked(pickSavePath).mockResolvedValue(null);

    await exportConversation({ projectId: "paper", session: session("saved", { title: "///" }), projectName: null, agentName: "Pi" });

    expect(vi.mocked(pickSavePath).mock.calls[0][0]).toMatchObject({ defaultPath: "Conversation.md" });
  });
});

