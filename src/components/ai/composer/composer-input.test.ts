import { describe, expect, it } from "vitest";
import { TREE_DRAG_TYPE } from "@/lib/tree-drag";
import {
  caretLines,
  clampComposerHeight,
  composerDropKind,
  composerGrowMax,
  composerKeyAction,
  dropEffectFor,
  historyStep,
  pastedFiles,
  slashMenuQuery,
} from "./composer-input";

const idle = { busy: false, canQueue: false, canSubmit: true, empty: false, recalling: false };

function transfer(types: string[], files: File[] = []): DataTransfer {
  return { types, files, getData: () => "" } as unknown as DataTransfer;
}

describe("composer keys", () => {
  it("sends on Enter, keeps Shift+Enter for a newline", () => {
    expect(composerKeyAction({ ...idle, key: "Enter" })).toBe("submit");
    expect(composerKeyAction({ ...idle, key: "Enter", shiftKey: true })).toBe("default");
  });

  it("queues on Enter while busy when queueing is offered, else blocks", () => {
    expect(composerKeyAction({ ...idle, key: "Enter", busy: true, canQueue: true })).toBe("queue");
    expect(composerKeyAction({ ...idle, key: "Enter", busy: true })).toBe("block");
  });

  it("blocks Enter when there is nothing to send", () => {
    expect(composerKeyAction({ ...idle, key: "Enter", canSubmit: false })).toBe("block");
  });

  it("moves the caret inside a recalled prompt of several lines before stepping history", () => {
    const recalled = { ...idle, recalling: true };
    expect(composerKeyAction({ ...recalled, key: "ArrowUp", caretOnFirstLine: false })).toBe("default");
    expect(composerKeyAction({ ...recalled, key: "ArrowUp", caretOnFirstLine: true })).toBe("historyPrev");
    expect(composerKeyAction({ ...recalled, key: "ArrowDown", caretOnLastLine: false })).toBe("default");
    expect(composerKeyAction({ ...recalled, key: "ArrowDown", caretOnLastLine: true })).toBe("historyNext");
    expect(composerKeyAction({ ...recalled, key: "ArrowUp" })).toBe("historyPrev");
    expect(composerKeyAction({ ...recalled, key: "ArrowDown" })).toBe("historyNext");
  });

  it("finds out whether the caret is on the first and the last line", () => {
    const text = "one\ntwo\nthree";
    expect(caretLines(text, 0, 0)).toEqual({ onFirstLine: true, onLastLine: false });
    expect(caretLines(text, 5, 5)).toEqual({ onFirstLine: false, onLastLine: false });
    expect(caretLines(text, text.length, text.length)).toEqual({ onFirstLine: false, onLastLine: true });
    expect(caretLines("single line", 4, 4)).toEqual({ onFirstLine: true, onLastLine: true });
    expect(caretLines(text, 1, 6)).toEqual({ onFirstLine: true, onLastLine: false });
  });

  it("recalls history with Up only in an empty box or while recalling", () => {
    expect(composerKeyAction({ ...idle, key: "ArrowUp", empty: true })).toBe("historyPrev");
    expect(composerKeyAction({ ...idle, key: "ArrowUp" })).toBe("default");
    expect(composerKeyAction({ ...idle, key: "ArrowUp", empty: true, altKey: true })).toBe("default");
    expect(composerKeyAction({ ...idle, key: "ArrowDown", recalling: true })).toBe("historyNext");
    expect(composerKeyAction({ ...idle, key: "ArrowDown" })).toBe("default");
  });

  it("walks history back and forward and clears past the newest entry", () => {
    const history = ["a", "b"];
    expect(historyStep(history, null, "prev")).toEqual({ index: 1, value: "b" });
    expect(historyStep(history, 1, "prev")).toEqual({ index: 0, value: "a" });
    expect(historyStep(history, 0, "prev")).toBeNull();
    expect(historyStep(history, 0, "next")).toEqual({ index: 1, value: "b" });
    expect(historyStep(history, 1, "next")).toEqual({ index: null, value: "" });
    expect(historyStep([], null, "prev")).toBeNull();
  });
});

describe("slash menu", () => {
  it("closes the slash menu once a known command is followed by a space", () => {
    const items = [{ command: "lit-sweep" }, {}];
    expect(slashMenuQuery("/lit-sweep x", items, null)).toBeNull();
    expect(slashMenuQuery("/lit", items, null)).toBe("lit");
    expect(slashMenuQuery("hello", items, null)).toBeNull();
  });

  it("keeps the slash menu closed for the text it was dismissed on", () => {
    expect(slashMenuQuery("/lit", [], "/lit")).toBeNull();
    expect(slashMenuQuery("/lite", [], "/lit")).toBe("lite");
  });
});

describe("drops and pastes", () => {
  it("prefers the tree kind over plain text and files over the Linux native path", () => {
    expect(composerDropKind(transfer(["text/plain", TREE_DRAG_TYPE]), false)).toBe("tree");
    expect(composerDropKind(transfer(["Files", "text/uri-list"]), true)).toBe("files");
    expect(composerDropKind(transfer(["text/plain"]), false)).toBeNull();
  });

  it("reports a Linux native drop only for uri lists without files or text", () => {
    expect(composerDropKind(transfer(["text/uri-list"]), true)).toBe("native");
    expect(composerDropKind(transfer(["text/uri-list"]), false)).toBeNull();
    expect(composerDropKind(transfer(["text/uri-list", "text/plain"]), true)).toBeNull();
  });

  it("matches the drop effect to what the source allows", () => {
    expect(dropEffectFor("move")).toBe("move");
    expect(dropEffectFor("all")).toBe("copy");
    expect(dropEffectFor(undefined)).toBe("copy");
    expect(dropEffectFor("link")).toBe("link");
    expect(dropEffectFor("none")).toBe("none");
  });

  it("attaches a pasted screenshot from the Windows Snipping Tool", () => {
    const shot = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    expect(pastedFiles(transfer(["Files"], [shot]))).toEqual([shot]);
  });

  it("leaves a paste from a word processor as text", () => {
    const blob = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
    expect(pastedFiles(transfer(["text/plain", "text/html", "Files"], [blob]))).toEqual([]);
  });
});

describe("resting height", () => {
  it("clamps the resting height between two lines and 60% of the panel", () => {
    expect(clampComposerHeight(10, 800)).toBe(56);
    expect(clampComposerHeight(900, 800)).toBe(480);
    expect(clampComposerHeight(10, 800, 20)).toBe(70);
    expect(clampComposerHeight(Number.NaN, 800)).toBe(56);
    expect(composerGrowMax(56)).toBe(224);
    expect(composerGrowMax(300)).toBe(300);
  });
});
