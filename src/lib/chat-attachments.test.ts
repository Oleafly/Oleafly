import { describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "@/components/ai/composer/types";
import { HISTORY_MSG_MAX_CHARS, packChatHistory } from "@/lib/ai-context-pack";
import type { ChatMessage } from "@/store/chats";
import {
  attachedFileText,
  attachmentTextBudget,
  historyModelMessages,
  skippedAttachmentNote,
  userModelMessage,
  type AttachmentModelContext,
} from "./chat-attachments";

function ctx(overrides: Partial<AttachmentModelContext> = {}): AttachmentModelContext {
  return {
    readText: vi.fn(async (_scope, sha) => (sha === "missing" ? null : `text of ${sha}`)),
    textBudget: 48_000,
    pageImages: false,
    ...overrides,
  };
}

function draft(patch: Partial<DraftAttachment>): DraftAttachment {
  return {
    id: patch.sha256 ?? "d",
    name: "plot.png",
    mime: "image/png",
    size: 1,
    status: "ready",
    kind: "image",
    scope: "p1",
    sha256: "img",
    ...patch,
  };
}

describe("user messages", () => {
  it("keeps a plain string message when nothing is attached", async () => {
    await expect(userModelMessage("hello", [], [], ctx())).resolves.toEqual({ role: "user", content: "hello" });
  });

  it("sends images and PDFs by reference and inlines text files", async () => {
    const message = await userModelMessage(
      "look",
      [
        draft({}),
        draft({ sha256: "pdf", name: "paper.pdf", mime: "application/pdf", kind: "pdf" }),
        draft({ sha256: "notes", name: "notes.txt", mime: "text/plain", kind: "text" }),
        draft({ sha256: undefined, status: "processing" }),
      ],
      [{ id: "m", name: "main.tex", mediaType: "text/plain", dataUrl: "data:text/plain;base64,eA==" }],
      ctx(),
    );
    expect(message.content).toEqual([
      { type: "text", text: "look" },
      { type: "attachment", sha256: "img", name: "plot.png", mime: "image/png" },
      { type: "attachment", sha256: "pdf", name: "paper.pdf", mime: "application/pdf" },
      { type: "text", text: 'Attached file "notes.txt":\n\ntext of notes' },
      { type: "file", data: "data:text/plain;base64,eA==", mediaType: "text/plain", name: "main.tex" },
    ]);
  });

  it("adds scanned PDF page images only when asked", async () => {
    const scanned = draft({
      sha256: "scan",
      name: "scan.pdf",
      mime: "application/pdf",
      kind: "pdf",
      pageImages: [{ sha256: "p1", mime: "image/png" }],
    });
    const without = await userModelMessage("", [scanned], [], ctx());
    expect(without.content).toHaveLength(1);
    const withPages = await userModelMessage("", [scanned], [], ctx({ pageImages: true }));
    expect(withPages.content).toEqual([
      { type: "attachment", sha256: "scan", name: "scan.pdf", mime: "application/pdf" },
      { type: "attachment", sha256: "p1", name: "scan.pdf page 1.png", mime: "image/png" },
    ]);
  });

  it("reads text files side by side but spends the budget in file order", async () => {
    let releaseFirst!: (text: string) => void;
    const first = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });
    const readText = vi.fn(async (_scope: string | null, sha: string) => (sha === "first" ? first : "bbbb"));
    const running = userModelMessage(
      "",
      [
        draft({ sha256: "first", name: "first.txt", mime: "text/plain", kind: "text" }),
        draft({ sha256: "second", name: "second.txt", mime: "text/plain", kind: "text" }),
      ],
      [],
      ctx({ readText, textBudget: 6 }),
    );
    await vi.waitFor(() => expect(readText).toHaveBeenCalledTimes(2));
    releaseFirst("aaaa");
    const message = await running;
    expect(message.content).toEqual([
      { type: "text", text: attachedFileText("first.txt", "aaaa", 6) },
      { type: "text", text: attachedFileText("second.txt", "bbbb", 2) },
    ]);
  });

  it("caps an inlined text file at the budget with a plain note", () => {
    expect(attachedFileText("a.txt", "abcdef", 3)).toBe(
      'Attached file "a.txt":\n\nabc\n\n[Only the first 3 characters of this file are included.]',
    );
  });

  it("budgets text by the context window between 48,000 and 400,000 characters", () => {
    expect(attachmentTextBudget(undefined)).toBe(48_000);
    expect(attachmentTextBudget(8192)).toBe(48_000);
    expect(attachmentTextBudget(200_000)).toBe(320_000);
    expect(attachmentTextBudget(2_000_000)).toBe(400_000);
  });

  it("says when a stored text attachment can no longer be read", async () => {
    const message = await userModelMessage(
      "",
      [draft({ sha256: "missing", name: "gone.txt", mime: "text/plain", kind: "text" })],
      [],
      ctx(),
    );
    expect(message.content).toEqual([
      { type: "text", text: '[The attachment "gone.txt" is no longer available.]' },
    ]);
  });
});

