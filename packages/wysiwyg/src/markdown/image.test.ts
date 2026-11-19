// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetUrlResolver } from "../options";
import { createWysiwygExtensions } from "../schema";
import { destroyOpenedEditors, openMarkdown, typeAtEndOf } from "../test-helpers";
import { IMAGE_WIDTH_RANGE, imageWidthPercent, imageWidthSuffix } from "./image";

afterEach(destroyOpenedEditors);

function images(source: string): unknown[] {
  const { editor } = openMarkdown(source);
  const found: unknown[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") found.push(node.attrs.widthPercent);
  });
  return found;
}

function setWidth(editor: ReturnType<typeof openMarkdown>["editor"], width: number | null) {
  editor.commands.command(({ tr, state }) => {
    state.doc.descendants((node, position) => {
      if (node.type.name === "image") tr.setNodeMarkup(position, undefined, { ...node.attrs, widthPercent: width });
    });
    return true;
  });
}

describe("image widths", () => {
  it("accepts whole percentages inside the range only", () => {
    expect(imageWidthPercent(50)).toBe(50);
    expect(imageWidthPercent("75")).toBe(75);
    expect(imageWidthPercent(IMAGE_WIDTH_RANGE.max)).toBe(IMAGE_WIDTH_RANGE.max);
    expect(imageWidthPercent(IMAGE_WIDTH_RANGE.min - 1)).toBeNull();
    expect(imageWidthPercent(101)).toBeNull();
    expect(imageWidthPercent(33.5)).toBeNull();
    expect(imageWidthPercent("")).toBeNull();
    expect(imageWidthPercent(null)).toBeNull();
  });

  it("reads a width suffix only when it starts the text and holds a usable width", () => {
    expect(imageWidthSuffix("{width=50%} after")).toEqual({ width: 50, length: 11 });
    expect(imageWidthSuffix("{width=5%}")).toBeNull();
    expect(imageWidthSuffix(" {width=50%}")).toBeNull();
    expect(imageWidthSuffix("{width=50}")).toBeNull();
  });

  it("reads a width written after an image and writes it back the same way", () => {
    const source = "![Loss curve](assets/loss.png){width=40%}\n\n![Plain](assets/plain.png)";
    expect(images(source)).toEqual([40, null]);
    expect(openMarkdown(source).save()).toBe(source);
  });

  it("keeps an image with a width it can't use as its source, so nothing is lost", () => {
    const source = "![x](a.png){width=5%} and text";
    expect(images(source)).toEqual([]);
    const { editor, save } = openMarkdown(source);
    expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({ type: "rawInline", attrs: { source: "![x](a.png){width=5%}" } });
    typeAtEndOf(editor, "text", "!");
    expect(save()).toBe("![x](a.png){width=5%} and text!");
  });

  it("writes a width set on the image node", () => {
    const { editor, save } = openMarkdown("![x](a.png)");
    setWidth(editor, 60);
    expect(save()).toBe("![x](a.png){width=60%}");
  });
});

describe("figures with a Pandoc attribute block", () => {
  it("shows a cross-reference figure as an image and keeps its attributes", () => {
    const source = "Intro\n\n![Caption](fig.png){#fig-x}\n";
    const { editor, save } = openMarkdown(source);
    const found: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") found.push(node.attrs.pandocAttributes);
    });
    expect(found).toEqual(["{#fig-x}"]);
    expect(save()).toBe(source);
    typeAtEndOf(editor, "Intro", "!");
    expect(save()).toBe("Intro!\n\n![Caption](fig.png){#fig-x}\n");
  });

  it("follows the width control inside the attribute block", () => {
    const source = '![a](b.png "Title"){#fig:x width=50%}';
    expect(images(source)).toEqual([50]);
    const { editor, save } = openMarkdown(source);
    setWidth(editor, 60);
    expect(save()).toBe('![a](b.png "Title"){#fig:x width=60%}');
    setWidth(editor, null);
    expect(save()).toBe('![a](b.png "Title"){#fig:x}');
  });

  it("adds a width to an attribute block that had none", () => {
    const { editor, save } = openMarkdown("![a](b.png){#fig-y .wide}");
    setWidth(editor, 40);
    expect(save()).toBe("![a](b.png){#fig-y .wide width=40%}");
  });

  it("keeps a figure whose width it can't use as source", () => {
    const source = "![x](a.png){#fig-a width=5%}";
    expect(images(source)).toEqual([]);
    expect(openMarkdown(source).save()).toBe(source);
  });
});

describe("images from the project", () => {
  const IMAGE_URL = "data:image/png;base64,IMAGE";

  function openWithAssets(source: string, resolveAssetUrl: AssetUrlResolver) {
    const opened = openMarkdown(source, { extensions: createWysiwygExtensions({ resolveAssetUrl }) });
    return { ...opened, dom: opened.editor.view.dom };
  }

  it("shows a project image from its resolved URL and saves its path", async () => {
    const resolveAssetUrl = vi.fn(async (path: string) => (path === "../figures/my plot.png" ? IMAGE_URL : null));
    const { editor, dom, save } = openWithAssets("![Plot](../figures/my%20plot.png)", resolveAssetUrl);
    expect(dom.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageLoading");
    await vi.waitFor(() => expect(dom.querySelector("img")).toHaveAttribute("src", IMAGE_URL));
    expect(dom.querySelector<HTMLElement>(".figure-placeholder")?.hidden).toBe(true);
    expect(resolveAssetUrl).toHaveBeenCalledWith("../figures/my plot.png");
    expect(editor.state.doc.firstChild?.attrs.src).toBe("../figures/my%20plot.png");
    expect(save()).not.toContain("data:");
  });

  it("shows a placeholder for an image the project doesn't have", async () => {
    const { dom } = openWithAssets("![](missing.png)", vi.fn(async () => null));
    await vi.waitFor(() => expect(dom.querySelector(".figure-placeholder")).toHaveTextContent("figure.imageUnavailable"));
    expect(dom.querySelector("img")?.hidden).toBe(true);
    expect(dom.querySelector("img")).not.toHaveAttribute("src");
  });

  it("keeps the shown image when only its width changes", async () => {
    const resolveAssetUrl = vi.fn(async () => IMAGE_URL);
    const { editor, dom } = openWithAssets("![x](a.png)", resolveAssetUrl);
    await vi.waitFor(() => expect(dom.querySelector("img")).toHaveAttribute("src", IMAGE_URL));
    setWidth(editor, 40);
    expect(dom.querySelector("img")).toHaveAttribute("src", IMAGE_URL);
    expect(dom.querySelector("img")?.style.width).toBe("40%");
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
  });

  it("loads a web image directly", () => {
    const resolveAssetUrl = vi.fn(async () => null);
    const { dom } = openWithAssets("![Logo](https://example.com/logo.png)", resolveAssetUrl);
    expect(dom.querySelector("img")).toHaveAttribute("src", "https://example.com/logo.png");
    expect(dom.querySelector<HTMLElement>(".figure-placeholder")?.hidden).toBe(true);
    expect(resolveAssetUrl).not.toHaveBeenCalled();
  });
});
