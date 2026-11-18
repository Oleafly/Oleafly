// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { i18n } from "@/i18n";
import { useLiveBackend } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { FileTabStatus } from "./FileTabStatus";

const LABEL = enEditor.liveTab.notOnOverleafYet;
const STORED = enEditor.liveTab.storedAsFile;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useFilesStore.setState({
    projectId: "imported",
    files: { "main.tex": { content: "a\n", dirty: false }, "intro.tex": { content: "b\n", dirty: false } },
    changedOnDisk: [],
  });
  useLiveBackend.setState({ projectId: "imported", backend: "overleaf", overleaf: null, pendingPaths: ["main.tex"] });
});
afterEach(() => {
  cleanup();
  useLiveBackend.setState({ projectId: null, backend: null, overleaf: null, pendingPaths: [], storedAsFiles: [] });
});

describe("FileTabStatus on Overleaf", () => {
  it("shows a dot until Overleaf confirms the file", () => {
    const { rerender } = render(<FileTabStatus path="main.tex" />);
    expect(screen.getByText(LABEL)).toHaveClass("sr-only");
    useLiveBackend.setState({ pendingPaths: [] });
    rerender(<FileTabStatus path="main.tex" />);
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it("leaves confirmed files and other projects alone", () => {
    render(<FileTabStatus path="intro.tex" />);
    expect(screen.queryByText(LABEL)).toBeNull();
    cleanup();
    useLiveBackend.setState({ projectId: "other" });
    render(<FileTabStatus path="main.tex" />);
    expect(screen.queryByText(LABEL)).toBeNull();
  });

  it("says a text file Overleaf stores as a file uploads when saved, and leaves images alone", () => {
    useLiveBackend.setState({ pendingPaths: [], storedAsFiles: ["intro.tex", "plot.png"] });
    render(<FileTabStatus path="intro.tex" />);
    expect(screen.getByTestId("tab-stored-as-file")).toHaveClass("text-muted-foreground");
    expect(screen.getByText(STORED)).toHaveClass("sr-only");
    cleanup();
    useFilesStore.setState({ files: { "intro.tex": { content: "b!\n", dirty: true } } });
    render(<FileTabStatus path="intro.tex" />);
    expect(screen.getByTestId("tab-stored-as-file")).toHaveClass("text-primary");
    cleanup();
    render(<FileTabStatus path="plot.png" />);
    expect(screen.queryByText(STORED)).toBeNull();
    cleanup();
    useLiveBackend.setState({ projectId: "other" });
    render(<FileTabStatus path="intro.tex" />);
    expect(screen.queryByText(STORED)).toBeNull();
  });

  it("puts a change on disk ahead of the Overleaf dot", () => {
    useFilesStore.setState({ changedOnDisk: ["main.tex"] });
    render(<FileTabStatus path="main.tex" />);
    expect(screen.getByTitle(enEditor.changedOnDisk.tabMark)).toBeInTheDocument();
    expect(screen.queryByText(LABEL)).toBeNull();
  });
});
