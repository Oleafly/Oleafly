// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "@oleafly/wysiwyg";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { EditorMode } from "@/lib/wysiwyg-mode";

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));
vi.mock("@/components/editor/project-info-data", () => ({ collectProjectInfo: vi.fn() }));

import { setEditorView } from "@/components/editor/cm/controller";
import { bumpEditorSelectionRevision } from "@/components/editor/cm/cursor-signal";
import { setWysiwygEditor } from "@/components/editor/wysiwyg/controller";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { MarkdownToolbar } from "./MarkdownToolbar";

const toolbar = en.toolbar;

function widenToolbar(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: width });
}

function buttons(): string[] {
  const bar = document.querySelector("[data-markdown-toolbar]") as HTMLElement;
  return [...bar.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
}

describe("Markdown toolbar in Code, Visual and Both", () => {
  let visual: Editor;
  let view: EditorView;

  beforeEach(() => {
    visual = new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, content: "<p>Hello</p>" });
    view = new EditorView({ state: EditorState.create({ doc: "Hello\n" }), parent: document.body });
    act(() => {
      setWysiwygEditor(visual);
      setEditorView(view);
    });
  });

  afterEach(() => {
    act(() => {
      setWysiwygEditor(null);
      setEditorView(null);
    });
    visual.destroy();
    view.destroy();
    widenToolbar(0);
  });

  async function shown(mode: EditorMode): Promise<string[]> {
    const rendered = render(
      <MarkdownToolbar wysiwyg={mode === "visual"} mode={mode} onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />,
    );
    await act(async () => {
      await import("./markdown-toolbar-controls");
    });
    const list = buttons();
    rendered.unmount();
    return list;
  }

  it.each([2000, 420, 200])("shows the same buttons in the same order at %i px", async (width) => {
    widenToolbar(width);
    const visualButtons = await shown("visual");
    expect(visualButtons).toContain(width >= 2000 ? toolbar.align.center : toolbar.moreOptions);
    expect(await shown("code")).toEqual(visualButtons);
    expect(await shown("both")).toEqual(visualButtons);
  });

  it("keeps underline, highlight, superscript, subscript, image, table and the pen tool in both modes, and no Find", async () => {
    widenToolbar(2000);
    const find = toolbar.find.split(" (")[0];
    for (const mode of ["visual", "code"] as const) {
      const list = await shown(mode);
      for (const label of [toolbar.underline, toolbar.highlight, toolbar.superscript, toolbar.subscript, toolbar.drawDiagram, toolbar.insertTable]) {
        expect(list).toContain(label);
      }
      expect(list.filter((label) => label.startsWith(find))).toEqual([]);
    }
  });

  async function moreMenu(mode: EditorMode): Promise<string[]> {
    const rendered = render(<MarkdownToolbar wysiwyg={mode === "visual"} mode={mode} onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    await act(async () => {
      await import("./markdown-toolbar-controls");
    });
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    const items = screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label") ?? item.textContent ?? "");
    rendered.unmount();
    return items;
  }

  it.each([420, 200])("puts the same rows in More at %i px in every mode, with Emoji once", async (width) => {
    widenToolbar(width);
    const visualItems = await moreMenu("visual");
    expect(visualItems.filter((item) => item === toolbar.emoji)).toHaveLength(1);
    expect(await moreMenu("code")).toEqual(visualItems);
    expect(await moreMenu("both")).toEqual(visualItems);
  });

  it("leaves More untinted for a plain left-aligned paragraph, the default", async () => {
    widenToolbar(200);
    act(() => {
      view.dispatch({ selection: { anchor: 2 } });
      bumpEditorSelectionRevision();
    });
    const rendered = render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    await act(async () => {
      await import("./markdown-toolbar-controls");
    });
    expect(screen.getByLabelText(toolbar.moreOptions)).not.toHaveClass("bg-primary/10");
    rendered.unmount();
  });

  it("tints More and the heading control when the heading or alignment the caret is in is hidden", async () => {
    widenToolbar(200);
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "::: {.center}\n## Mid\n:::\n" }, selection: { anchor: 18 } });
      bumpEditorSelectionRevision();
    });
    const rendered = render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    await act(async () => {
      await import("./markdown-toolbar-controls");
    });
    expect(screen.getByLabelText(toolbar.moreOptions)).toHaveClass("bg-primary/10");
    rendered.unmount();
  });

  it("shows the Visual tints in the first frame after switching from Code", async () => {
    widenToolbar(2000);
    await import("./markdown-toolbar-controls");
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "## Title\n" }, selection: { anchor: 4 } });
      visual.commands.setContent("<h2>Title</h2>");
      visual.commands.setTextSelection(3);
      bumpEditorSelectionRevision();
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const bar = (mode: EditorMode) => <MarkdownToolbar wysiwyg={mode === "visual"} mode={mode} onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />;
    try {
      flushSync(() => root.render(bar("code")));
      const h2 = () => host.querySelector(`[aria-label="${en.headings.section}"]`);
      expect(h2()).toHaveAttribute("aria-pressed", "true");
      flushSync(() => root.render(bar("visual")));
      expect(h2()).toHaveAttribute("aria-pressed", "true");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("draws the formatting buttons in the first frame of a later mount", async () => {
    widenToolbar(2000);
    const first = render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    await act(async () => {
      await import("./markdown-toolbar-controls");
    });
    first.unmount();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      flushSync(() => root.render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />));
      expect(host.querySelectorAll("[data-markdown-toolbar] button").length).toBeGreaterThan(20);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("wraps the formatting group under the mode switch in a narrow pane instead of scrolling it away", async () => {
    await shown("code");
    const rendered = render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    const bar = document.querySelector("[data-markdown-toolbar]") as HTMLElement;
    expect(bar).toHaveClass("flex-wrap");
    expect(bar).not.toHaveClass("overflow-x-auto");
    rendered.unmount();
  });

  it("drops the divider that would start the wrapped row", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const groupOf = () => (document.querySelector("[data-markdown-toolbar]") as HTMLElement).children[1] as HTMLElement;
    const leadsWithDivider = () => groupOf().firstElementChild?.classList.contains("w-px") ?? false;
    let groupTop = 40;
    const offsetTop = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.parentElement?.hasAttribute("data-markdown-toolbar") && this === this.parentElement.children[1] ? groupTop : 0;
    });
    try {
      const wrapped = render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
      expect(leadsWithDivider()).toBe(false);
      wrapped.unmount();
      groupTop = 0;
      render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
      expect(leadsWithDivider()).toBe(true);
    } finally {
      offsetTop.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("keeps formatting on in every mode in a shared project an editor can write to", async () => {
    widenToolbar(2000);
    useFilesStore.setState({ projectId: "p1" });
    useCollabEditorGate.setState({ projectId: "p1", viewer: false, locked: false });
    try {
      for (const mode of ["code", "both", "visual"] as const) {
        const rendered = render(<MarkdownToolbar wysiwyg={mode === "visual"} mode={mode} onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
        await act(async () => {
          await import("./markdown-toolbar-controls");
        });
        const bold = screen.getAllByRole("button").find((button) => button.getAttribute("aria-label")?.startsWith("Bold")) as HTMLElement;
        expect(bold).not.toBeDisabled();
        rendered.unmount();
      }
    } finally {
      useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false });
      useFilesStore.setState({ projectId: null });
    }
  });

  it("waits for a pause before relighting after the caret moves in a block that is slow to read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => (clock += 50));
    try {
      widenToolbar(2000);
      act(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Alpha [zqz](https://x.example) beta.\n" }, selection: { anchor: 2 } });
        bumpEditorSelectionRevision();
      });
      render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
      await act(async () => {
        await import("./markdown-toolbar-controls");
      });
      const unlink = () => screen.getByRole("button", { name: toolbar.removeLink });
      act(() => {
        view.dispatch({ selection: { anchor: 8 } });
        bumpEditorSelectionRevision();
      });
      expect(unlink()).toBeDisabled();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(unlink()).not.toBeDisabled();
    } finally {
      now.mockRestore();
      vi.useRealTimers();
    }
  });

  it("lights the new caret's state as soon as the caret moves or the file changes, and waits while you type", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      widenToolbar(2000);
      act(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Alpha [zqz](https://x.example) beta.\n" }, selection: { anchor: 2 } });
        bumpEditorSelectionRevision();
      });
      render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
      await act(async () => {
        await import("./markdown-toolbar-controls");
      });
      const unlink = () => screen.getByRole("button", { name: toolbar.removeLink });
      expect(unlink()).toBeDisabled();
      act(() => {
        view.dispatch({ selection: { anchor: 8 } });
        bumpEditorSelectionRevision();
      });
      expect(unlink()).not.toBeDisabled();
      act(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "## Head\n" }, selection: { anchor: 4 } });
        bumpEditorSelectionRevision();
      });
      expect(unlink()).toBeDisabled();
      act(() => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "A [zqz](https://x.example)\n" }, selection: { anchor: 4 } });
        bumpEditorSelectionRevision(true);
      });
      expect(unlink()).toBeDisabled();
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(unlink()).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits the Markdown and lights the alignment the cursor is in, in Code mode", async () => {
    widenToolbar(2000);
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "::: {.center}\nMid\n:::\n" }, selection: { anchor: 15 } });
      bumpEditorSelectionRevision();
    });
    render(<MarkdownToolbar wysiwyg={false} mode="code" onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    await act(async () => {
      await import("./markdown-toolbar-controls");
    });
    expect(screen.getByRole("button", { name: toolbar.align.center })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: toolbar.align.center })).not.toHaveClass("ring-1");
    fireEvent.click(screen.getByRole("button", { name: toolbar.align.right }));
    expect(view.state.doc.toString()).toBe("::: {.right}\nMid\n:::\n");
  });

  it.each([420, 200])("checks the caret's heading level once the headings fold, in every mode, at %i px", async (width) => {
    widenToolbar(width);
    await import("./markdown-toolbar-controls");
    act(() => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "## Heading two\n" }, selection: { anchor: 5 } });
      visual.commands.setContent("<h2>Heading two</h2>");
      visual.commands.setTextSelection(3);
      bumpEditorSelectionRevision();
    });
    const checkedLevels = async (mode: EditorMode) => {
      const rendered = render(<MarkdownToolbar wysiwyg={mode === "visual"} mode={mode} onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
      await act(async () => {
        await import("./markdown-toolbar-controls");
      });
      if (width === 200) {
        fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
        fireEvent.click(screen.getByRole("menuitem", { name: toolbar.headingLevel }));
      } else {
        expect(screen.getByRole("button", { name: toolbar.headingLevel })).toHaveClass("bg-primary/10");
        fireEvent.click(screen.getByRole("button", { name: toolbar.headingLevel }));
      }
      const menu = screen.getAllByRole("menu").at(-1) as HTMLElement;
      const rows = within(menu)
        .getAllByRole("menuitemcheckbox")
        .map((row) => [row.textContent, row.getAttribute("aria-checked")]);
      rendered.unmount();
      return rows;
    };
    const code = await checkedLevels("code");
    expect(code.filter(([, checked]) => checked === "true")).toEqual([[`H2${en.headings.section}`, "true"]]);
    expect(code).toHaveLength(6);
    expect(await checkedLevels("visual")).toEqual(code);
    expect(await checkedLevels("both")).toEqual(code);
  });

  it.each([
    ["visual", 420],
    ["visual", 200],
    ["code", 420],
    ["code", 200],
  ] as const)("puts focus back in the %s editor after a heading pick at %i px, even when the editor focuses a frame late", async (mode, width) => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => frames.push(frame));
    const rects = { list: Range.prototype.getClientRects, box: Range.prototype.getBoundingClientRect };
    const rect = new DOMRect(0, 0, 0, 0);
    Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => rect;
    const nextFrame = () => {
      for (const frame of frames.splice(0)) frame(0);
    };
    const host = document.createElement("div");
    document.body.append(host);
    const attached = new Editor({ element: host, extensions: WYSIWYG_EXTENSIONS, content: "<h2>Heading two</h2>" });
    widenToolbar(width);
    await import("./markdown-toolbar-controls");
    act(() => {
      setWysiwygEditor(attached);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "## Heading two\n" }, selection: { anchor: 14 } });
      attached.commands.setTextSelection(12);
      bumpEditorSelectionRevision();
    });
    const rendered = render(<MarkdownToolbar wysiwyg={mode === "visual"} mode={mode} onToggleWysiwyg={vi.fn()} onModeChange={vi.fn()} />);
    try {
      await act(async () => {
        await import("./markdown-toolbar-controls");
      });
      const editing = mode === "visual" ? attached.view : view;
      const focused = () => (mode === "visual" ? attached.view.hasFocus() : view.hasFocus);
      act(() => editing.focus());
      expect(focused()).toBe(true);
      if (width === 200) {
        fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
        fireEvent.click(screen.getByRole("menuitem", { name: toolbar.headingLevel }));
      } else {
        fireEvent.click(screen.getByRole("button", { name: toolbar.headingLevel }));
      }
      const menu = screen.getAllByRole("menu").at(-1) as HTMLElement;
      fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: new RegExp(en.headings.subsection, "u") }));
      await act(async () => {
        nextFrame();
        await new Promise((resolve) => setTimeout(resolve, 0));
        nextFrame();
      });
      if (mode === "visual") expect(attached.getHTML()).toContain("<h3>Heading two</h3>");
      else expect(view.state.doc.toString()).toBe("### Heading two\n");
      expect(document.activeElement?.closest("[role='menu'], [data-markdown-toolbar]") ?? null).toBeNull();
      expect(focused()).toBe(true);
    } finally {
      rendered.unmount();
      act(() => setWysiwygEditor(visual));
      attached.destroy();
      host.remove();
      Range.prototype.getClientRects = rects.list;
      Range.prototype.getBoundingClientRect = rects.box;
      vi.unstubAllGlobals();
    }
  });
});
