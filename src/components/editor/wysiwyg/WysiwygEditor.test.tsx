// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { WysiwygEditor } from "./WysiwygEditor";
import { useFilesStore } from "@/store/files";
import { acquireEditorMutationLease } from "@/lib/editor-mutation-lease";
import { useFolderAccessStore } from "@/store/folder-access";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { fileMode, useVisualModeStore } from "@/store/visual-mode";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { flushWysiwygPendingEdits, invalidateWysiwygProjectSession } from "./controller";

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

const MARKDOWN_A = "# Intro\n\nHello.\n";

const MARKDOWN_B = "# Second\n\nWorld.\n";

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
        "main.md": { content: MARKDOWN_A, dirty: false },
      },
      "main.md",
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
        "a.md": { content: MARKDOWN_A, dirty: false },
        "b.md": { content: MARKDOWN_B, dirty: false },
      },
      "a.md",
    );
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();

    act(() => {
      editor.chain().insertContentAt(editor.state.doc.content.size, " EDITED-A").run();
      useFilesStore.setState({
        activePath: "b.md",
      } as unknown as ReturnType<typeof useFilesStore.getState>);
    });

    expect(editor.getText()).toContain("Second");
    expect(editor.getText()).toContain("World.");
    expect(editor.getText()).not.toContain("EDITED-A");
    expect(editor.commands.undo()).toBe(false);
    expect(editor.getText()).toContain("Second");
  });

  it("writes the edited Markdown back on unmount", () => {
    const { unmount } = render(<WysiwygEditor wysiwyg={true} />);
    expect(lastEditor).not.toBeNull();

    act(() => {
      const editor = requireEditor();
      editor.chain().focus().insertContentAt(editor.state.doc.content.size - 1, " Edited.").run();
    });

    act(() => {
      unmount();
    });

    expect(useFilesStore.getState().files["main.md"].content).toBe("# Intro\n\nHello. Edited.\n");
  });

  it("saves the PREVIOUS file's edits to the PREVIOUS path when activePath switches, and loads the new file", () => {
    setFiles(
      {
        "a.md": { content: MARKDOWN_A, dirty: false },
        "b.md": { content: MARKDOWN_B, dirty: false },
      },
      "a.md",
    );

    render(<WysiwygEditor wysiwyg={true} />);
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(lastEditor).not.toBeNull();

    act(() => {
      const editor = requireEditor();
      editor.chain().focus().insertContentAt(editor.state.doc.content.size, " EDITED-A").run();
    });

    act(() => {
      useFilesStore.setState({ activePath: "b.md" } as unknown as ReturnType<typeof useFilesStore.getState>);
    });

    const aContent = useFilesStore.getState().files["a.md"].content;
    const bContent = useFilesStore.getState().files["b.md"].content;

    expect(aContent).toContain("Hello.");
    expect(aContent).toContain("EDITED-A");
    expect(aContent).toContain("# Intro");
    expect(bContent).toBe(MARKDOWN_B);

    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.queryByText("Intro")).not.toBeInTheDocument();
  });

  it("does not overwrite newer content with a stale doc when hidden (wysiwyg=false) and the file switches", () => {
    setFiles(
      {
        "a.md": { content: MARKDOWN_A, dirty: false },
        "b.md": { content: MARKDOWN_B, dirty: false },
      },
      "a.md",
    );

    render(<WysiwygEditor wysiwyg={false} />);
    expect(lastEditor).not.toBeNull();

    const newerContent = "# From CodeMirror\n";
    act(() => {
      useFilesStore.getState().setContent("a.md", newerContent);
    });

    act(() => {
      useFilesStore.setState({ activePath: "b.md" } as unknown as ReturnType<typeof useFilesStore.getState>);
    });

    expect(useFilesStore.getState().files["a.md"].content).toBe(newerContent);
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

      expect(useFilesStore.getState().files["main.md"].content).toBe(MARKDOWN_A);

      act(() => {
        vi.advanceTimersByTime(500);
      });

      const saved = useFilesStore.getState().files["main.md"].content;
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

    expect(useFilesStore.getState().files["main.md"].content).toContain(
      "TRANSITION-EDIT",
    );
  });

  it("does not serialize an unchanged Visual document for a project transition", () => {
    render(<WysiwygEditor wysiwyg={true} />);

    act(() => flushWysiwygPendingEdits());

    expect(useFilesStore.getState().files["main.md"]).toEqual({
      content: MARKDOWN_A,
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
        files: { "main.md": { content: MARKDOWN_B, dirty: false } },
        activePath: "main.md",
      } as unknown as ReturnType<typeof useFilesStore.getState>);
      unmount();
    });

    expect(useFilesStore.getState().files["main.md"].content).toBe(MARKDOWN_B);
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
        files: { "main.md": { content: MARKDOWN_B, dirty: false } },
        activePath: "main.md",
      } as unknown as ReturnType<typeof useFilesStore.getState>);
      unmount();
    });

    expect(useFilesStore.getState().files["main.md"].content).toBe(MARKDOWN_B);
  });

  it("does not rewrite the store merely from loading a file with no edits", () => {
    vi.useFakeTimers();
    try {
      render(<WysiwygEditor wysiwyg={true} />);
      expect(lastEditor).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(useFilesStore.getState().files["main.md"].content).toBe(MARKDOWN_A);
      expect(useFilesStore.getState().files["main.md"].dirty).toBe(false);
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

  it("keeps untouched Markdown comments, citations and footnotes when another block is edited", () => {
    const source = `---
title: Práce
---

# Úvod

<!-- TODO: doplnit zdroje před odevzdáním -->

Jak uvádí [@novak2020, s. 3], papír se skládá z vrcholů[^1].

Platí 1 < 2.

[^1]: Poznámka pod čarou.
`;
    setFiles({ "main.md": { content: source, dirty: false } }, "main.md");
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();

    act(() => {
      editor.commands.insertContentAt(2, "X");
    });
    act(() => flushWysiwygPendingEdits());

    expect(useFilesStore.getState().files["main.md"].content).toBe(
      source.replace("# Úvod", "# ÚXvod"),
    );
  });

  it("writes each Markdown file against its own source when the active file switches", () => {
    const a = "# Alfa\n\n<!-- poznámka A -->\n\nText [@a2020].\n";
    const b = "# Beta\n\n<!-- poznámka B -->\n\n[^1]: Poznámka.\n";
    setFiles(
      {
        "a.md": { content: a, dirty: false },
        "b.md": { content: b, dirty: false },
      },
      "a.md",
    );
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();

    act(() => {
      editor.commands.insertContentAt(2, "X");
      useFilesStore.setState({ activePath: "b.md" } as unknown as ReturnType<typeof useFilesStore.getState>);
    });
    expect(useFilesStore.getState().files["a.md"].content).toBe(a.replace("# Alfa", "# AXlfa"));

    act(() => {
      editor.commands.insertContentAt(2, "Y");
    });
    act(() => flushWysiwygPendingEdits());
    expect(useFilesStore.getState().files["b.md"].content).toBe(b.replace("# Beta", "# BYeta"));
  });

  it.each([
    ["a list", "Úvod\n\n* první\n* druhá\n", "Úvod\n\n* první\n* druhá\n\nDalší\n"],
    [
      "a list and a reference definition",
      "Úvod\n\n* [první][x]\n\n[x]: https://example.com\n",
      "Úvod\n\n* [první][x]\n\n[x]: https://example.com\n\nDalší\n",
    ],
  ])("keeps a Markdown file ending in %s when typing below it", (_name, source, expected) => {
    setFiles({ "main.md": { content: source, dirty: false } }, "main.md");
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();
    const last = editor.state.doc.lastChild;
    expect(last?.type.name).toBe("paragraph");
    expect(last?.content.size).toBe(0);

    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "Další");
    });
    act(() => flushWysiwygPendingEdits());

    expect(useFilesStore.getState().files["main.md"].content).toBe(expected);
  });

  it("keeps the front matter's own line break when the body is edited", () => {
    const source = "---\ntitle: Tight\n---\n# Heading\n\nBody.\n";
    setFiles({ "tight.md": { content: source, dirty: false } }, "tight.md");
    render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();

    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " More.");
    });
    act(() => flushWysiwygPendingEdits());

    expect(useFilesStore.getState().files["tight.md"].content).toBe("---\ntitle: Tight\n---\n# Heading\n\nBody. More.\n");
  });
});


