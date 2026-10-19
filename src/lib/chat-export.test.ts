import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ pickSavePath: vi.fn(), writeBytesFile: vi.fn() }));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/tauri", () => ({ writeBytesFile: mocks.writeBytesFile }));

import type { StoredChat } from "@/store/chats";
import { chatMarkdown, exportChatMarkdown } from "./chat-export";

const chat: StoredChat = {
  id: "c1",
  projectId: "p1",
  title: "Fix: the table/figure",
  createdAt: Date.UTC(2026, 9, 18, 9, 30),
  updatedAt: Date.UTC(2026, 9, 18, 9, 31),
  headOid: null,
  messages: [
    {
      role: "user",
      content: "Fix the table",
      attachments: [{ name: "table.png", mediaType: "image/png", sha256: "a" }],
    },
    {
      role: "assistant",
      content: "Started.\n\n_Stopped._",
      toolCalls: [
        { name: "read_file", status: "done" },
        { name: "read_file", status: "done" },
        { name: "write_file", status: "done" },
      ],
    },
  ],
};

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("chat export", () => {
  it("writes the title, both sides of the conversation, attachments and tools", () => {
    const markdown = chatMarkdown(chat, { projectName: "Thesis" });
    expect(markdown.startsWith("# Fix: the table/figure\n")).toBe(true);
    expect(markdown).toContain("- Project: Thesis");
    expect(markdown).toContain(`## ${en.conversation.exportYou}\n\nFix the table`);
    expect(markdown).toContain(`## ${en.conversation.exportAssistant}`);
    expect(markdown).toContain(`**${en.conversation.exportAttachments}**\n\n- table.png`);
    expect(markdown).toContain(`**${en.conversation.exportTools}**\n\n- read_file\n- write_file`);
  });

  it("shows stored markers in the reader's language", () => {
    expect(chatMarkdown(chat, { projectName: null })).toContain(`Started.\n\n_${en.conversation.stopped}_`);
  });

  it("saves under a safe file name and does nothing when the save dialog is cancelled", async () => {
    mocks.pickSavePath.mockResolvedValueOnce(null);
    await expect(exportChatMarkdown(chat, null)).resolves.toBe("cancelled");
    expect(mocks.writeBytesFile).not.toHaveBeenCalled();
    expect(mocks.pickSavePath.mock.calls[0][0].defaultPath).toBe("Fix the table figure.md");
    mocks.pickSavePath.mockResolvedValueOnce("/tmp/chat.md");
    await expect(exportChatMarkdown(chat, null)).resolves.toBe("saved");
    expect(mocks.writeBytesFile).toHaveBeenCalledWith("/tmp/chat.md", expect.any(String));
  });
});
