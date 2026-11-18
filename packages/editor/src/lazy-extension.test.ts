// @vitest-environment jsdom

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazyExtension } from "./lazy-extension";

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
});

const marker = EditorView.editorAttributes.of({ "data-lazy": "on" });

function mount(extension: Extension): EditorView {
  const view = new EditorView({ state: EditorState.create({ extensions: extension }) });
  views.push(view);
  return view;
}

function marked(view: EditorView): boolean {
  return view.dom.getAttribute("data-lazy") === "on";
}

describe("lazyExtension", () => {
  it("fills its slot once the module loads and returns it directly after that", async () => {
    const load = vi.fn(async () => marker);
    const lazy = lazyExtension(load);
    const view = mount(lazy());
    expect(marked(view)).toBe(false);
    await vi.waitFor(() => expect(marked(view)).toBe(true));
    expect(lazy()).toBe(marker);
    expect(marked(mount(lazy()))).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it("stays empty when loading fails and tries again for the next editor", async () => {
    const load = vi
      .fn<() => Promise<Extension>>()
      .mockRejectedValueOnce(new Error("chunk missing"))
      .mockResolvedValue(marker);
    const lazy = lazyExtension(load);
    const first = mount(lazy());
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(marked(first)).toBe(false);
    const second = mount(lazy());
    await vi.waitFor(() => expect(marked(second)).toBe(true));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("leaves a destroyed editor alone", async () => {
    let resolve: (extension: Extension) => void = () => undefined;
    const lazy = lazyExtension(
      () =>
        new Promise<Extension>((done) => {
          resolve = done;
        }),
    );
    const view = mount(lazy());
    const dispatch = vi.spyOn(view, "dispatch");
    view.destroy();
    resolve(marker);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
