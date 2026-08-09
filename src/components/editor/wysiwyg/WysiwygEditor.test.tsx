// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { WysiwygEditor } from "./WysiwygEditor";
import { useFilesStore } from "@/store/files";
import {
  flushWysiwygPendingEdits,
  invalidateWysiwygProjectSession,
} from "./controller";

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
    projectId: null,
    activePath,
    files,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
}

function requireEditor(): Editor {
  if (!lastEditor) throw new Error("editor not ready");
  return lastEditor;
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
    render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.getByText("Intro")).toBeInTheDocument();
  });

  it("keeps loaded content outside history while preserving undo and redo for user edits", () => {
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();

    act(() => {
      editor.chain().insertContentAt(editor.state.doc.content.size, " EDITED").run();
    });
    expect(editor.getText()).toContain("EDITED");

    act(() => {
      expect(editor.commands.undo()).toBe(true);
    });
    expect(editor.getText()).toContain("Intro");
    expect(editor.getText()).toContain("Hello.");
    expect(editor.getText()).not.toContain("EDITED");

    act(() => {
      expect(editor.commands.redo()).toBe(true);
    });
    expect(editor.getText()).toContain("EDITED");
  });

  it("clears visual history when the active file changes", () => {
    setFiles(
      {
        "a.tex": { content: LATEX_A, dirty: false },
        "b.tex": { content: LATEX_B, dirty: false },
      },
      "a.tex",
    );
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();

    act(() => {
      editor.chain().insertContentAt(editor.state.doc.content.size, " EDITED-A").run();
      useFilesStore.setState({
        activePath: "b.tex",
      } as unknown as ReturnType<typeof useFilesStore.getState>);
    });

    expect(editor.getText()).toContain("Second");
    expect(editor.getText()).toContain("World.");
    expect(editor.getText()).not.toContain("EDITED-A");
    expect(editor.commands.undo()).toBe(false);
    expect(editor.getText()).toContain("Second");
  });

  it("preserves the LaTeX preamble/suffix and wraps the edited body on unmount", () => {
    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);
    expect(lastEditor).not.toBeNull();

    act(() => {
      const editor = requireEditor();
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, " Edited.").run();
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

    render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(lastEditor).not.toBeNull();

    act(() => {
      const editor = requireEditor();
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, " EDITED-A").run();
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

  it("does not overwrite newer content with a stale doc when hidden (wysiwyg=false) and the file switches", () => {
    setFiles(
      {
        "a.tex": { content: LATEX_A, dirty: false },
        "b.tex": { content: LATEX_B, dirty: false },
      },
      "a.tex",
    );

    render(<WysiwygEditor wysiwyg={false} />);
    expect(lastEditor).not.toBeNull();

    const newerContent = "\\documentclass{article}\n\\begin{document}\n\\section{From CodeMirror}\n\\end{document}\n";
    act(() => {
      useFilesStore.getState().setContent("a.tex", newerContent);
    });

    act(() => {
      useFilesStore.setState({ activePath: "b.tex" } as unknown as ReturnType<typeof useFilesStore.getState>);
    });

    expect(useFilesStore.getState().files["a.tex"].content).toBe(newerContent);
  });

  it("flushes an edit to the store while still in WYSIWYG mode, without unmounting or switching files", () => {
    vi.useFakeTimers();
    try {
      render(<WysiwygEditor wysiwyg={true} />);
      expect(lastEditor).not.toBeNull();

      act(() => {
        const editor = requireEditor();
        editor.chain().insertContentAt(editor.state.doc.content.size, " EDITED-LIVE").run();
      });

      expect(useFilesStore.getState().files["main.tex"].content).toBe(LATEX_A);

      act(() => {
        vi.advanceTimersByTime(500);
      });

      const saved = useFilesStore.getState().files["main.tex"].content;
      expect(saved).toContain("EDITED-LIVE");
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes a pending edit synchronously for a project transition", () => {
    render(<WysiwygEditor wysiwyg={true} />);

    act(() => {
      requireEditor()
        .chain()
        .insertContentAt(requireEditor().state.doc.content.size, " TRANSITION-EDIT")
        .run();
      flushWysiwygPendingEdits();
    });

    expect(useFilesStore.getState().files["main.tex"].content).toContain(
      "TRANSITION-EDIT",
    );
  });

  it("does not serialize an unchanged Visual document for a project transition", () => {
    render(<WysiwygEditor wysiwyg={true} />);

    act(() => flushWysiwygPendingEdits());

    expect(useFilesStore.getState().files["main.tex"]).toEqual({
      content: LATEX_A,
      dirty: false,
    });
  });

  it("does not flush an old editor into a replacement project during unmount", () => {
    useFilesStore.setState({ projectId: "project" });
    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);

    act(() => {
      requireEditor()
        .chain()
        .insertContentAt(requireEditor().state.doc.content.size, " OLD-PROJECT-EDIT")
        .run();
      useFilesStore.setState({
        projectId: "replacement-project",
        files: { "main.tex": { content: LATEX_B, dirty: false } },
        activePath: "main.tex",
      } as unknown as ReturnType<typeof useFilesStore.getState>);
      unmount();
    });

    expect(useFilesStore.getState().files["main.tex"].content).toBe(LATEX_B);
  });

  it("does not flush an old editor into a reopened session of the same project", () => {
    useFilesStore.setState({ projectId: "project" });
    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);

    act(() => {
      requireEditor()
        .chain()
        .insertContentAt(requireEditor().state.doc.content.size, " OLD-SESSION-EDIT")
        .run();
      invalidateWysiwygProjectSession();
      useFilesStore.setState({
        projectId: "project",
        files: { "main.tex": { content: LATEX_B, dirty: false } },
        activePath: "main.tex",
      } as unknown as ReturnType<typeof useFilesStore.getState>);
      unmount();
    });

    expect(useFilesStore.getState().files["main.tex"].content).toBe(LATEX_B);
  });

  it("does not rewrite the store merely from loading a file with no edits", () => {
    vi.useFakeTimers();
    try {
      render(<WysiwygEditor wysiwyg={true} />);
      expect(lastEditor).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(useFilesStore.getState().files["main.tex"].content).toBe(LATEX_A);
      expect(useFilesStore.getState().files["main.tex"].dirty).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("round-trips markdown frontmatter unchanged", () => {
    setFiles(
      {
        "notes.md": { content: MARKDOWN_WITH_FRONTMATTER, dirty: false },
      },
      "notes.md",
    );

    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.getByText("Heading")).toBeInTheDocument();

    act(() => {
      unmount();
    });

    const saved = useFilesStore.getState().files["notes.md"].content;
    expect(saved.startsWith("---\ntitle: My Doc\n---")).toBe(true);
    expect(saved).toContain("# Heading");
    expect(saved).toContain("Body text.");
  });

  it("shows a collapsed preamble toggle for a full LaTeX document, hidden by default", () => {
    render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.getByText("Show document preamble")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/documentclass/)).not.toBeInTheDocument();
  });

  it("reveals and edits the preamble, and the edit is saved back on unmount", () => {
    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);

    fireEvent.click(screen.getByText("Show document preamble"));
    const textarea = screen.getByDisplayValue(/documentclass/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("\\documentclass{article}\n\\begin{document}\n");

    fireEvent.change(textarea, { target: { value: "\\documentclass{report}\n\\begin{document}\n" } });

    act(() => {
      unmount();
    });

    const saved = useFilesStore.getState().files["main.tex"].content;
    expect(saved.startsWith("\\documentclass{report}\n\\begin{document}\n")).toBe(true);
    expect(saved).toContain("\\section{Intro}");
  });

  it("does not show a preamble toggle for markdown files or LaTeX without \\begin{document}", () => {
    setFiles(
      {
        "notes.md": { content: MARKDOWN_WITH_FRONTMATTER, dirty: false },
      },
      "notes.md",
    );
    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.queryByText("Show document preamble")).not.toBeInTheDocument();
    unmount();

    setFiles(
      {
        "snippet.tex": { content: "Just a snippet, no document environment.\n", dirty: false },
      },
      "snippet.tex",
    );
    render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.queryByText("Show document preamble")).not.toBeInTheDocument();
  });
});
