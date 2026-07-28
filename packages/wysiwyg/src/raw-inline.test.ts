// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { RawInline } from "./raw-inline";

describe("RawInline math presentation", () => {
  it("keeps the complete math expression visible and directly editable", () => {
    const source =
      "$\\frac{attention_{query}}{\\sqrt{dimension_{key}}}$";
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, RawInline],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "rawInline", attrs: { source } },
            ],
          },
        ],
      },
    });

    const raw = element.querySelector<HTMLElement>(
      '[data-type="raw-inline"]',
    );
    expect(raw?.dataset.rawInlineKind).toBe("math");
    expect(raw?.querySelector(".raw-inline-source")).toHaveTextContent(
      source,
    );
    expect(
      raw?.querySelector(".raw-inline-source"),
    ).not.toHaveAttribute("hidden");

    raw?.querySelector<HTMLButtonElement>(".raw-inline-edit")?.click();
    expect(
      raw?.querySelector<HTMLTextAreaElement>(".raw-inline-input")?.value,
    ).toBe(source);

    editor.destroy();
    element.remove();
  });
});
