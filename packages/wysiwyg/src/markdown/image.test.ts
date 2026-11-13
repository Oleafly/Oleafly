// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { destroyOpenedEditors, openMarkdown } from "../test-helpers";
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

  it("keeps a width it can't use as text, so nothing is lost", () => {
    const source = "![x](a.png){width=5%}";
    expect(images(source)).toEqual([null]);
    expect(openMarkdown(source).save()).toBe(String.raw`![x](a.png){width=5%}`);
  });

  it("writes a width set on the image node", () => {
    const { editor, save } = openMarkdown("![x](a.png)");
    editor.commands.command(({ tr, state }) => {
      state.doc.descendants((node, position) => {
        if (node.type.name === "image") tr.setNodeMarkup(position, undefined, { ...node.attrs, widthPercent: 60 });
      });
      return true;
    });
    expect(save()).toBe("![x](a.png){width=60%}");
  });
});
