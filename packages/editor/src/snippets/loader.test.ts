// @vitest-environment jsdom

import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

async function freshLoader(): Promise<typeof import("./loader")> {
  vi.resetModules();
  return import("./loader");
}

afterEach(() => {
  vi.doUnmock("./runtime");
  document.body.replaceChildren();
});

describe("the snippet loader", () => {
  it("answers nothing and lets the other sources run until the snippet code has loaded", async () => {
    const loader = await freshLoader();
    const state = EditorState.create({ doc: "thm" });
    const context = new CompletionContext(state, 3, true);
    const other = vi.fn<CompletionSource>(() => null);
    const [own, wrapped] = loader.withSnippetCompletions([other]);
    expect(loader.loadedSnippetRuntime()).toBeNull();
    expect(own(context)).toBeNull();
    wrapped(context);
    expect(other).toHaveBeenCalledWith(context);
    expect(loader.snippetGhostHint()(state)).toBeNull();
    expect(loader.snippetHintBlocksAi(state)).toBe(false);
  });

  it("fills the session and typing pieces into an open editor once loaded, then hands them out directly", async () => {
    const loader = await freshLoader();
    const { snippetSessionField } = await import("./session");
    const { lastAutoExpansion } = await import("./auto");
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ extensions: [loader.snippetSessionExtension(), loader.snippetAutoExpand()] }),
    });
    expect(view.state.field(snippetSessionField, false)).toBeUndefined();
    const runtime = await loader.loadSnippetRuntime();
    await vi.waitFor(() => expect(view.state.field(snippetSessionField, false)).toEqual([]));
    expect(view.state.field(lastAutoExpansion, false)).toBeNull();
    expect(loader.loadedSnippetRuntime()).toBe(runtime);
    await expect(loader.loadSnippetRuntime()).resolves.toBe(runtime);
    expect(loader.snippetSessionExtension()).toBe(runtime.snippetSessionExtension());
    expect(loader.snippetAutoExpand()).toBe(runtime.snippetAutoExpand());
    view.destroy();
  });

  it("tries again after the snippet code failed to load", async () => {
    vi.doMock("./runtime", () => {
      throw new Error("offline");
    });
    const loader = await freshLoader();
    await expect(loader.loadSnippetRuntime()).rejects.toThrow();
    vi.doUnmock("./runtime");
    const runtime = await loader.loadSnippetRuntime();
    expect(loader.loadedSnippetRuntime()).toBe(runtime);
  });
});
