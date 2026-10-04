// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { createFigure, figureWidthPercent } from "./figure";
import { parseMarkdownBody } from "./markdown/parse";
import { serializeMarkdownBody } from "./markdown/serialize";
import type { WysiwygExtensionOptions } from "./options";
import { createWysiwygExtensions } from "./schema";

let editors: Editor[] = [];

function mount(figure: JSONContent, options: WysiwygExtensionOptions = {}): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions(options),
    content: { type: "doc", content: [figure] },
  });
  editors.push(editor);
  return { editor, element };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
  document.body.replaceChildren();
});

describe("createFigure", () => {
  it("builds the canonical attrs and an editable caption", () => {
    expect(createFigure({ path: "img/a.png", caption: "Cap", label: "fig:a" })).toEqual({
      type: "figure",
      attrs: {
        path: "img/a.png",
        width: "0.5\\linewidth",
        options: null,
        placement: "htbp",
        centering: true,
        label: "fig:a",
        graphicsCommand: "includegraphics",
      },
      content: [{ type: "figureCaption", content: [{ type: "text", text: "Cap" }] }],
    });
  });
});

describe("figureWidthPercent", () => {
  it("maps linewidth fractions to percentages", () => {
    expect(figureWidthPercent("0.5\\linewidth")).toBe("50%");
    expect(figureWidthPercent("\\textwidth")).toBe("100%");
    expect(figureWidthPercent(".25\\columnwidth")).toBe("25%");
    expect(figureWidthPercent("1\\linewidth")).toBe("100%");
    expect(figureWidthPercent("1.5\\textwidth")).toBe("100%");
    expect(figureWidthPercent(`${"0".repeat(5000)}x`)).toBeNull();
    expect(figureWidthPercent("3cm")).toBeNull();
    expect(figureWidthPercent(null)).toBeNull();
  });
});

