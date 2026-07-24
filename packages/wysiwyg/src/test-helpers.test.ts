// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createHeadlessEditor } from "./test-helpers";

describe("createHeadlessEditor", () => {
  it("mounts and accepts markdown content", () => {
    const editor = createHeadlessEditor();
    editor.commands.setContent("**bold**");
    expect(editor.storage.markdown.getMarkdown()).toBe("**bold**");
    editor.destroy();
  });
});