it("blocks visual commands while leased and flushes edits made before acquisition", async () => {
  useFilesStore.setState({ projectId: "lease-project", activePath: "main.md", files: { "main.md": { content: MARKDOWN_A, dirty: false } } });
  const mounted = render(<WysiwygEditor wysiwyg={true} />);
  const editor = requireEditor();
  act(() => { editor.commands.insertContentAt(editor.state.doc.content.size, " Pending"); });
  const lease = acquireEditorMutationLease("lease-project");
  try {
    act(() => {
      flushWysiwygPendingEdits();
      editor.commands.insertContentAt(editor.state.doc.content.size, " Blocked");
    });
    expect(useFilesStore.getState().files["main.md"].content).toContain("Pending");
    expect(editor.getText()).not.toContain("Blocked");
    await act(async () => {
      useFilesStore.setState({ files: { "main.md": { content: MARKDOWN_B, dirty: false } } });
      await lease.reconcile();
    });
    expect(editor.getText()).toContain("Second");
    expect(editor.getText()).not.toContain("Pending");
  } finally {
    lease.release();
    mounted.unmount();
    useFilesStore.setState({ projectId: null });
  }
});

describe("Visual mode in a read-only folder", () => {
  function setFolderReadOnly(readOnly: boolean): void {
    useFolderAccessStore.setState({
      projectId: "read-only-project",
      status: { read_only: readOnly, synced_with: null },
    });
  }

  beforeEach(() => {
    lastEditor = null;
    useFilesStore.setState({
      projectId: "read-only-project",
      activePath: "main.md",
      files: { "main.md": { content: MARKDOWN_A, dirty: false } },
    });
  });

  it("is not editable and keeps the file clean while the folder is read-only", () => {
    setFolderReadOnly(true);
    const mounted = render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();
    try {
      expect(editor.isEditable).toBe(false);
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, " Blocked");
        flushWysiwygPendingEdits();
      });
      expect(editor.getText()).not.toContain("Blocked");
      act(() => acquireEditorMutationLease("read-only-project").release());
      expect(editor.isEditable).toBe(false);
      expect(useFilesStore.getState().files["main.md"]).toEqual({ content: MARKDOWN_A, dirty: false });
    } finally {
      mounted.unmount();
      useFolderAccessStore.getState().reset(null);
      useFilesStore.setState({ projectId: null });
    }
  });

  it("becomes editable once the folder is writable", () => {
    setFolderReadOnly(true);
    const mounted = render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();
    try {
      act(() => setFolderReadOnly(false));
      expect(editor.isEditable).toBe(true);
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, " Typed");
        flushWysiwygPendingEdits();
      });
      expect(useFilesStore.getState().files["main.md"]).toMatchObject({ dirty: true });
      expect(useFilesStore.getState().files["main.md"].content).toContain("Typed");
    } finally {
      mounted.unmount();
      useFolderAccessStore.getState().reset(null);
      useFilesStore.setState({ projectId: null });
    }
  });
});

