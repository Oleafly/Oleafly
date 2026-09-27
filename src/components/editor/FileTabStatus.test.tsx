// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { FileTabStatus } from "./FileTabStatus";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useFilesStore.setState({
    projectId: "linked-a",
    files: {
      "main.tex": { content: "mine\n", dirty: true },
      "notes.tex": { content: "notes\n", dirty: true },
      "clean.tex": { content: "clean\n", dirty: false },
    },
    changedOnDisk: ["main.tex"],
  });
});
afterEach(cleanup);

describe("FileTabStatus", () => {
  it("marks a tab whose file changed on disk", () => {
    render(<FileTabStatus path="main.tex" />);
    expect(screen.getByTitle(enEditor.changedOnDisk.tabMark)).toBeInTheDocument();
    expect(screen.getByText(enEditor.changedOnDisk.tabMark)).toHaveClass("sr-only");
  });

  it("shows the unsaved dot for an ordinary edit", () => {
    const { container } = render(<FileTabStatus path="notes.tex" />);
    expect(screen.queryByTitle(enEditor.changedOnDisk.tabMark)).not.toBeInTheDocument();
    expect(container.querySelector(".rounded-full")).toBeInTheDocument();
  });

  it("shows nothing for a saved file", () => {
    const { container } = render(<FileTabStatus path="clean.tex" />);
    expect(container).toBeEmptyDOMElement();
  });
});
