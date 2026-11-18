// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createWysiwygExtensions } from "../schema";
import { parseMarkdownBody } from "./parse";
import { serializeMarkdownBody } from "./serialize";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.replaceChildren();
});

it("resolves project-relative images when Markdown is opened and keeps their paths on save", async () => {
  const resolveAssetUrl = vi.fn(async (path: string) => {
    return path === "../figures/my plot.png" ? "data:image/png;base64,IMAGE" : null;
  });
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions({ resolveAssetUrl }),
    content: parseMarkdownBody("![Plot](../figures/my%20plot.png)").doc,
  });
  editors.push(editor);

  await vi.waitFor(() => expect(element.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,IMAGE"));
  expect(resolveAssetUrl).toHaveBeenCalledWith("../figures/my plot.png");
  expect(serializeMarkdownBody(editor.getJSON())).toContain("../figures/my plot.png");
  expect(serializeMarkdownBody(editor.getJSON())).not.toContain("data:image/png");
});

it("keeps external Markdown images direct without resolving them as project files", () => {
  const resolveAssetUrl = vi.fn(async () => null);
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createWysiwygExtensions({ resolveAssetUrl }),
    content: parseMarkdownBody("![Logo](https://example.com/logo.png)").doc,
  });
  editors.push(editor);

  expect(element.querySelector("img")).toHaveAttribute("src", "https://example.com/logo.png");
  expect(resolveAssetUrl).not.toHaveBeenCalled();
});
