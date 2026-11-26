// @vitest-environment jsdom
import "@/i18n";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfMark, PdfTextRun, PdfTextSelectionInfo } from "@oleafly/preview";
import enAnnotations from "@/i18n/locales/en/annotations.json" with { type: "json" };
import type { PdfViewerHandle } from "@/components/pdf/PdfViewer";
import type { PdfAnnotation } from "@/lib/tauri";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { useFilesStore } from "@/store/files";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { useSettingsStore } from "@/store/settings";
import { PdfAnnotationsHost, usePdfAnnotations, type PdfAnnotationsView } from "./use-pdf-annotations";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  locateSource: vi.fn(),
  placeAnnotations: vi.fn(),
  handoffToAssistant: vi.fn(),
  ensureAiProviderOrOpenSettings: vi.fn(async () => true),
  gotoRect: vi.fn(),
  pdfPageText: vi.fn(async (): Promise<PdfTextRun[] | null> => null),
  sourceTexts: vi.fn((): Record<string, string> => ({})),
  sourceText: vi.fn((_path: string): string | null => null),
  sourceLineAt: vi.fn(),
  openFile: vi.fn(async (_path: string) => undefined),
  logWarning: vi.fn(async () => undefined),
  logError: vi.fn(async () => undefined),
  toastInfo: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  pdfAnnotationsList: mocks.list,
  pdfAnnotationsAdd: mocks.add,
  pdfAnnotationsUpdate: mocks.update,
  pdfAnnotationsDelete: mocks.remove,
}));
vi.mock("@/features/pdf-annotations/locate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/pdf-annotations/locate")>()),
  locateSource: mocks.locateSource,
}));
vi.mock("@/features/pdf-annotations/place", () => ({ placeAnnotations: mocks.placeAnnotations }));
vi.mock("@/features/synctex", () => ({
  sourceText: mocks.sourceText,
  sourceTexts: mocks.sourceTexts,
  sourceLineAt: mocks.sourceLineAt,
  compiledSourceText: () => null,
  typesetLinesOf: async () => null,
}));
vi.mock("@/features/assistant-handoff", () => ({
  handoffToAssistant: mocks.handoffToAssistant,
  ensureAiProviderOrOpenSettings: mocks.ensureAiProviderOrOpenSettings,
}));
vi.mock("@/components/pdf/pdfController", () => ({ gotoRect: mocks.gotoRect, pdfPageText: mocks.pdfPageText }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logWarning: mocks.logWarning,
  logError: mocks.logError,
}));
vi.mock("@/lib/toast", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/toast")>();
  return { ...original, toast: { ...original.toast, info: mocks.toastInfo }, notifyError: mocks.notifyError };
});

const PLACING = { timeout: 5_000 };
const strings = enAnnotations;

const selection: PdfTextSelectionInfo = {
  page: 3,
  rects: [{ page: 3, x: 10, y: 20, width: 100, height: 12 }],
  text: "a claim that needs a citation",
  before: "We make ",
  after: " here.",
  start: { page: 3, x: 11, y: 26 },
  end: { page: 3, x: 109, y: 26 },
  clientRect: { left: 40, top: 60, width: 100, height: 12 },
};

const source = { path: "main.tex", startLine: 4, endLine: 4, excerpt: "We make a claim that needs a citation here." };

