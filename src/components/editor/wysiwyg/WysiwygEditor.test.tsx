// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { WysiwygEditor } from "./WysiwygEditor";
import { useFilesStore } from "@/store/files";

let lastEditor: Editor | null = null;

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      lastEditor = editor;
      return editor;
    },
  };
});

const LATEX_A = `\\documentclass{article}
\\begin{document}
\\section{Intro}
Hello.
\\end{document}
`;

const LATEX_B = `\\documentclass{article}
\\begin{document}
\\section{Second}
World.
\\end{document}
`;

const MARKDOWN_WITH_FRONTMATTER = `---
title: My Doc
---

# Heading

Body text.
`;

function setFiles(files: Record<string, { content: string; dirty: boolean }>, activePath: string) {
  useFilesStore.setState({
    activePath,
    files,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
}

describe("WysiwygEditor", () => {
  beforeEach(() => {
    lastEditor = null;
    setFiles(
      {
        "main.tex": { content: LATEX_A, dirty: false },
      },
      "main.tex",
    );
  });

  it("renders the parsed heading text from the active file", () => {
    render(<WysiwygEditor />);
    expect(screen.getByText("Intro")).toBeInTheDocument();
  });

  it("preserves the LaTeX preamble/suffix and wraps the edited body on unmount", () => {
    const { unmount } = render(<WysiwygEditor />);
    expect(lastEditor).not.toBeNull();

    act(() => {
      lastEditor!.chain().focus().insertContentAt(lastEditor!.state.doc.content.size, " Edited.").run();
    });

    act(() => {
      unmount();
    });

    const saved = useFilesStore.getState().files["main.tex"].content;
    expect(saved.startsWith("\\documentclass{article}\n\\begin{document}\n")).toBe(true);
    expect(saved.endsWith("\\end{document}\n")).toBe(true);
    expect(saved).toContain("\\section{Intro}");
    expect(saved).toContain("Hello.");
    expect(saved).toContain("Edited.");
  });

  it("saves the PREVIOUS file's edits to the PREVIOUS path when activePath switches, and loads the new file", () => {
    setFiles(
      {
        "a.tex": { content: LATEX_A, dirty: false },
        "b.tex": { content: LATEX_B, dirty: false },
      },
      "a.tex",
    );

    render(<WysiwygEditor />);
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(lastEditor).not.toBeNull();

    act(() => {
      lastEditor!.chain().focus().insertContentAt(lastEditor!.state.doc.content.size, " EDITED-A").run();
    });

    act(() => {
      useFilesStore.setState({ activePath: "b.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    });

    const aContent = useFilesStore.getState().files["a.tex"].content;
    const bContent = useFilesStore.getState().files["b.tex"].content;

    expect(aContent).toContain("Hello.");
    expect(aContent).toContain("EDITED-A");
    expect(aContent).toContain("\\section{Intro}");
    expect(bContent).toBe(LATEX_B);

    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("Intro")).not.toBeInTheDocument();
  });

  it("round-trips markdown frontmatter unchanged", () => {
    setFiles(
      {
        "notes.md": { content: MARKDOWN_WITH_FRONTMATTER, dirty: false },
      },
      "notes.md",
    );

    const { unmount } = render(<WysiwygEditor />);
    expect(screen.getByText("Heading")).toBeInTheDocument();

    act(() => {
      unmount();
    });

    const saved = useFilesStore.getState().files["notes.md"].content;
    expect(saved.startsWith("---\ntitle: My Doc\n---")).toBe(true);
    expect(saved).toContain("# Heading");
    expect(saved).toContain("Body text.");
  });
});
