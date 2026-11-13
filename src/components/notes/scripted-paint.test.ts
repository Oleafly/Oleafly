// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { ScriptedBlockProps } from "./ArtifactFrame";
import { htmlBlock, htmlRunsScripts, htmlTemplate } from "./html-block";
import { REACT_TEMPLATE, reactBlock } from "./react-block";
import { paintScripted } from "./scripted-paint";
import "./tests/setup";

const frames = vi.hoisted(() => ({
  render: vi.fn<(props: ScriptedBlockProps) => void>(),
  unmount: vi.fn(),
  mounts: 0,
  fail: false,
}));

vi.mock("./ArtifactFrame", () => ({
  mountScriptedBlock: () => {
    if (frames.fail) throw new Error("chunk failed");
    frames.mounts += 1;
    return { render: frames.render, unmount: frames.unmount };
  },
}));

const PAINT = { kind: "html" as const, label: "HTML", scripted: true, loadingText: "Loading", failedText: "Failed" };

async function flush() {
  await vi.dynamicImportSettled();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  frames.render.mockClear();
  frames.unmount.mockClear();
  frames.mounts = 0;
  frames.fail = false;
});

describe("paintScripted", () => {
  it("mounts once per preview and keeps the mount across edits", async () => {
    const preview = document.createElement("div");
    const first = paintScripted(preview, "<p>1</p>", { still: false, noteId: "n1" }, PAINT);
    expect(preview.textContent).toBe("Loading");
    await flush();
    expect(preview.querySelector(".note-scripted")).not.toBeNull();
    expect(frames.render).toHaveBeenLastCalledWith(expect.objectContaining({ source: "<p>1</p>", noteId: "n1", running: false }));
    first();
    paintScripted(preview, "<p>2</p>", { still: false }, PAINT);
    await flush();
    expect(frames.mounts).toBe(1);
    expect(frames.unmount).not.toHaveBeenCalled();
    expect(frames.render).toHaveBeenLastCalledWith(expect.objectContaining({ source: "<p>2</p>", noteId: null }));
  });

  it("keeps the running state while the code stays the same", async () => {
    const preview = document.createElement("div");
    paintScripted(preview, "<p>1</p>", { still: false }, PAINT);
    await flush();
    const props = frames.render.mock.lastCall?.[0] as ScriptedBlockProps;
    props.onRunningChange(true);
    expect(frames.render).toHaveBeenLastCalledWith(expect.objectContaining({ running: true }));
    paintScripted(preview, "<p>1</p>", { still: false, noteId: "n1" }, PAINT);
    expect(frames.render).toHaveBeenLastCalledWith(expect.objectContaining({ running: true, source: "<p>1</p>" }));
  });

  it("asks to run again when the code changes", async () => {
    const preview = document.createElement("div");
    const start = () => {
      const props = frames.render.mock.lastCall?.[0] as ScriptedBlockProps;
      props.onRunningChange(true);
    };
    paintScripted(preview, "<p>1</p>", { still: false }, PAINT);
    await flush();
    start();
    paintScripted(preview, "<p>changed by someone else</p>", { still: false }, PAINT);
    expect(frames.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ running: false, source: "<p>changed by someone else</p>" }),
    );
    start();
    paintScripted(preview, "<p>changed by someone else</p>", { still: false }, { ...PAINT, kind: "react" });
    expect(frames.render).toHaveBeenLastCalledWith(expect.objectContaining({ running: false, kind: "react" }));
  });

  it("unmounts when the block goes away and starts fresh afterwards", async () => {
    const preview = document.createElement("div");
    const dispose = paintScripted(preview, "<p>1</p>", { still: false }, PAINT);
    await flush();
    dispose();
    await flush();
    expect(frames.unmount).toHaveBeenCalledOnce();
    dispose();
    await flush();
    expect(frames.unmount).toHaveBeenCalledOnce();
    paintScripted(preview, "<p>again</p>", { still: false }, PAINT);
    await flush();
    expect(frames.mounts).toBe(2);
  });

  it("does not mount for a block removed while its code loads", async () => {
    const preview = document.createElement("div");
    const dispose = paintScripted(preview, "<p>1</p>", { still: false }, PAINT);
    paintScripted(preview, "<p>2</p>", { still: false }, PAINT);
    dispose();
    await flush();
    expect(frames.mounts).toBe(1);
    const gone = document.createElement("div");
    const stop = paintScripted(gone, "<p>x</p>", { still: false }, PAINT);
    stop();
    await Promise.resolve();
    await flush();
    expect(gone.querySelector(".note-scripted")).toBeNull();
  });

  it("says when the frame code cannot load", async () => {
    frames.fail = true;
    const preview = document.createElement("div");
    paintScripted(preview, "<p>1</p>", { still: false }, PAINT);
    await flush();
    expect(preview.textContent).toBe("Failed");
    const quiet = document.createElement("div");
    const stop = paintScripted(quiet, "<p>1</p>", { still: false }, PAINT);
    stop();
    await Promise.resolve();
    await flush();
    expect(quiet.textContent).toBe("Loading");
  });
});

describe("html and React blocks", () => {
  it("tells scripted HTML from static HTML", () => {
    expect(htmlRunsScripts(htmlTemplate())).toBe(true);
    expect(htmlRunsScripts("<p>static</p>")).toBe(false);
    expect(htmlRunsScripts('<script src="https://cdn.tailwindcss.com"></script><p class="p-2">x</p>')).toBe(true);
  });

  it("registers both kinds as scripted, interactive and carded on Home", async () => {
    for (const kind of [htmlBlock, reactBlock]) {
      expect(kind.scripted).toBe(true);
      expect(kind.interactive).toBe(true);
      expect(kind.still).toBe("card");
    }
    expect(reactBlock.aliases).toEqual(["react", "tsx"]);
    expect(htmlBlock.template?.()).toEqual({ info: "html", source: htmlTemplate() });
    expect(reactBlock.template?.()).toEqual({ info: "jsx", source: REACT_TEMPLATE });
    const html = document.createElement("div");
    htmlBlock.paint(html, "<p>static</p>", { still: false });
    const react = document.createElement("div");
    reactBlock.paint(react, REACT_TEMPLATE, { still: false });
    expect(react.textContent).toBe(enNotes.blocks.artifact.loading);
    await flush();
    expect(react.querySelector(".note-scripted")).not.toBeNull();
    expect(frames.render).toHaveBeenCalledWith(expect.objectContaining({ kind: "html", scripted: false, label: "HTML" }));
  });
});