function note(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: "n1",
    number: 1,
    kind: "comment",
    comment: "Cite it",
    quote: { text: selection.text, before: selection.before, after: selection.after },
    page: 3,
    source,
    boxes: selection.rects,
    build: "build-1",
    origin: "pdf",
    status: "draft",
    placement: "placed",
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

let latest: ReturnType<typeof usePdfAnnotations> | null = null;

function Harness({
  build = "build-1",
  ready = true,
  annotate = true,
  comment = false,
}: Readonly<{ build?: string; ready?: boolean; annotate?: boolean; comment?: boolean }>) {
  const annotations = usePdfAnnotations({
    projectId: "project",
    annotate,
    comment,
    build,
    documentReady: ready,
    checkpoint: null,
    syncAvailable: true,
    pdfRef: { current: { gotoPage: vi.fn() } as unknown as PdfViewerHandle },
    containerRef: { current: document.body },
  });
  latest = annotations;
  return <div>{annotations.overlay}</div>;
}

async function mount(items: PdfAnnotation[] = []) {
  mocks.list.mockResolvedValue({ items, readOnly: false, setAside: false });
  const view = render(<Harness />);
  await waitFor(() => expect(usePdfAnnotationsStore.getState().loaded).toBe(true));
  await waitFor(() => expect(latest?.toolbar).not.toBeNull());
  return view;
}

function select() {
  act(() => latest?.viewerProps.onSelectText?.(selection));
}

beforeEach(() => {
  vi.clearAllMocks();
  latest = null;
  usePdfAnnotationsStore.setState({
    projectId: null,
    items: [],
    loaded: false,
    readOnly: false,
    setAside: false,
    activeId: null,
    error: null,
  });
  mocks.placeAnnotations.mockResolvedValue([]);
  mocks.locateSource.mockResolvedValue(source);
  mocks.pdfPageText.mockResolvedValue(null);
  mocks.sourceTexts.mockReturnValue({});
  mocks.sourceText.mockReturnValue(null);
  mocks.openFile.mockImplementation(async (path: string) => {
    useFilesStore.setState({ activePath: path });
  });
  useFilesStore.setState({ projectId: "project", activePath: "notes.md", openFile: mocks.openFile });
  useCommentsRail.setState({ visible: true, canCompose: true, request: null });
  useSettingsStore.setState({ railTab: "files", showTree: false });
  mocks.update.mockImplementation(async () => usePdfAnnotationsStore.getState().items);
});

describe("usePdfAnnotations", () => {
  it("saves a comment right away with the quote and its context, then finds the source", async () => {
    await mount();
    select();
    mocks.add.mockResolvedValue(note({ source: null }));
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.action.comment }));
    await userEvent.type(screen.getByRole("textbox"), "Cite it");
    await userEvent.click(screen.getByRole("button", { name: strings.composer.save }));
    expect(mocks.add).toHaveBeenCalledWith("project", {
      kind: "comment",
      comment: "Cite it",
      quote: { text: selection.text, before: selection.before, after: selection.after },
      page: 3,
      source: null,
      boxes: selection.rects,
      build: "build-1",
      origin: "pdf",
    });
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("project", [{ id: "n1", source }]));
  });

  it("saves a region with the text inside it and finds its source by that text when SyncTeX can't", async () => {
    await mount();
    mocks.pdfPageText.mockResolvedValue([
      { str: "Highlighted code", x: 72, top: 100, width: 160, height: 14 },
      { str: "def greet(name):", x: 80, top: 130, width: 160, height: 10 },
      { str: "Next section", x: 72, top: 180, width: 120, height: 14 },
    ]);
    mocks.locateSource.mockResolvedValue(null);
    mocks.sourceTexts.mockReturnValue({ "main.tex": "\\section*{Highlighted code}\ndef greet(name):\n" });
    mocks.add.mockResolvedValue(note({ kind: "region", source: null }));
    act(() =>
      latest?.viewerProps.onSelectRegion?.({
        page: 3,
        rect: { page: 3, x: 75, y: 125, width: 200, height: 20 },
        clientRect: { left: 75, top: 125, width: 200, height: 20 },
      }),
    );
    await userEvent.type(await screen.findByRole("textbox"), "What is this?");
    await userEvent.click(screen.getByRole("button", { name: strings.composer.save }));
    await waitFor(() =>
      expect(mocks.add).toHaveBeenCalledWith(
        "project",
        expect.objectContaining({
          kind: "region",
          comment: "What is this?",
          quote: { text: "def greet(name):", before: "Highlighted code", after: "Next section" },
        }),
      ),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("project", [
        { id: "n1", source: { path: "main.tex", startLine: 2, endLine: 2, excerpt: "def greet(name):" } },
      ]),
    );
  });

  it("adds a delete note straight from the action", async () => {
    await mount();
    select();
    mocks.add.mockResolvedValue(note({ kind: "delete", comment: "" }));
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.action.delete }));
    expect(mocks.add).toHaveBeenCalledWith("project", expect.objectContaining({ kind: "delete", comment: "" }));
  });

  it("draws only notes placed on the PDF on screen", async () => {
    await mount([
      note(),
      note({ id: "n2", number: 2, build: "old" }),
      note({ id: "n3", number: 3, placement: "needsPlacing" }),
    ]);
    const marks = latest?.viewerProps.marks as readonly PdfMark[];
    expect(marks.map((mark) => mark.id)).toEqual(["n1"]);
  });

  it("hides the notes on the PDF until they are shown again", async () => {
    await mount([note()]);
    expect(latest?.toolbar?.marksShown).toBe(true);
    act(() => latest?.toolbar?.toggleMarks());
    expect(latest?.toolbar?.marksShown).toBe(false);
    expect(latest?.viewerProps.marks).toEqual([]);
    act(() => latest?.toolbar?.toggleMarks());
    expect((latest?.viewerProps.marks ?? []).map((mark) => mark.id)).toEqual(["n1"]);
  });

  it("places notes from an earlier PDF again when a new one loads", async () => {
    const view = await mount([note({ build: "old" })]);
    await waitFor(
      () => expect(mocks.placeAnnotations).toHaveBeenCalledWith([note({ build: "old" })], "build-1", expect.anything()),
      PLACING,
    );
    mocks.placeAnnotations.mockResolvedValue([{ id: "n1", build: "build-2", boxes: [], placement: "needsPlacing" }]);
    view.rerender(<Harness build="build-2" />);
    await waitFor(
      () =>
        expect(mocks.update).toHaveBeenCalledWith("project", [
          { id: "n1", build: "build-2", boxes: [], placement: "needsPlacing" },
        ]),
      PLACING,
    );
  });

  it("waits for the new PDF to load before placing notes again", async () => {
    mocks.list.mockResolvedValue({ items: [note({ build: "old" })], readOnly: false, setAside: false });
    const view = render(<Harness ready={false} />);
    await waitFor(() => expect(usePdfAnnotationsStore.getState().loaded).toBe(true));
    expect(mocks.placeAnnotations).not.toHaveBeenCalled();
    view.rerender(<Harness ready />);
    await waitFor(() => expect(mocks.placeAnnotations).toHaveBeenCalledTimes(1), PLACING);
  });

  it("places a lost note again on a new selection", async () => {
    await mount([note({ placement: "needsPlacing", boxes: [], build: "old" })]);
    act(() => latest?.toolbar?.togglePanel());
    await userEvent.click(await screen.findByRole("button", { name: strings.panel.placeAgain }));
    select();
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.placeHere }));
    expect(mocks.update).toHaveBeenCalledWith("project", [
      {
        id: "n1",
        quote: { text: selection.text, before: selection.before, after: selection.after },
        page: 3,
        boxes: selection.rects,
        build: "build-1",
        placement: "placed",
        source: null,
      },
    ]);
  });

  it("keeps a comment you are writing when a new PDF arrives", async () => {
    const view = await mount();
    select();
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.action.comment }));
    await userEvent.type(screen.getByRole("textbox"), "Half a thought");
    view.rerender(<Harness build="build-2" />);
    expect(screen.getByRole("textbox")).toHaveValue("Half a thought");
  });

  it("keeps the comment and says so when it can't be saved", async () => {
    await mount();
    select();
    mocks.add.mockRejectedValue(new Error("disk full"));
    await userEvent.click(await screen.findByRole("button", { name: strings.composer.action.comment }));
    await userEvent.type(screen.getByRole("textbox"), "Cite it");
    await userEvent.click(screen.getByRole("button", { name: strings.composer.save }));
    await waitFor(() => expect(screen.getAllByText(/disk full/).length).toBeGreaterThan(0));
    expect(screen.getByRole("textbox")).toHaveValue("Cite it");
  });

  it("sends the picked notes to the assistant as context chips", async () => {
    await mount([note(), note({ id: "n2", number: 2, status: "resolved" })]);
    act(() => latest?.toolbar?.togglePanel());
    await userEvent.click(await screen.findByRole("button", { name: strings.panel.send.replace("{{n}}", "1") }));
    expect(mocks.handoffToAssistant).toHaveBeenCalledWith("", {
      autoSend: false,
      context: [{ id: "pdfAnnotation:n1", kind: "pdfAnnotation", refId: "n1", label: "1 · main.tex:4" }],
    });
  });
});

