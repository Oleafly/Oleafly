// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { createFigure, figureWidthPercent } from "./figure";
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
