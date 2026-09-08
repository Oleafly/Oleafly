// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mergeAttributes } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";

it("does not serialize inherited event handlers from imported attributes", () => {
  const imported = JSON.parse('{"__proto__":{"onerror":"unexpected()","src":"invalid:"}}');
  const attributes = mergeAttributes({ class: "figure" }, imported);
  const { dom } = DOMSerializer.renderSpec(document, ["img", attributes]);
  expect(dom).toHaveAttribute("class", "figure");
  expect(dom).not.toHaveAttribute("onerror");
  expect(dom).not.toHaveAttribute("src");
});