describe("commenting for coauthors from a PDF selection", () => {
  const paper = [
    String.raw`\documentclass{article}`,
    String.raw`\begin{document}`,
    "Intro.",
    "We make a claim that needs a citation here.",
    String.raw`\end{document}`,
  ].join("\n");
  const coauthors = strings.composer.coauthors;

  function sourceFound() {
    mocks.sourceLineAt.mockResolvedValue({ path: "main.tex", line: 4, column: null });
    mocks.sourceText.mockImplementation((path: string) => (path === "main.tex" ? paper : null));
  }

  async function mountOnly(props: { annotate?: boolean; comment?: boolean } = {}) {
    mocks.list.mockResolvedValue({ items: [], readOnly: false, setAside: false });
    render(<Harness annotate={props.annotate ?? false} comment={props.comment ?? true} />);
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("offers only the coauthor comment while annotations are off, with no notes, toolbar or panel", async () => {
    await mountOnly();
    select();
    expect(await screen.findByRole("button", { name: coauthors })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.composer.action.comment })).toBeNull();
    expect(screen.queryByRole("button", { name: strings.composer.action.delete })).toBeNull();
    expect(latest?.toolbar).toBeNull();
    expect(latest?.viewerProps.marks).toEqual([]);
    expect(latest?.viewerProps.regionSelect).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: strings.panel.title })).toBeNull();
  });

  it("offers both while annotations are on, and no coauthor comment when comments aren't open", async () => {
    await mount();
    select();
    expect(await screen.findByRole("button", { name: strings.composer.action.comment })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: coauthors })).toBeNull();
    cleanup();
    await mountOnly({ annotate: true, comment: true });
    select();
    expect(await screen.findByRole("button", { name: coauthors })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.composer.action.comment })).toBeInTheDocument();
  });

  it("maps the selection to its source words and opens the comment composer on them in that file", async () => {
    sourceFound();
    await mountOnly();
    select();
    await userEvent.click(await screen.findByRole("button", { name: coauthors }));
    const from = paper.indexOf("a claim");
    await waitFor(() =>
      expect(useCommentsRail.getState().request).toEqual({
        path: "main.tex",
        from,
        to: from + "a claim that needs a citation".length,
        quote: "a claim that needs a citation",
      }),
    );
    expect(mocks.sourceLineAt).toHaveBeenCalledWith(3, 11, 26, null);
    expect(mocks.openFile).toHaveBeenCalledWith("main.tex");
    expect(useSettingsStore.getState()).toMatchObject({ railTab: "comments", showTree: true });
    expect(screen.queryByRole("button", { name: coauthors })).toBeNull();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("says so and keeps the selection when the passage isn't in the source", async () => {
    mocks.sourceLineAt.mockResolvedValue(null);
    await mountOnly();
    select();
    await userEvent.click(await screen.findByRole("button", { name: coauthors }));
    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith(strings.composer.noSource));
    expect(mocks.logWarning).toHaveBeenCalledWith("comment on a PDF selection", expect.stringContaining("page 3"));
    expect(useCommentsRail.getState().request).toBeNull();
    expect(mocks.openFile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: coauthors })).toBeEnabled();
  });

  it("treats a mapping that breaks like one that finds nothing, and logs why", async () => {
    mocks.sourceLineAt.mockRejectedValue(new Error("synctex crashed"));
    await mountOnly();
    select();
    await userEvent.click(await screen.findByRole("button", { name: coauthors }));
    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith(strings.composer.noSource));
    expect(mocks.logError).toHaveBeenCalledWith("comment on a PDF selection", expect.any(Error));
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports a file that couldn't be opened", async () => {
    sourceFound();
    const failure = new Error("locked");
    mocks.openFile.mockRejectedValueOnce(failure);
    await mountOnly();
    select();
    await userEvent.click(await screen.findByRole("button", { name: coauthors }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith("comment on a PDF selection", failure, strings.composer.commentFailed),
    );
    expect(useCommentsRail.getState().request).toBeNull();
  });

  it("says so when comments closed while the file was opening", async () => {
    sourceFound();
    mocks.openFile.mockImplementationOnce(async (path: string) => {
      useCommentsRail.setState({ canCompose: false });
      useFilesStore.setState({ activePath: path });
    });
    await mountOnly();
    select();
    await userEvent.click(await screen.findByRole("button", { name: coauthors }));
    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith(strings.composer.commentsClosed));
    expect(mocks.logWarning).toHaveBeenCalledWith("comment on a PDF selection", expect.stringContaining("main.tex"));
    expect(useCommentsRail.getState().request).toBeNull();
  });
});

describe("PdfAnnotationsHost", () => {
  it("hands its viewer props and toolbar to the preview, draws its cards in the slot, and clears them when it goes", async () => {
    mocks.list.mockResolvedValue({ items: [note()], readOnly: false, setAside: false });
    const views: (PdfAnnotationsView | null)[] = [];
    const onView = vi.fn((view: PdfAnnotationsView | null) => void views.push(view));
    const slot = document.createElement("div");
    document.body.append(slot);
    const host = (
      <PdfAnnotationsHost
        projectId="project"
        annotate
        comment={false}
        build="build-1"
        documentReady
        checkpoint={null}
        syncAvailable
        pdfRef={{ current: null }}
        containerRef={{ current: document.body }}
        slot={slot}
        onView={onView}
      />
    );
    const view = render(host);
    await waitFor(() => expect(views.at(-1)?.toolbar?.count).toBe(1));
    const reported = onView.mock.calls.length;
    view.rerender(host);
    expect(onView).toHaveBeenCalledTimes(reported);

    act(() => views.at(-1)?.toolbar?.togglePanel());
    expect(await within(slot).findByText("Cite it")).toBeInTheDocument();

    view.unmount();
    expect(views.at(-1)).toBeNull();
    slot.remove();
  });
});
