// @vitest-environment jsdom

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { WYSIWYG_EXTENSIONS } from "@oleafly/wysiwyg";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import { shortcut } from "@/lib/utils";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";
import { useFolderAccessStore } from "@/store/folder-access";
import { useHomeViewStore } from "@/store/home-view";

const editorHistory = vi.hoisted(() => ({ canUndo: true, canRedo: true }));
vi.mock("@/components/editor/history-signal", () => ({ useEditorHistory: () => editorHistory }));
const history = vi.hoisted(() => ({ editorRedo: vi.fn(), editorUndo: vi.fn() }));

vi.mock("@oleafly/preview", () => ({
  registerPdfView: vi.fn(),
  clearPdfView: vi.fn(),
  gotoRect: vi.fn(),
  pageClickToBp: vi.fn(),
  setPdfLogger: vi.fn(),
}));

vi.mock("@/components/editor/project-info-data", () => ({
  collectProjectInfo: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/editor/cm/controller")>()),
  ...history,
}));

import { MARKDOWN_HEADING_LEVELS } from "@/components/editor/markdown-commands";
import { setEditorView } from "@/components/editor/cm/controller";
import { cursorSignalExtension } from "@/components/editor/cm/cursor-signal";
import { setWysiwygEditor } from "@/components/editor/wysiwyg/controller";
import { MarkdownToolbar } from "./MarkdownToolbar";

const toolbar = en.toolbar;
const withShortcut = (template: string, keys: string) => template.replace("{{shortcut}}", shortcut(keys));

function widenToolbar(width: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    value: width,
  });
}

async function renderBar(props: ComponentProps<typeof MarkdownToolbar>) {
  const rendered = render(<MarkdownToolbar {...props} />);
  await act(async () => {
    await import("./markdown-toolbar-controls");
  });
  return rendered;
}

function popoverField(label: string): HTMLInputElement {
  return screen.getAllByLabelText(label).find((node) => node.tagName === "INPUT") as HTMLInputElement;
}

