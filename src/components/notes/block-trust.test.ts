// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Trust = typeof import("./block-trust");

async function launch(): Promise<Trust> {
  vi.resetModules();
  return import("./block-trust");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("block hashes", () => {
  it("depend on the kind and the exact source", async () => {
    const { blockHash } = await launch();
    const html = await blockHash("html", "<p>x</p>");
    expect(html).toMatch(/^[0-9a-f]{64}$/u);
    expect(await blockHash("html", "<p>x</p>")).toBe(html);
    expect(await blockHash("react", "<p>x</p>")).not.toBe(html);
    expect(await blockHash("html", "<p>x</p> ")).not.toBe(html);
  });
});

describe("trusting a block", () => {
  it("trusts one block of one note, and only its exact source", async () => {
    const { blockHash, blockTrusted, setBlockTrusted } = await launch();
    const chart = { note: "note-1", hash: await blockHash("html", "<script>chart()</script>") };
    const edited = { note: "note-1", hash: await blockHash("html", "<script>chart(); leak()</script>") };
    const other = { note: "note-1", hash: await blockHash("react", "export default () => null") };
    setBlockTrusted(chart, true);
    expect(blockTrusted(chart)).toBe(true);
    expect(blockTrusted(edited)).toBe(false);
    expect(blockTrusted(other)).toBe(false);
    expect(blockTrusted({ note: "note-2", hash: chart.hash })).toBe(false);
    const again = await launch();
    expect(again.blockTrusted(chart)).toBe(true);
    again.setBlockTrusted(chart, false);
    expect(again.blockTrusted(chart)).toBe(false);
  });

  it("drops trust stored for a whole note by an earlier version", async () => {
    localStorage.setItem("oleafly.notes.runBlocks", JSON.stringify(["note-1", { note: 3 }, null]));
    const { blockHash, blockTrusted } = await launch();
    expect(blockTrusted({ note: "note-1", hash: await blockHash("html", "<script></script>") })).toBe(false);
  });

  it("keeps working in memory when storage refuses writes and tells listeners", async () => {
    const { blockTrusted, setBlockTrusted, subscribeBlockTrust } = await launch();
    const listener = vi.fn();
    const stop = subscribeBlockTrust(listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    setBlockTrusted({ note: "n", hash: "h" }, true);
    expect(blockTrusted({ note: "n", hash: "h" })).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    stop();
    setBlockTrusted({ note: "n", hash: "h" }, false);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("rereads trust another window changed", async () => {
    const { blockTrusted, subscribeBlockTrust } = await launch();
    const listener = vi.fn();
    subscribeBlockTrust(listener);
    expect(blockTrusted({ note: "n", hash: "h" })).toBe(false);
    localStorage.setItem("oleafly.notes.runBlocks", JSON.stringify([{ note: "n", hash: "h" }]));
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: "oleafly.notes.runBlocks" }));
    expect(listener).toHaveBeenCalledOnce();
    expect(blockTrusted({ note: "n", hash: "h" })).toBe(true);
  });
});

describe("a block that never got going", () => {
  it("pauses its note on the next launch and loses its trust", async () => {
    const first = await launch();
    const hung = { note: "note-1", hash: "hung" };
    const fine = { note: "note-1", hash: "fine" };
    const elsewhere = { note: "note-2", hash: "other" };
    for (const key of [hung, fine, elsewhere]) first.setBlockTrusted(key, true);
    expect(first.notePaused("note-1")).toBe(false);
    first.markBlockStarting(hung);
    const done = first.markBlockStarting(elsewhere);
    done();
    expect(first.notePaused("note-1")).toBe(false);

    const next = await launch();
    expect(next.notePaused("note-1")).toBe(true);
    expect(next.notePaused("note-2")).toBe(false);
    expect(next.blockTrusted(hung)).toBe(false);
    expect(next.blockTrusted(fine)).toBe(true);
    expect(next.blockTrusted(elsewhere)).toBe(true);

    const after = await launch();
    expect(after.notePaused("note-1")).toBe(false);
    expect(after.blockTrusted(hung)).toBe(false);
  });

  it("keeps each start apart, so one block settling does not clear another", async () => {
    const first = await launch();
    const settle = first.markBlockStarting({ note: "a", hash: "1" });
    first.markBlockStarting({ note: "b", hash: "2" });
    settle();
    settle();
    const next = await launch();
    expect(next.notePaused("a")).toBe(false);
    expect(next.notePaused("b")).toBe(true);
  });
});

describe("forgetting a note", () => {
  it("removes its trusted blocks and its pause, and leaves other notes", async () => {
    const first = await launch();
    first.setBlockTrusted({ note: "gone", hash: "1" }, true);
    first.setBlockTrusted({ note: "kept", hash: "2" }, true);
    first.markBlockStarting({ note: "gone", hash: "3" });
    const next = await launch();
    expect(next.notePaused("gone")).toBe(true);
    next.forgetNoteBlocks("gone");
    expect(next.notePaused("gone")).toBe(false);
    expect(next.blockTrusted({ note: "gone", hash: "1" })).toBe(false);
    expect(next.blockTrusted({ note: "kept", hash: "2" })).toBe(true);
    expect(localStorage.getItem("oleafly.notes.runBlocks")).not.toContain("gone");
  });
});