describe("WysiwygEditor native nodes", () => {
  beforeEach(() => {
    lastEditor = null;
    useFilesStore.setState({ projectId: null });
  });

  it("renders math through KaTeX", () => {
    setFiles({ "main.md": { content: "Inline $a^2$ here.\n", dirty: false } }, "main.md");
    const { container } = render(<WysiwygEditor wysiwyg={true} />);
    expect(container.querySelector('[data-type="math-inline"] .math-rendered .katex')).not.toBeNull();
  });

});

describe("Visual Markdown in a live shared project", () => {
  const NOTES = "# Notes\n\nShared text.\n";

  beforeEach(() => {
    lastEditor = null;
    useFilesStore.setState({
      projectId: "shared-project",
      activePath: "notes.md",
      files: { "notes.md": { content: NOTES, dirty: false } },
    });
  });

  function leave() {
    useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false, suggesting: false });
    useFilesStore.setState({ projectId: null });
  }

  it("stays editable for an editor of a live project", () => {
    useCollabEditorGate.setState({ projectId: "shared-project", viewer: false, locked: false });
    const mounted = render(<WysiwygEditor wysiwyg={true} />);
    try {
      expect(requireEditor().isEditable).toBe(true);
      expect(screen.queryByTestId("visual-live-notice")).toBeNull();
    } finally {
      mounted.unmount();
      leave();
    }
  });

  it.each([
    ["a viewer", { viewer: true, locked: true }, "view", enEditor.visual.liveViewOnly],
    ["a project that is still connecting", { connecting: true }, "connecting", enEditor.visual.liveConnecting],
  ] as const)("is read-only for %s and says why", (_case, gate, lock, message) => {
    useCollabEditorGate.setState({ projectId: "shared-project", ...gate });
    const mounted = render(<WysiwygEditor wysiwyg={true} />);
    const editor = requireEditor();
    try {
      expect(editor.isEditable).toBe(false);
      act(() => {
        editor.commands.insertContentAt(editor.state.doc.content.size, " Blocked");
        flushWysiwygPendingEdits();
      });
      expect(editor.getText()).not.toContain("Blocked");
      act(() => acquireEditorMutationLease("shared-project").release());
      expect(editor.isEditable).toBe(false);
      expect(useFilesStore.getState().files["notes.md"]).toEqual({ content: NOTES, dirty: false });
      const notice = screen.getByTestId("visual-live-notice");
      expect(notice).toHaveAttribute("data-lock", lock);
      expect(notice).toHaveTextContent(message);
      act(() => leave());
      expect(editor.isEditable).toBe(true);
      expect(screen.queryByTestId("visual-live-notice")).toBeNull();
    } finally {
      mounted.unmount();
      leave();
    }
  });

  it.each([
    ["a reviewer", { locked: true }],
    ["an editor whose edits are suggestions", { suggesting: true }],
  ] as const)("is read-only for %s and offers the source view", (_case, gate) => {
    useCollabEditorGate.setState({ projectId: "shared-project", viewer: false, locked: false, ...gate });
    useVisualModeStore.setState({ projectId: null, kinds: { markdown: "visual" }, files: {} });
    const mounted = render(<WysiwygEditor wysiwyg={true} />);
    try {
      expect(requireEditor().isEditable).toBe(false);
      expect(screen.getByTestId("visual-live-notice")).toHaveTextContent(enEditor.visual.suggestInSource);
      fireEvent.click(screen.getByRole("button", { name: enEditor.toolbar.switchToSource }));
      expect(fileMode(useVisualModeStore.getState(), "notes.md")).toBe("code");
    } finally {
      mounted.unmount();
      leave();
    }
  });
});