describe("MarkdownToolbar", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    widenToolbar(0);
    view = new EditorView({ state: EditorState.create({ doc: "Hello world\n", selection: { anchor: 6, head: 11 } }), parent: document.body });
    act(() => setEditorView(view));
  });

  afterEach(() => {
    act(() => setEditorView(null));
    view.destroy();
    widenToolbar(0);
  });

  it("formats the code with the bar's buttons and keeps undo and redo", async () => {
    widenToolbar(2000);
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });

    expect(screen.getByLabelText(toolbar.switchToSource)).toHaveTextContent(toolbar.code);
    expect(screen.getByLabelText(toolbar.switchToVisual)).toHaveTextContent(toolbar.visual);
    expect(screen.queryByLabelText(toolbar.moreOptions)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.boldWithShortcut, "⌘B")));
    expect(view.state.doc.toString()).toBe("Hello **world**\n");
    fireEvent.click(screen.getByLabelText(toolbar.underline));
    expect(view.state.doc.toString()).toBe("Hello **<u>world</u>**\n");
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.undo, "⌘Z")));
    fireEvent.click(screen.getByLabelText(withShortcut(toolbar.redo, "⌘⇧Z")));
    expect(history.editorUndo).toHaveBeenCalledOnce();
    expect(history.editorRedo).toHaveBeenCalledOnce();
  });

  it.each([false, true])("opens the Mermaid diagram composer without asking (visual mode %s)", async (wysiwyg) => {
    widenToolbar(2000);
    useHomeViewStore.setState({ page: "library", queuedPageAfterProjectClose: null });
    useDiagramComposerStore.setState({ language: "tikz", requestId: 0, chooserOpen: false });
    await renderBar({ wysiwyg, onToggleWysiwyg: vi.fn() });

    fireEvent.click(screen.getByLabelText(toolbar.drawDiagram));

    await vi.waitFor(() => expect(useHomeViewStore.getState().page).toBe("diagram-composer"));
    expect(useDiagramComposerStore.getState()).toMatchObject({ language: "mermaid", requestId: 1, chooserOpen: false });
  });

  it("offers every heading level from the folded heading menu and writes the level", async () => {
    widenToolbar(420);
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });

    fireEvent.click(screen.getByLabelText(toolbar.headingLevel));
    for (const level of MARKDOWN_HEADING_LEVELS) {
      expect(screen.getByText(level.hLabel)).toBeInTheDocument();
      expect(screen.getByText(level.label())).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText(MARKDOWN_HEADING_LEVELS[2].label()));

    expect(view.state.doc.toString()).toBe("### Hello world\n");
  });

  it("drops the last file's heading tint as soon as another file opens after a slow read", async () => {
    widenToolbar(2000);
    const path = useFilesStore.getState().activePath;
    const signalled = new EditorView({ state: EditorState.create({ doc: "## Head\n\nPara.\n", selection: { anchor: 12 }, extensions: [cursorSignalExtension()] }) });
    let now = 0;
    let step = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => (now += step));
    act(() => setEditorView(signalled));
    useFilesStore.setState({ activePath: "a.md" });
    try {
      await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });
      const h2 = () => screen.getByRole("button", { name: MARKDOWN_HEADING_LEVELS[1].label() });
      expect(h2()).toHaveAttribute("aria-pressed", "false");

      step = 50;
      act(() => signalled.dispatch({ selection: { anchor: 4 } }));
      step = 0;
      expect(h2()).toHaveAttribute("aria-pressed", "true");

      act(() => {
        useFilesStore.setState({ activePath: "b.md" });
        signalled.dispatch({ changes: { from: 0, to: signalled.state.doc.length, insert: "Plain text\n" }, selection: { anchor: 0 } });
      });
      expect(h2()).toHaveAttribute("aria-pressed", "false");
    } finally {
      clock.mockRestore();
      useFilesStore.setState({ activePath: path });
      act(() => setEditorView(view));
      signalled.destroy();
    }
  });

  const SETUPS = [
    ["a plain file", { showProjectInfo: true, project: false, lastOneRow: 552 }],
    ["a file without Project info", { showProjectInfo: false, project: false, lastOneRow: 520 }],
    ["a Markdown project", { showProjectInfo: true, project: true, lastOneRow: 552 }],
    ["a Markdown project without Project info", { showProjectInfo: false, project: true, lastOneRow: 520 }],
  ] as const;

  function paneModel(setup: (typeof SETUPS)[number][1]) {
    const BASIS: Record<string, number> = { "basis-90": 360, "basis-82": 328, "basis-0": 0 };
    const prototype = HTMLElement.prototype;
    const saved = {
      clientWidth: Object.getOwnPropertyDescriptor(prototype, "clientWidth"),
      offsetTop: Object.getOwnPropertyDescriptor(prototype, "offsetTop"),
      rect: Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect"),
    };
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Element) {
        const width = this.matches("[data-tour='wysiwyg-toggle']") ? 172 : this.matches("span.w-px") ? 9 : 0;
        return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: width, width, height: 0, toJSON: () => ({}) } as DOMRect;
      },
    });
    const files = useFilesStore.getState();
    const model = { pane: 0 };
    const group = () => (document.querySelector("[data-markdown-toolbar]") as HTMLElement).children[1] as HTMLElement;
    const ownRow = () => {
      const basis = [...group().classList].map((name) => BASIS[name]).find((width) => width !== undefined) ?? model.pane;
      return 8 + 172 + 2 + basis + 8 > model.pane;
    };
    const cluster = (setup.project ? 60 : 0) + (setup.showProjectInfo ? 0 : -30);
    Object.defineProperty(prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.matches("[data-markdown-toolbar] fieldset > div")) return 0;
        return Math.max(0, ownRow() ? model.pane - 117 - cluster : model.pane - 302 - cluster);
      },
    });
    Object.defineProperty(prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        return this === group() && ownRow() ? 36 : 0;
      },
    });
    const observers = new Set<ResizeObserverCallback>();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          observers.add(this.callback);
        }
        disconnect() {
          observers.delete(this.callback);
        }
      },
    );
    const markdown = { ...LATEX_ENGINE, id: "markdown", source_format: "markdown" } as unknown as DocumentEngineDescriptor;
    if (setup.project) useFilesStore.setState({ engineLoaded: true, engine: markdown });
    return {
      model,
      ownRow,
      leadsWithDivider: () => group().firstElementChild?.classList.contains("w-px") ?? false,
      notify: () => {
        for (const callback of [...observers]) callback([], {} as ResizeObserver);
      },
      settle: async () => {
        for (let round = 0; round < 4; round++) {
          await act(async () => {
            for (const callback of [...observers]) callback([], {} as ResizeObserver);
          });
        }
      },
      restore: () => {
        for (const [name, descriptor] of [["clientWidth", saved.clientWidth], ["offsetTop", saved.offsetTop]] as const) {
          if (descriptor) Object.defineProperty(prototype, name, descriptor);
        }
        if (saved.rect) Object.defineProperty(Element.prototype, "getBoundingClientRect", saved.rect);
        useFilesStore.setState({ engineLoaded: files.engineLoaded, engine: files.engine });
        vi.unstubAllGlobals();
      },
    };
  }

  function shownTools(): string[] {
    const folded = MARKDOWN_HEADING_LEVELS[0].label();
    return [...document.querySelectorAll("[data-markdown-toolbar] fieldset button")]
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => label !== toolbar.moreOptions)
      .map((label) => (label === toolbar.headingLevel ? folded : label));
  }

  it.each(SETUPS)("keeps the formatting beside the mode switch down to where it wrapped before, for %s", async (_, setup) => {
    const pane = paneModel(setup);
    const rowsAt = async (width: number) => {
      pane.model.pane = width;
      const { unmount } = await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn(), showProjectInfo: setup.showProjectInfo });
      await pane.settle();
      const leadsWithDivider = pane.leadsWithDivider();
      const rows = pane.ownRow() ? 2 : 1;
      unmount();
      expect(leadsWithDivider).toBe(rows === 1);
      return rows;
    };
    try {
      for (const width of [1400, 1000, 760, 640, setup.lastOneRow]) expect(await rowsAt(width)).toBe(1);
      for (const width of [setup.lastOneRow - 4, 420, 300]) expect(await rowsAt(width)).toBe(2);
    } finally {
      pane.restore();
    }
  });

  it.each(SETUPS)("shows at every wider one-row width each tool a narrower one shows, for %s", async (_, setup) => {
    const pane = paneModel(setup);
    try {
      pane.model.pane = setup.lastOneRow;
      const { unmount } = await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn(), showProjectInfo: setup.showProjectInfo });
      const bands: { from: number; tools: string[] }[] = [];
      for (let width = setup.lastOneRow; width <= 1400; width += 2) {
        pane.model.pane = width;
        act(() => pane.notify());
        expect(pane.ownRow()).toBe(false);
        const tools = shownTools();
        if (bands.at(-1)?.tools.join(" ") !== tools.join(" ")) bands.push({ from: width, tools });
      }
      unmount();
      const lost: string[] = [];
      for (let narrow = 0; narrow < bands.length; narrow++) {
        for (const wide of bands.slice(narrow + 1)) {
          const gone = bands[narrow].tools.filter((tool) => !wide.tools.includes(tool));
          if (gone.length > 0) lost.push(`${bands[narrow].from} -> ${wide.from} px: ${gone.join(", ")}`);
        }
      }
      expect(lost).toEqual([]);
      expect(bands.at(-1)?.tools).toHaveLength(29);
    } finally {
      pane.restore();
    }
  }, 60_000);

  it.each([
    [560, 545],
    [553, 549],
    [550, 549],
    [545, 560],
    [549, 553],
    [549, 550],
  ])("draws the settled bar in the same frame as the resize from %i to %i px, across the switch", async (from, to) => {
    const pane = paneModel(SETUPS[0][1]);
    try {
      pane.model.pane = from;
      const { unmount } = await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });
      await pane.settle();
      let frame = { leadsWithDivider: false, tools: [] as string[] };
      await act(async () => {
        pane.model.pane = to;
        pane.notify();
        pane.notify();
        frame = { leadsWithDivider: pane.leadsWithDivider(), tools: shownTools() };
      });
      await pane.settle();
      const settled = { leadsWithDivider: pane.leadsWithDivider(), tools: shownTools() };
      const rows = pane.ownRow() ? 2 : 1;
      unmount();
      expect(rows).toBe(to < from ? 2 : 1);
      expect(settled.leadsWithDivider).toBe(rows === 1);
      expect(frame).toEqual(settled);
    } finally {
      pane.restore();
    }
  });

  it("shows as many tools as fit before More at 420 px, with the headings folded", async () => {
    widenToolbar(420 - 117);
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });
    const shown = screen
      .getAllByRole("button")
      .filter((button) => button.closest("fieldset") && button.getAttribute("aria-label") !== toolbar.moreOptions)
      .map((button) => button.getAttribute("aria-label"));
    expect(shown).toHaveLength(8);
    expect(screen.getByRole("button", { name: toolbar.moreOptions })).toBeInTheDocument();
  });

  it("moves every control into the overflow menu when the bar has no room", async () => {
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    for (const label of [
      toolbar.blockquote,
      toolbar.italic,
      toolbar.strikethrough,
      toolbar.inlineCode,
      toolbar.underline,
      toolbar.highlight,
      toolbar.superscript,
      toolbar.subscript,
      toolbar.bulletedList,
      toolbar.numberedList,
      toolbar.drawDiagram,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByText(toolbar.bold));
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getByText(toolbar.insertTable));

    expect(view.state.doc.toString()).toBe("Hello **world**\n\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n");
  });

  it("links the selection from the link popover and removes it again, in Code mode", async () => {
    widenToolbar(2000);
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });

    fireEvent.click(screen.getByLabelText(toolbar.linkUrl));
    const field = popoverField(toolbar.linkUrl);
    expect(field).toHaveAttribute("placeholder", toolbar.linkPlaceholder);
    fireEvent.change(field, { target: { value: "https://example.org" } });
    fireEvent.click(screen.getByText(toolbar.apply));
    expect(view.state.doc.toString()).toBe("Hello [world](https://example.org)\n");

    act(() => view.dispatch({ selection: { anchor: 9 } }));
    fireEvent.click(screen.getByLabelText(toolbar.linkUrl));
    expect(popoverField(toolbar.linkUrl)).toHaveValue("https://example.org");
    fireEvent.click(screen.getByText(toolbar.removeLink));
    expect(view.state.doc.toString()).toBe("Hello world\n");
  });

  it("inserts an image from the image popover, also as a row of the overflow menu", async () => {
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });
    act(() => view.dispatch({ selection: { anchor: 11 } }));

    fireEvent.click(screen.getByLabelText(toolbar.moreOptions));
    fireEvent.click(screen.getAllByLabelText(toolbar.imageFile)[0]);
    const field = popoverField(toolbar.imageFile);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", toolbar.imagePlaceholder);
    fireEvent.change(field, { target: { value: "figures/scan.png" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);

    expect(view.state.doc.toString()).toBe("Hello world\n\n![](figures/scan.png)\n");
  });

  it.each([false, true])("disables every formatting button in a read-only folder (visual %s)", async (wysiwyg) => {
    widenToolbar(2000);
    useFilesStore.setState({ projectId: "p1" });
    useFolderAccessStore.setState({ projectId: "p1", status: { read_only: true } as never });
    try {
      await renderBar({ wysiwyg, onToggleWysiwyg: vi.fn() });
      expect(screen.getByLabelText(withShortcut(toolbar.boldWithShortcut, "⌘B"))).toBeDisabled();
      expect(screen.getByLabelText(toolbar.insertTable)).toBeDisabled();
      expect(screen.getByLabelText(toolbar.linkUrl)).toBeDisabled();
      expect(screen.getByLabelText(toolbar.switchToVisual)).not.toBeDisabled();
    } finally {
      useFolderAccessStore.setState({ projectId: null, status: null });
      useFilesStore.setState({ projectId: null });
    }
  });

  async function renderShared(wysiwyg: boolean) {
    widenToolbar(2000);
    useFilesStore.setState({ projectId: "p1" });
    useCollabEditorGate.setState({ projectId: "p1", viewer: false, locked: false });
    await renderBar({ wysiwyg, onToggleWysiwyg: vi.fn() });
    return {
      bold: screen.getByLabelText(withShortcut(toolbar.boldWithShortcut, "⌘B")),
      table: screen.getByLabelText(toolbar.insertTable),
    };
  }

  function leaveShared() {
    useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false });
    useFilesStore.setState({ projectId: null });
  }

  it("keeps formatting enabled in Code mode in a shared project an editor can write to", async () => {
    try {
      const { bold, table } = await renderShared(false);
      expect(bold).not.toBeDisabled();
      expect(table).not.toBeDisabled();
    } finally {
      leaveShared();
    }
  });

  it("disables formatting in Visual mode in a shared project, where Visual is read-only", async () => {
    try {
      const { bold, table } = await renderShared(true);
      expect(bold).toBeDisabled();
      expect(table).toBeDisabled();
    } finally {
      leaveShared();
    }
  });

  it("keeps the mode switch when project statistics are hidden", async () => {
    widenToolbar(2000);
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn(), showProjectInfo: false });

    expect(screen.getByLabelText(toolbar.switchToSource)).toBeInTheDocument();
    expect(screen.queryByLabelText(en.projectInfo.trigger)).not.toBeInTheDocument();
  });

  it("leaves out the mode switch for a file with no visual editor", async () => {
    widenToolbar(2000);
    await renderBar({ wysiwyg: false });

    expect(screen.queryByLabelText(toolbar.switchToSource)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(toolbar.switchToVisual)).not.toBeInTheDocument();
    expect(screen.getByLabelText(toolbar.underline)).toBeInTheDocument();
  });

  it("offers insights but not Pandoc document settings in a Quarto project", async () => {
    widenToolbar(2000);
    const files = useFilesStore.getState();
    const markdown = (id: string): DocumentEngineDescriptor =>
      ({ ...LATEX_ENGINE, id, source_format: "markdown" }) as unknown as DocumentEngineDescriptor;
    try {
      useFilesStore.setState({ engineLoaded: true, engine: markdown("quarto") });
      const { unmount } = await renderBar({ wysiwyg: false });
      expect(screen.getByTestId("document-insights-button")).toBeInTheDocument();
      expect(screen.queryByTestId("document-settings-button")).not.toBeInTheDocument();
      unmount();

      useFilesStore.setState({ engine: markdown("markdown") });
      await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn() });
      expect(screen.getByTestId("document-settings-button")).toBeInTheDocument();
    } finally {
      useFilesStore.setState({ engineLoaded: files.engineLoaded, engine: files.engine });
    }
  });

  it("toggles visual mode from the switch", async () => {
    widenToolbar(2000);
    const onToggleWysiwyg = vi.fn();
    await renderBar({ wysiwyg: false, onToggleWysiwyg });

    fireEvent.click(screen.getByLabelText(toolbar.switchToVisual));

    expect(onToggleWysiwyg).toHaveBeenCalledOnce();
  });

  it("opens Both without changing modes and applies the selected arrangement", async () => {
    const user = userEvent.setup();
    widenToolbar(2000);
    const onModeChange = vi.fn();
    const onToggleWysiwyg = vi.fn();
    await renderBar({ wysiwyg: false, onToggleWysiwyg, mode: "both", splitLayout: "split", onModeChange });

    const both = screen.getByRole("button", { name: toolbar.both });
    expect(both).toHaveAttribute("aria-pressed", "true");
    await user.click(both);
    expect(onModeChange).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitemradio", { name: toolbar.split })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: toolbar.stacked }));
    expect(onModeChange).toHaveBeenLastCalledWith("both", "stacked");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(both);
    await user.click(screen.getByRole("menuitemradio", { name: toolbar.split }));
    expect(onModeChange).toHaveBeenLastCalledWith("both", "split");
    fireEvent.click(screen.getByLabelText(toolbar.switchToSource));
    expect(onModeChange).toHaveBeenLastCalledWith("code");
    fireEvent.click(screen.getByLabelText(toolbar.switchToVisual));
    expect(onModeChange).toHaveBeenLastCalledWith("visual");
    expect(onToggleWysiwyg).not.toHaveBeenCalled();
  });

  it("keeps Code selected when the Both menu is dismissed", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    await renderBar({ wysiwyg: false, onToggleWysiwyg: vi.fn(), mode: "code", onModeChange });
    await user.click(screen.getByRole("button", { name: toolbar.both }));
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText(toolbar.switchToSource)).toHaveAttribute("aria-pressed", "true");
    expect(onModeChange).not.toHaveBeenCalled();
  });

  describe("with a visual editor open", () => {
    let editor: Editor;

    beforeEach(() => {
      editor = new Editor({
        element: document.createElement("div"),
        extensions: WYSIWYG_EXTENSIONS,
        content: '<p><strong>Bold</strong> text and a <a href="https://example.org">link</a></p>',
      });
      act(() => setWysiwygEditor(editor));
    });

    afterEach(() => {
      act(() => setWysiwygEditor(null));
      editor.destroy();
    });

    function align(): unknown {
      return editor.state.doc.firstChild?.attrs.textAlign;
    }

    it("puts the formatting on one row when it fits and aligns the paragraph from the bar", async () => {
      widenToolbar(2000);
      await renderBar({ wysiwyg: true, onToggleWysiwyg: vi.fn() });
      expect(screen.queryByRole("button", { name: toolbar.moreOptions })).toBeNull();
      expect(screen.getByRole("button", { name: en.headings.paragraphHeading })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: toolbar.headingLevel })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: toolbar.align.center }));
      expect(align()).toBe("center");
      expect(screen.getByRole("button", { name: toolbar.align.center })).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByRole("button", { name: toolbar.align.left }));
      expect(align()).toBeNull();
    });

    it("clears formatting and removes a link only when the cursor is on one", async () => {
      widenToolbar(2000);
      await renderBar({ wysiwyg: true, onToggleWysiwyg: vi.fn() });
      act(() => {
        editor.commands.setTextSelection(2);
      });
      expect(screen.getByRole("button", { name: toolbar.removeLink })).toBeDisabled();
      act(() => {
        editor.commands.setTextSelection({ from: 1, to: 5 });
      });
      fireEvent.click(screen.getByRole("button", { name: toolbar.clearFormatting }));
      expect(editor.isActive("bold")).toBe(false);
      act(() => {
        editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      });
      fireEvent.click(screen.getByRole("button", { name: toolbar.removeLink }));
      expect(editor.getHTML()).not.toContain("<a ");
    });

    it("seeds the link popover with the link under the cursor", async () => {
      widenToolbar(2000);
      await renderBar({ wysiwyg: true, onToggleWysiwyg: vi.fn() });
      act(() => {
        editor.commands.setTextSelection(editor.state.doc.content.size - 2);
      });
      fireEvent.click(screen.getByLabelText(toolbar.linkUrl));
      expect(popoverField(toolbar.linkUrl)).toHaveValue("https://example.org");
    });

    it("folds the headings into one menu, then into More, as the bar narrows", async () => {
      widenToolbar(420);
      await renderBar({ wysiwyg: true, onToggleWysiwyg: vi.fn() });
      expect(screen.queryByRole("button", { name: en.headings.paragraphHeading })).toBeNull();
      expect(screen.getByRole("button", { name: toolbar.headingLevel })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: toolbar.align.center })).toBeNull();
      expect(screen.getByRole("button", { name: toolbar.moreOptions })).toBeInTheDocument();
    });

    it("folds alignment and text colour into More when the bar is narrow", async () => {
      await renderBar({ wysiwyg: true, onToggleWysiwyg: vi.fn() });
      expect(screen.queryByRole("button", { name: toolbar.headingLevel })).toBeNull();
      act(() => {
        editor.commands.setTextSelection({ from: 1, to: 5 });
      });
      fireEvent.pointerDown(screen.getByRole("button", { name: toolbar.moreOptions }), { button: 0, ctrlKey: false });
      const more = screen.getAllByRole("menu").at(-1) as HTMLElement;
      fireEvent.keyDown(within(more).getByRole("menuitem", { name: toolbar.textColor }), { key: "ArrowRight" });
      fireEvent.click(within(screen.getAllByRole("menu").at(-1) as HTMLElement).getByRole("menuitemcheckbox", { name: toolbar.textColors.teal }));
      expect(editor.getAttributes("textColor").color).toBe("teal");
    });
  });
});
