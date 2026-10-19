// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "@/components/ai/composer/types";
import {
  draftAttachmentRefs,
  draftText,
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
