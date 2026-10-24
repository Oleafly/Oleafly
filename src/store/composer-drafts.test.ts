// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "@/components/ai/composer/types";
import {
  builtinComposerId,
  composerHistoryKey,
  composerHolding,
  HISTORY_PROJECT_CHARS,
  draftAttachmentRefs,
  draftText,
  holdDraftAttachments,
  registerAttachmentHolder,
  PROMPT_HISTORY_LIMIT,
  promptHistory,
  rememberPrompt,
  useComposerDrafts,
} from "./composer-drafts";

function attachment(id: string, patch: Partial<DraftAttachment> = {}): DraftAttachment {
  return {
    id,
    name: `${id}.png`,
    mime: "image/png",
    size: 10,
    status: "ready",
    kind: "image",
    scope: "p1",
    ...patch,
  };
}

beforeEach(() => {
  useComposerDrafts.setState({ drafts: {} });
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("composer drafts", () => {
  it("keeps a draft per composer id", () => {
    const { setText } = useComposerDrafts.getState();
    setText("p1:builtin", "a");
    setText("p1:acp:claude", "b");
    expect(draftText("p1:builtin")).toBe("a");
    expect(draftText("p1:acp:claude")).toBe("b");
  });

  it("drops a draft once its text and attachments are empty", () => {
    const store = useComposerDrafts.getState();
    store.setText("p1:builtin", "a");
    store.addAttachments("p1:builtin", [attachment("x")]);
    store.setText("p1:builtin", "");
    expect(useComposerDrafts.getState().drafts).toHaveProperty("p1:builtin");
    store.removeAttachments("p1:builtin", ["x"]);
    expect(useComposerDrafts.getState().drafts).not.toHaveProperty("p1:builtin");
  });

  it("does not bring back an attachment removed before its update arrives", () => {
    const store = useComposerDrafts.getState();
    store.addAttachments("p1:builtin", [attachment("x", { status: "processing" })]);
    store.removeAttachments("p1:builtin", ["x"]);
    expect(store.updateAttachment("p1:builtin", "x", { status: "ready" })).toBe(false);
    expect(useComposerDrafts.getState().drafts["p1:builtin"]).toBeUndefined();
  });

  it("lists stored refs of one project's drafts, page images included", () => {
    const store = useComposerDrafts.getState();
    store.addAttachments("p1:builtin", [
      attachment("one", { sha256: "a" }),
      attachment("two", { sha256: "b", pageImages: [{ sha256: "p1", mime: "image/png" }] }),
      attachment("three", { status: "processing" }),
    ]);
    store.addAttachments("p2:builtin", [attachment("four", { sha256: "c" })]);
    expect(draftAttachmentRefs("p1").sort()).toEqual(["a", "b", "p1"]);
  });
});

describe("a draft per conversation", () => {
  it("names the composer of a chat and of the next new chat", () => {
    expect(builtinComposerId("p1")).toBe("p1:builtin");
    expect(builtinComposerId("p1", null)).toBe("p1:builtin");
    expect(builtinComposerId("p1", "chat_1")).toBe("p1:builtin:chat_1");
    expect(builtinComposerId(null)).toBe("none:builtin");
    // Prompt history stays per project, whichever chat the prompt was typed in.
    expect(composerHistoryKey("p1:builtin:chat_1")).toBe("p1");
  });

  it("moves a draft to another composer and puts it before what is there", () => {
    const store = useComposerDrafts.getState();
    store.setText("p1:builtin:a", "typed in a");
    store.addAttachments("p1:builtin:a", [attachment("x", { sha256: "x1" })]);
    store.setText("p1:builtin:b", "typed in b");
    store.addAttachments("p1:builtin:b", [attachment("x", { sha256: "x1" }), attachment("y", { sha256: "y1" })]);

    store.moveDraft("p1:builtin:a", "p1:builtin:b");

    const drafts = useComposerDrafts.getState().drafts;
    expect(drafts["p1:builtin:a"]).toBeUndefined();
    expect(drafts["p1:builtin:b"].text).toBe("typed in a\n\ntyped in b");
    expect(drafts["p1:builtin:b"].attachments.map((item) => item.id)).toEqual(["x", "y"]);
  });

  it("moves into an empty composer, and leaves everything alone when there is nothing to move", () => {
    const store = useComposerDrafts.getState();
    store.setText("p1:builtin:a", "typed in a");
    store.moveDraft("p1:builtin:a", "p1:builtin");
    expect(draftText("p1:builtin")).toBe("typed in a");
    const before = useComposerDrafts.getState();
    store.moveDraft("p1:builtin:none", "p1:builtin");
    store.moveDraft("p1:builtin", "p1:builtin");
    expect(useComposerDrafts.getState()).toBe(before);
  });
});

describe("an attachment whose draft moved", () => {
  it("is found in the composer of the same project its draft moved to", () => {
    const drafts = useComposerDrafts.getState();
    drafts.addAttachments("p1:builtin", [attachment("a", { status: "processing" })]);
    expect(composerHolding("p1:builtin", "a")).toBe("p1:builtin");
    drafts.moveDraft("p1:builtin", "p1:builtin:chat-1");
    expect(composerHolding("p1:builtin", "a")).toBe("p1:builtin:chat-1");
    // Another project's composers are never searched.
    drafts.moveDraft("p1:builtin:chat-1", "p2:builtin");
    expect(composerHolding("p1:builtin", "a")).toBeNull();
  });
});

describe("files held outside the drafts", () => {
  it("keeps held attachments, and what a registered store lists, out of a collection", () => {
    const stash = [attachment("s", { sha256: "stashed", pageImages: [{ sha256: "stashed-page", mime: "image/png" }] })];
    const release = holdDraftAttachments(stash);
    const unregister = registerAttachmentHolder(() => ["queued"]);
    expect(draftAttachmentRefs("p1").sort()).toEqual(["queued", "stashed", "stashed-page"]);
    release();
    release();
    expect(draftAttachmentRefs("p1")).toEqual(["queued"]);
    unregister();
    expect(draftAttachmentRefs("p1")).toEqual([]);
  });
});

describe("prompt history", () => {
  it("remembers up to 50 prompts per project, newest last, without duplicates", () => {
    for (let index = 1; index <= 52; index += 1) rememberPrompt("p1:builtin", `prompt ${index}`);
    let history = promptHistory("p1:builtin");
    expect(history).toHaveLength(PROMPT_HISTORY_LIMIT);
    expect(history.at(-1)).toBe("prompt 52");
    rememberPrompt("p1:builtin", "prompt 10");
    history = promptHistory("p1:builtin");
    expect(history.at(-1)).toBe("prompt 10");
    expect(history.filter((item) => item === "prompt 10")).toHaveLength(1);
  });

  it("shares history between the built-in and CLI composers of a project", () => {
    rememberPrompt("p1:builtin", "x");
    expect(promptHistory("p1:acp:codex").at(-1)).toBe("x");
    expect(promptHistory("p2:builtin")).toEqual([]);
  });

  it("skips prompts longer than 4,000 characters", () => {
    rememberPrompt("p1:builtin", "y".repeat(4_001));
    rememberPrompt("p1:builtin", "   ");
    expect(promptHistory("p1:builtin")).toEqual([]);
  });

  it("keeps history for at most 20 projects", () => {
    for (let index = 1; index <= 21; index += 1) rememberPrompt(`p${index}:builtin`, "hello");
    expect(promptHistory("p1:builtin")).toEqual([]);
    expect(promptHistory("p2:builtin")).toEqual(["hello"]);
    expect(promptHistory("p21:builtin")).toEqual(["hello"]);
  });

  it("keeps only the newest prompts that fit a project's size limit", () => {
    const long = (index: number) => `${index}`.padEnd(3_000, "x");
    for (let index = 1; index <= 20; index += 1) rememberPrompt("p1:builtin", long(index));
    const history = promptHistory("p1:builtin");
    expect(history.join("").length).toBeLessThanOrEqual(HISTORY_PROJECT_CHARS);
    expect(history.at(-1)).toBe(long(20));
    expect(history).toHaveLength(Math.floor(HISTORY_PROJECT_CHARS / 3_000));
  });

  it("reads the stored history once while nothing changes it", () => {
    rememberPrompt("p1:builtin", "first");
    const parse = vi.spyOn(JSON, "parse");
    for (let step = 0; step < 5; step += 1) expect(promptHistory("p1:builtin")).toEqual(["first"]);
    expect(parse).not.toHaveBeenCalled();
    // Another window wrote it meanwhile: the new text is read.
    localStorage.setItem(
      "oleafly.composer.history",
      JSON.stringify({ v: 1, byProject: { p1: { at: 1, items: ["from another window"] } } }),
    );
    expect(promptHistory("p1:builtin")).toEqual(["from another window"]);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("works when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(promptHistory("p1:builtin")).toEqual([]);
    expect(() => rememberPrompt("p1:builtin", "x")).not.toThrow();
  });
});
