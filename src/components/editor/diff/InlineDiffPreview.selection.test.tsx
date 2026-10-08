// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  scrollEditorPositionLocally: vi.fn(),
}));
vi.mock("../cm/theme", () => ({ editorTheme: () => [] }));

import { InlineDiffPreview } from "./InlineDiffPreview";

afterEach(() => {
  cleanup();
});

describe("InlineDiffPreview text selection", () => {
  it("marks the diff as selectable content", () => {
    const { container } = render(
      <InlineDiffPreview path="main.tex" oldText={"a\nb\n"} newText={"a\nc\n"} />,
    );

    const content = container.querySelector(".cm-content");

    expect(content?.closest(".select-text")).not.toBeNull();
  });
});