describe("history", () => {
  const user = (content: string, attachments?: ChatMessage["attachments"]): ChatMessage => ({
    role: "user",
    content,
    attachments,
  });
  const reply = (content: string): ChatMessage => ({ role: "assistant", content });

  it("re-sends attachments from the last three user turns and notes older ones", async () => {
    const prior: ChatMessage[] = [];
    for (let index = 0; index < 4; index += 1) {
      prior.push(
        user(`q${index}`, [{ name: `f${index}.png`, mediaType: "image/png", sha256: `s${index}`, kind: "image" }]),
        reply(`a${index}`),
      );
    }
    const { messages } = await historyModelMessages(prior, "p1", ctx());
    expect(messages[0]).toEqual({
      role: "user",
      content: `q0\n\n${skippedAttachmentNote([{ name: "f0.png", mediaType: "image/png", sha256: "s0", kind: "image" }])}`,
    });
    expect(messages[2].content).toEqual([
      { type: "text", text: "q1" },
      { type: "attachment", sha256: "s1", name: "f1.png", mime: "image/png" },
    ]);
  });

  it("notes attachments saved before 0.4.8 by name only", async () => {
    const { messages } = await historyModelMessages(
      [user("old", [{ name: "plot.png", mediaType: "image/png" }]), reply("ok")],
      "p1",
      ctx(),
    );
    expect(messages[0].content).toBe(
      "old\n\n[Attachments from this message are not sent again: plot.png (image).]",
    );
  });

  it("reports how many turns the history dropped", async () => {
    const prior = Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? user(`q${index}`) : reply(`a${index}`)));
    const { droppedTurns, messages } = await historyModelMessages(prior, "p1", ctx());
    expect(droppedTurns).toBe(6);
    expect(messages).toHaveLength(24);
  });

  it("sends each reply's saved reasoning back ahead of its text", async () => {
    const thought: ChatMessage = {
      role: "assistant",
      content: "Fixed.",
      reasoningBlocks: [
        { id: "r1", text: "Read the log.", beforeTool: 0 },
        { id: "r2", text: "The brace is missing.", beforeTool: 1 },
      ],
    };
    const legacy: ChatMessage = { role: "assistant", content: "Old.", reasoning: "Older thinking." };
    const { messages } = await historyModelMessages(
      [user("fix it"), thought, user("again"), legacy, user("long"), { ...reply("x"), reasoning: "r".repeat(9_000) }],
      "p1",
      ctx(),
    );
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "Read the log.\n\nThe brace is missing." },
        { type: "text", text: "Fixed." },
      ],
    });
    expect(messages[3].content).toEqual([
      { type: "reasoning", text: "Older thinking." },
      { type: "text", text: "Old." },
    ]);
    const long = messages[5].content as { type: string; text: string }[];
    expect(long[0].text.length).toBeLessThanOrEqual(HISTORY_MSG_MAX_CHARS);
  });

  it("matches the old packing for chats without attachments", async () => {
    const prior = [user("q"), reply("a".repeat(9_000)), user("q2"), reply("a2")];
    const { messages } = await historyModelMessages(prior, "p1", ctx());
    expect(messages).toEqual(packChatHistory(prior));
  });
});