describe("Figure", () => {
  it("resolves the image through the asset port and reports missing assets", async () => {
    const resolveAssetUrl = vi.fn(async (path: string) => (path === "img/a.png" ? "asset://img/a.png" : null));
    const { editor, element } = mount(createFigure({ path: "img/a.png" }), { resolveAssetUrl });
    await settle();
    const image = element.querySelector<HTMLImageElement>(".figure-image");
    expect(image?.getAttribute("src")).toBe("asset://img/a.png");
    expect(image?.hidden).toBe(false);
    expect(image?.style.width).toBe("50%");
    expect(element.querySelector<HTMLElement>(".figure-placeholder")?.hidden).toBe(true);

    editor.commands.updateAttributes("figure", { path: "missing.png" });
    await settle();
    expect(resolveAssetUrl).toHaveBeenCalledWith("missing.png");
    expect(element.querySelector<HTMLImageElement>(".figure-image")?.hidden).toBe(true);
    expect(element.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageUnavailable");
  });

  it("shows the placeholder without a resolver", async () => {
    const { element } = mount(createFigure({ path: "x.png" }));
    await settle();
    expect(element.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageUnavailable");
  });

  it("changes the width from the preset select and shows a custom option for other values", () => {
    const { editor, element } = mount(createFigure({ path: "x.png", width: "3cm" }));
    const select = element.querySelector<HTMLSelectElement>("select.figure-width");
    if (!select) throw new Error("select missing");
    expect(select.value).toBe("custom");
    expect(select.querySelector('option[value="custom"]')).toHaveTextContent("figure.widthCustom");
    select.value = "\\linewidth";
    select.dispatchEvent(new Event("change"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.width).toBe("\\linewidth");
    expect(select.querySelector('option[value="custom"]')).toBeNull();
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.width).toBeNull();
  });

  it("edits the label and adds a caption", () => {
    const { editor, element } = mount(createFigure({ path: "x.png" }));
    const label = element.querySelector<HTMLInputElement>("input.figure-label");
    if (!label) throw new Error("label missing");
    label.value = " fig:new ";
    label.dispatchEvent(new Event("change"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.label).toBe("fig:new");
    label.value = "";
    label.dispatchEvent(new Event("change"));
    expect((editor.getJSON() as JSONContent).content?.[0].attrs?.label).toBeNull();

    const addCaption = element.querySelector<HTMLButtonElement>(".figure-add-caption");
    expect(addCaption?.hidden).toBe(false);
    addCaption?.click();
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[0].type).toBe("figureCaption");
    expect(element.querySelector<HTMLButtonElement>(".figure-add-caption")?.hidden).toBe(true);
    editor.commands.insertContent("Typed caption");
    expect((editor.getJSON() as JSONContent).content?.[0].content?.[0].content?.[0].text).toBe("Typed caption");
  });

  it("round-trips through HTML with every attribute", () => {
    const { editor } = mount(
      createFigure({ path: "x.png", width: null, options: "height=2cm", placement: null, centering: false, caption: "C" }),
    );
    const reparsed = new Editor({
      element: document.createElement("div"),
      extensions: createWysiwygExtensions(),
      content: editor.getHTML(),
    });
    editors.push(reparsed);
    expect(reparsed.getJSON()).toEqual(editor.getJSON());
  });
});

describe("Figure controls", () => {
  it("returns focus to the editor from the label field on Enter and reports resolver failures", async () => {
    const resolveAssetUrl = vi.fn(async () => {
      throw new Error("offline");
    });
    const { element } = mount(createFigure({ path: "x.png" }), { resolveAssetUrl });
    await settle();
    expect(element.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageUnavailable");
    const label = element.querySelector<HTMLInputElement>("input.figure-label");
    if (!label) throw new Error("label missing");
    label.focus();
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(document.activeElement).not.toBe(label);
    label.focus();
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).not.toBe(label);
    label.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  });
});

describe("Figure in Markdown", () => {
  it("serializes a pasted figure as a Markdown image without LaTeX-only attributes", () => {
    const markdown = serializeMarkdownBody({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Obrázek:" }] },
        createFigure({
          path: "figures/pasted-image-1.png",
          width: String.raw`0.8\linewidth`,
          caption: "",
          label: "fig:pasted-image-1",
        }),
        createFigure({ path: "../obrázky/řez (1).png", caption: "Řez *vzorkem*" }),
      ],
    });
    expect(markdown).toBe(
      "Obrázek:\n\n![](figures/pasted-image-1.png)\n\n![Řez \\*vzorkem\\*](<../obrázky/řez (1).png>)",
    );
    const images = (parseMarkdownBody(markdown).doc.content ?? []).filter(
      (node) => node.type === "image",
    );
    expect(images.map((node) => node.attrs?.src)).toEqual([
      "figures/pasted-image-1.png",
      "../obr%C3%A1zky/%C5%99ez%20(1).png",
    ]);
  });
});

describe("Figure image resolution order", () => {
  function deferred() {
    let resolve: (url: string | null) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<string | null>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  it("shows the image of the latest path when an older lookup finishes last", async () => {
    const lookups = new Map<string, ReturnType<typeof deferred>>();
    const resolveAssetUrl = vi.fn((path: string) => {
      const entry = deferred();
      lookups.set(path, entry);
      return entry.promise;
    });
    const { editor, element } = mount(createFigure({ path: "old.png" }), { resolveAssetUrl });
    expect(element.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageLoading");

    editor.commands.updateAttributes("figure", { path: "new.png" });
    lookups.get("new.png")?.resolve("asset://new.png");
    await settle();
    lookups.get("old.png")?.resolve("asset://old.png");
    await settle();

    expect(element.querySelector<HTMLImageElement>(".figure-image")?.getAttribute("src")).toBe("asset://new.png");
  });

  it("ignores a failed older lookup once a newer path is loading", async () => {
    const lookups = new Map<string, ReturnType<typeof deferred>>();
    const resolveAssetUrl = vi.fn((path: string) => {
      const entry = deferred();
      lookups.set(path, entry);
      return entry.promise;
    });
    const { editor, element } = mount(createFigure({ path: "old.png" }), { resolveAssetUrl });

    editor.commands.updateAttributes("figure", { path: "new.png" });
    lookups.get("old.png")?.reject(new Error("gone"));
    await settle();

    expect(element.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageLoading");
  });

  it("ignores lookups that finish after the figure is destroyed", async () => {
    const lookup = deferred();
    const { editor, element } = mount(createFigure({ path: "slow.png" }), { resolveAssetUrl: () => lookup.promise });
    const image = element.querySelector<HTMLImageElement>(".figure-image") as HTMLImageElement;

    editor.destroy();
    lookup.resolve("asset://slow.png");
    await settle();

    expect(image.getAttribute("src")).toBeNull();
  });

  it("does not look up an empty path", async () => {
    const resolveAssetUrl = vi.fn(async () => "asset://x");
    const { element } = mount(createFigure({ path: "" }), { resolveAssetUrl });
    await settle();

    expect(resolveAssetUrl).not.toHaveBeenCalled();
    expect(element.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageUnavailable");
  });
});

describe("Figure node view state", () => {
  it("shows and clears the selected state", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: createWysiwygExtensions(),
      content: { type: "doc", content: [createFigure({ path: "x.png" }), { type: "paragraph" }] },
    });
    editors.push(editor);
    const figure = element.querySelector<HTMLElement>('[data-type="figure"]') as HTMLElement;

    editor.commands.setNodeSelection(0);
    expect(figure).toHaveClass("ProseMirror-selectednode");

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(figure).not.toHaveClass("ProseMirror-selectednode");
  });

  it("leaves the width alone when the custom option is chosen", () => {
    const { editor, element } = mount(createFigure({ path: "x.png", width: "3cm" }));
    const select = element.querySelector<HTMLSelectElement>("select.figure-width") as HTMLSelectElement;

    select.value = "custom";
    select.dispatchEvent(new Event("change"));

    expect(editor.state.doc.child(0).attrs.width).toBe("3cm");
  });

  it("adds at most one caption", () => {
    const { editor, element } = mount(createFigure({ path: "x.png" }));
    const addCaption = element.querySelector<HTMLButtonElement>(".figure-add-caption") as HTMLButtonElement;

    addCaption.click();
    addCaption.click();

    expect(editor.state.doc.child(0).childCount).toBe(1);
  });

  it("keeps what the user is typing in the label field while the document changes", () => {
    const { editor, element } = mount(createFigure({ path: "x.png" }));
    const label = element.querySelector<HTMLInputElement>("input.figure-label") as HTMLInputElement;
    label.focus();
    label.value = "fig:typing";

    editor.commands.updateAttributes("figure", { label: "fig:other", width: "0.25\\linewidth" });

    expect(label.value).toBe("fig:typing");
    expect(element.querySelector<HTMLImageElement>(".figure-image")?.style.width).toBe("25%");
  });

  it("keeps keys pressed in its controls away from the editor", () => {
    const handleKeyDown = vi.fn((_view: unknown, _event: KeyboardEvent) => false);
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: createWysiwygExtensions(),
      editorProps: { handleKeyDown },
      content: {
        type: "doc",
        content: [createFigure({ path: "x.png", caption: "Cap" })],
      },
    });
    editors.push(editor);
    const press = (target: EventTarget, key: string) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    press(element.querySelector("input.figure-label") as HTMLElement, "a");
    press(element.querySelector("select.figure-width") as HTMLElement, "b");
    expect(handleKeyDown).not.toHaveBeenCalled();

    press(element.querySelector(".figure-caption-host") as HTMLElement, "c");
    expect(handleKeyDown.mock.calls.map(([, event]) => event.key)).toEqual(["c"]);
  });
});
