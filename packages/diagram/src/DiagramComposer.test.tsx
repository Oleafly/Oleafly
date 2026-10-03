// @vitest-environment jsdom

import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramModel } from "@oleafly/latex";
import type { DiagramHost } from "./host";

const kit = vi.hoisted(() => {
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    keys: vi.fn(),
    successUnique: vi.fn(),
    errorUnique: vi.fn(),
  };
  toast.successUnique.mockImplementation((key: string, message: string) => {
    toast.keys(key);
    toast.success(message);
  });
  toast.errorUnique.mockImplementation((key: string, message: string) => {
    toast.keys(key);
    toast.error(message);
  });
  return { toast };
});

const canvas = vi.hoisted(() => ({
  props: {} as {
    model?: DiagramModel;
    onChange?: (model: DiagramModel) => void;
    showPreviewAction?: boolean;
    onShowPreview?: () => void;
  },
}));

const code = vi.hoisted(() => ({ inserted: [] as string[], revealed: [] as [number, number | null | undefined][] }));

vi.mock("./kit", () => ({
  useDiagramKit: () => ({
    Input: (props: Record<string, unknown>) => <input {...props} />,
    ColorPicker: ({
      ariaLabel,
      onChange,
    }: {
      ariaLabel: string;
      onChange: (value: string) => void;
    }) => (
      <button type="button" aria-label={ariaLabel} onClick={() => onChange("")}>
        {ariaLabel}
      </button>
    ),
    Button: ({
      children,
      onClick,
      disabled,
      ...rest
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => (
      <button type="button" onClick={onClick} disabled={disabled} {...rest}>
        {children}
      </button>
    ),
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    toast: kit.toast,
    useThemeMode: () => "light",
    usePrimaryColor: () => "#000000",
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${Object.values(params).join(" ")}` : key,
  }),
}));

vi.mock("./DiagramCanvas", () => ({
  DiagramCanvas: (props: typeof canvas.props) => {
    canvas.props = props;
    return <div data-testid="diagram-canvas" />;
  },
}));

vi.mock("./CmCodeEditor", () => ({
  CmCodeEditor: forwardRef<
    { insert: (text: string) => void; revealLine: (line: number, column?: number | null) => void },
    { value: string; onChange: (next: string) => void }
  >(function CmCodeEditor({ value, onChange }, ref) {
    useImperativeHandle(ref, () => ({
      insert: (text: string) => code.inserted.push(text),
      revealLine: (line: number, column?: number | null) => code.revealed.push([line, column]),
    }));
    return (
      <textarea
        data-testid="code-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }),
}));

import { DiagramComposer, safeName } from "./DiagramComposer";
import { modelToFletcher } from "./fletcher";
import { figureHash } from "./languages/mermaid-figure";

const PNG = "data:image/png;base64,AAAA";

function makeHost(overrides: Partial<DiagramHost> = {}): DiagramHost {
  return {
    compileIsolated: vi.fn(async () => ({ log: "ok", has_pdf: true })),
    readIsolatedPdf: vi.fn(async () => new ArrayBuffer(4)),
    pdfToPng: vi.fn(async () => PNG),
    listFiles: vi.fn(async () => []),
    writeFileContent: vi.fn(async () => undefined),
    writeProjectBytes: vi.fn(async () => undefined),
    insertAtCursor: vi.fn(),
    getMainDoc: vi.fn(() => "main.tex"),
    applyExternalWrite: vi.fn(),
    saveActive: vi.fn(async () => undefined),
    refreshTree: vi.fn(async () => undefined),
    createImageProject: vi.fn(async () => "new"),
    createDiagramProject: vi.fn(async () => "new"),
    refreshProjects: vi.fn(async () => undefined),
    findProjectIdByName: vi.fn(async () => null),
    listProjectNames: vi.fn(async () => [{ id: "other", name: "Other paper" }]),
    saveFigureToCache: vi.fn(async () => ({ hash: "h", alreadyCached: false })),
    saveBytesToDisk: vi.fn(async () => true),
    pickTikzFile: vi.fn(async () => null),
    ...overrides,
  };
}

function open(host: DiagramHost, extra: Record<string, unknown> = {}) {
  return render(
    <DiagramComposer
      open
      projectId="project"
      projectName="Paper"
      onClose={() => {}}
      host={host}
      {...extra}
    />,
  );
}

async function compileOnce(host: DiagramHost) {
  fireEvent.click(screen.getByTestId("diagram-compile"));
  await waitFor(() => expect(host.pdfToPng).toHaveBeenCalled());
}

async function openProjectPicker() {
  fireEvent.click(screen.getByLabelText("composer.save"));
  const row = await screen.findByTestId("diagram-save-to-project");
  fireEvent.mouseEnter(row.parentElement as HTMLElement);
}

describe("diagram file stem", () => {
  it.each([
    ["Figure 1", "Figure-1"],
    ["  spaced  name  ", "spaced-name"],
    ["---", ""],
    ["-lead", "lead"],
    ["trail-", "trail"],
    ["--both--", "both"],
    ["", ""],
    ["...", ""],
    ["a", "a"],
    ["flow: chart (v2)", "flow-chart-v2"],
    ["under_score-keep", "under_score-keep"],
  ])("reduces %j to %j", (input, expected) => {
    expect(safeName(input)).toBe(expected);
  });

  it("truncates to sixty-four characters after trimming", () => {
    expect(safeName(`-${"a".repeat(80)}-`)).toBe("a".repeat(64));
  });
});

describe("DiagramComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvas.props = {};
    code.inserted = [];
    code.revealed = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing while closed", () => {
    const { container } = render(
      <DiagramComposer open={false} projectId="project" onClose={() => {}} host={makeHost()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("names the composer chrome and the starter drawing", () => {
    open(makeHost());

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "composer.title");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Paper");
    expect(screen.getByLabelText("composer.backToProject")).toBeInTheDocument();
    expect(screen.getByLabelText("composer.importLabel")).toBeInTheDocument();
    expect(screen.getByLabelText("composer.save")).toBeInTheDocument();
    expect(screen.getByLabelText("composer.download")).toBeInTheDocument();
    expect(screen.getByText("composer.modeDraw")).toBeInTheDocument();
    expect(screen.getByText("composer.modeCode")).toBeInTheDocument();
    expect(screen.getByText("composer.compile")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("diagram.tikz");
  });

  it("closes on Escape and from the back button", () => {
    const onClose = vi.fn();
    render(
      <DiagramComposer open projectId="project" onClose={onClose} host={makeHost()} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("composer.backToProject"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("compiles the drawing and shows the preview", async () => {
    const host = makeHost();
    open(host);

    await compileOnce(host);

    expect(screen.getByText("preview.label")).toBeInTheDocument();
    expect(screen.getByAltText("preview.alt")).toHaveAttribute("src", PNG);
    expect(screen.getByText("preview.pngScale")).toBeInTheDocument();
    expect(screen.getByText("preview.scaleFactor 1")).toBeInTheDocument();
    expect(screen.getByText("composer.recompile")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("preview.minimize"));
    expect(screen.queryByAltText("preview.alt")).not.toBeInTheDocument();
  });

  it("shows a compile that produced no document in the preview pane, not a toast", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "! Undefined control sequence", has_pdf: false })),
      fixWithAi: vi.fn(async () => "fixed"),
    });
    open(host);

    fireEvent.click(screen.getByTestId("diagram-compile"));
    await waitFor(() =>
      expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.compileFailed"),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("toast.compileFailed");
    expect(screen.getByText("! Undefined control sequence")).toBeInTheDocument();
    expect(screen.getByText("composer.fixWithAi")).toBeInTheDocument();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("shows a failed compile with an empty log instead of the empty placeholder", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "", has_pdf: false })),
    });
    open(host);

    fireEvent.click(screen.getByTestId("diagram-compile"));
    await waitFor(() =>
      expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.compileFailed"),
    );
    expect(screen.queryByText("preview.empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("preview.minimize"));
    expect(canvas.props.showPreviewAction).toBe(true);
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("shows a compile that threw in the preview pane without offering an AI fix", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => {
        throw new Error("boom");
      }),
      fixWithAi: vi.fn(async () => "fixed"),
    });
    open(host);
    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() =>
      expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.compileError boom"),
    );
    expect(screen.queryByText("preview.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("composer.fixWithAi")).not.toBeInTheDocument();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("keeps the last preview and names the failure when a recompile throws", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    (host.compileIsolated as ReturnType<typeof vi.fn>).mockRejectedValue(
      "engine `x` does not support isolated compilation",
    );
    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() =>
      expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent(
        "toast.compileError engine `x` does not support isolated compilation",
      ),
    );
    expect(screen.getByAltText("preview.alt")).toBeInTheDocument();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("clears the failure notice once a compile succeeds", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "! error", has_pdf: false })),
    });
    open(host);
    fireEvent.click(screen.getByTestId("diagram-compile"));
    await screen.findByTestId("diagram-compile-failure");

    (host.compileIsolated as ReturnType<typeof vi.fn>).mockResolvedValue({ log: "ok", has_pdf: true });
    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() => expect(screen.getByAltText("preview.alt")).toBeInTheDocument());
    expect(screen.queryByTestId("diagram-compile-failure")).not.toBeInTheDocument();
  });

  it("shows the compile result of the forced tour preview without a toast", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "! error", has_pdf: false })),
    });
    open(host, { forcePreviewOpen: true });

    await waitFor(() =>
      expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.compileFailed"),
    );
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("asks for a compile before saving or downloading", async () => {
    const host = makeHost();
    open(host);

    fireEvent.click(screen.getByLabelText("composer.save"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.compileBeforeSave"),
    );
    expect(host.listProjectNames).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("composer.download"));
    fireEvent.click(screen.getByText("composer.formatPng"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.compileBeforeDownload"),
    );
  });

  it("saves the figure into another project and as a new project", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    await openProjectPicker();

    fireEvent.click(screen.getByText("Other paper"));
    await waitFor(() =>
      expect(kit.toast.success).toHaveBeenCalledWith(
        "toast.savedToProject figures/diagram.png",
      ),
    );
    expect(host.writeProjectBytes).toHaveBeenCalledWith(
      "other",
      "figures/diagram.png",
      "AAAA",
    );
    expect(host.writeFileContent).toHaveBeenCalledWith(
      "other",
      "figures/diagram.tikz",
      expect.any(String),
    );

    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));
    await waitFor(() =>
      expect(kit.toast.success).toHaveBeenCalledWith("toast.savedAsProject"),
    );
    expect(kit.toast.keys).toHaveBeenCalledTimes(2);
    expect(kit.toast.keys.mock.calls[1][0]).toBe(kit.toast.keys.mock.calls[0][0]);
  });

  it("reports a failed save to a project and a failed save as a project", async () => {
    const host = makeHost({
      writeProjectBytes: vi.fn(async () => {
        throw new Error("disk full");
      }),
      createDiagramProject: vi.fn(async () => {
        throw new Error("no room");
      }),
    });
    open(host);
    await compileOnce(host);

    await openProjectPicker();
    fireEvent.click(screen.getByText("Other paper"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveFailed disk full"),
    );

    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveAsProjectFailed no room"),
    );
    expect(kit.toast.success).not.toHaveBeenCalled();
  });

  it("reports a save as saved when only the refresh afterwards fails", async () => {
    const host = makeHost({
      refreshTree: vi.fn(async () => {
        throw new Error("tree offline");
      }),
      refreshProjects: vi.fn(async () => {
        throw new Error("list offline");
      }),
    });
    open(host);
    await compileOnce(host);

    await openProjectPicker();
    fireEvent.click(screen.getByText("Other paper"));
    await waitFor(() =>
      expect(kit.toast.success).toHaveBeenCalledWith("toast.savedToProject figures/diagram.png"),
    );
    await waitFor(() => expect(host.refreshTree).toHaveBeenCalledOnce());

    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledWith("toast.savedAsProject"));
    await waitFor(() => expect(host.refreshProjects).toHaveBeenCalledOnce());
    expect(host.createDiagramProject).toHaveBeenCalledOnce();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("confirms a save only after the refresh, as before", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    await openProjectPicker();
    fireEvent.click(screen.getByText("Other paper"));
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledOnce());
    expect((host.refreshTree as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      kit.toast.success.mock.invocationCallOrder[0],
    );

    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledTimes(2));
    expect((host.refreshProjects as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      kit.toast.success.mock.invocationCallOrder[1],
    );
  });

  it("runs one save for a double click on a save target", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    await openProjectPicker();
    const row = screen.getByText("Other paper");
    fireEvent.click(row);
    fireEvent.click(row);
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledOnce());
    expect(host.writeProjectBytes).toHaveBeenCalledOnce();
    expect(host.listFiles).toHaveBeenCalledOnce();

    await openProjectPicker();
    const newProject = screen.getByText("composer.newProject");
    fireEvent.click(newProject);
    fireEvent.click(newProject);
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledTimes(2));
    expect(host.createDiagramProject).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("composer.save"));
    const figure = await screen.findByText("composer.saveFigure");
    fireEvent.click(figure);
    fireEvent.click(figure);
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledTimes(3));
    expect(host.saveFigureToCache).toHaveBeenCalledOnce();
  });

  it("asks before overwriting only once for a double click", async () => {
    const host = makeHost({
      listFiles: vi.fn(async () => [{ path: "figures/diagram.png" }]),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    open(host);
    await compileOnce(host);

    await openProjectPicker();
    const row = screen.getByText("Other paper");
    fireEvent.click(row);
    fireEvent.click(row);

    await waitFor(() => expect(host.writeProjectBytes).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it("opens the save menu even when the project list cannot load", async () => {
    const host = makeHost({
      listProjectNames: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    open(host);
    await compileOnce(host);

    await openProjectPicker();

    expect(screen.getByText("composer.noOtherProjects")).toBeInTheDocument();
    expect(screen.getByText("composer.saveFigure")).toBeInTheDocument();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("says when the project list is empty", async () => {
    const host = makeHost({ listProjectNames: vi.fn(async () => []) });
    open(host);
    await compileOnce(host);

    await openProjectPicker();

    expect(screen.getByText("composer.noOtherProjects")).toBeInTheDocument();
  });

  it("saves the figure to the shared cache, fresh and already cached", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.saveFigure"));
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledWith("toast.figureSaved"));
    await waitFor(() => expect(screen.queryByText("composer.saveFigure")).not.toBeInTheDocument());

    (host.saveFigureToCache as ReturnType<typeof vi.fn>).mockResolvedValue({
      hash: "h",
      alreadyCached: true,
    });
    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.saveFigure"));
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledWith("toast.figureCached"));

    (host.saveFigureToCache as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("nope"));
    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.saveFigure"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveFigureFailed nope"),
    );
    expect(screen.queryByText("composer.saveFigure")).not.toBeInTheDocument();
  });

  it("downloads the compiled figure", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    fireEvent.click(screen.getByLabelText("composer.download"));
    expect(screen.getByText("composer.formatSvgSoon")).toBeDisabled();
    fireEvent.click(screen.getByText("composer.formatPng"));

    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledWith("toast.downloaded"));
    expect(host.saveBytesToDisk).toHaveBeenCalledWith("diagram", "png", "AAAA");
  });

  it("reports a download whose file could not be written", async () => {
    const host = makeHost({
      saveBytesToDisk: vi.fn(async () => {
        throw "disk full";
      }),
    });
    open(host);
    await compileOnce(host);

    fireEvent.click(screen.getByLabelText("composer.download"));
    fireEvent.click(screen.getByText("composer.formatPng"));

    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveFigureFailed disk full"),
    );
    expect(kit.toast.success).not.toHaveBeenCalled();
  });

  it("says nothing when the download dialog is cancelled", async () => {
    const host = makeHost({ saveBytesToDisk: vi.fn(async () => false) });
    open(host);
    await compileOnce(host);

    fireEvent.click(screen.getByLabelText("composer.download"));
    fireEvent.click(screen.getByText("composer.formatPng"));

    await waitFor(() => expect(host.saveBytesToDisk).toHaveBeenCalledOnce());
    expect(kit.toast.success).not.toHaveBeenCalled();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("imports a drawable file, a code-only file, and reports a failure", async () => {
    const host = makeHost({
      pickTikzFile: vi.fn(async () => ({
        name: "flow.tikz",
        content: "\\begin{tikzpicture}\n\\end{tikzpicture}\n",
      })),
    });
    open(host);

    fireEvent.click(screen.getByLabelText("composer.importLabel"));
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalled());
    expect(kit.toast.success.mock.lastCall?.[0]).toContain("flow.tikz");
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("flow.tikz");

    (host.pickTikzFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    fireEvent.click(screen.getByLabelText("composer.importLabel"));
    await waitFor(() => expect(host.pickTikzFile).toHaveBeenCalledTimes(2));

    (host.pickTikzFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("cancelled"));
    fireEvent.click(screen.getByLabelText("composer.importLabel"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.importFailed cancelled"),
    );
  });

  it("switches between the canvas and the code buffer", () => {
    open(makeHost());

    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    expect(screen.getByText("composer.snippets")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("snippets.rectangleNode"));
    expect(code.inserted).toHaveLength(1);

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "not a drawing" },
    });
    fireEvent.click(screen.getByTestId("diagram-tab-draw"));

    expect(kit.toast.info).toHaveBeenCalledWith("toast.notDrawable");
    expect(screen.getByTestId("diagram-canvas")).toBeInTheDocument();
  });

  it("lists TikZ commands the canvas does not draw after reading hand-written code", () => {
    open(makeHost());
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    fireEvent.change(screen.getByTestId("code-editor"), {
      target: {
        value: "\\begin{tikzpicture}\n\\node[draw] (a) at (0,0) {A};\n\\foreach \\x in {1,2} {\\draw (\\x,0) circle (0.2);}\n\\end{tikzpicture}",
      },
    });
    fireEvent.click(screen.getByTestId("diagram-tab-draw"));

    fireEvent.click(screen.getByTestId("diagram-notes"));
    expect(screen.getByTestId("diagram-notes-list")).toHaveTextContent("notes.droppedHeading");
    expect(screen.getByTestId("diagram-notes-list")).toHaveTextContent("notes.tikzCommand foreach");
  });

  it("renames the drawing and cancels a rename", () => {
    open(makeHost());

    fireEvent.click(screen.getByTestId("diagram-name-display"));
    fireEvent.change(screen.getByLabelText("composer.nameLabel"), {
      target: { value: "flow chart" },
    });
    fireEvent.click(screen.getByLabelText("composer.saveName"));
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("flow-chart.tikz");

    fireEvent.click(screen.getByTestId("diagram-name-display"));
    fireEvent.change(screen.getByLabelText("composer.nameLabel"), {
      target: { value: "other" },
    });
    fireEvent.click(screen.getByLabelText("composer.cancelRename"));
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("flow-chart.tikz");

    fireEvent.click(screen.getByTestId("diagram-name-display"));
    fireEvent.keyDown(screen.getByLabelText("composer.nameLabel"), { key: "Enter" });
    expect(screen.queryByLabelText("composer.nameLabel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("diagram-name-display"));
    fireEvent.keyDown(screen.getByLabelText("composer.nameLabel"), { key: "Escape" });
    expect(screen.queryByLabelText("composer.nameLabel")).not.toBeInTheDocument();
  });

  it("offers an AI fix after a failed compile", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "! error", has_pdf: false })),
      fixWithAi: vi.fn(async () => "\\draw (0,0) -- (1,1);\n"),
    });
    open(host);

    fireEvent.click(screen.getByTestId("diagram-compile"));
    const fix = await screen.findByText("composer.fixWithAi");

    fireEvent.click(fix);
    await waitFor(() => expect(host.compileIsolated).toHaveBeenCalledTimes(2));
    expect(host.fixWithAi).toHaveBeenCalledOnce();
    expect(screen.getByTestId("code-editor")).toHaveValue("\\draw (0,0) -- (1,1);\n");
    expect(kit.toast.success).not.toHaveBeenCalled();
    expect(kit.toast.error).not.toHaveBeenCalled();
  });

  it("reports an AI fix that returned nothing and one that threw", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "! error", has_pdf: false })),
      fixWithAi: vi.fn(async () => ""),
    });
    open(host);
    fireEvent.click(screen.getByTestId("diagram-compile"));
    fireEvent.click(await screen.findByText("composer.fixWithAi"));
    await waitFor(() => expect(kit.toast.error).toHaveBeenCalledWith("toast.noAiFix"));

    (host.fixWithAi as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no key"));
    fireEvent.click(screen.getByText("composer.fixWithAi"));
    await waitFor(() => expect(kit.toast.error).toHaveBeenCalledWith("no key"));

    (host.fixWithAi as ReturnType<typeof vi.fn>).mockRejectedValue("config unreadable");
    fireEvent.click(screen.getByText("composer.fixWithAi"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.fixFailed config unreadable"),
    );
  });

  it("asks before overwriting files that already exist", async () => {
    const host = makeHost({
      listFiles: vi.fn(async () => [{ path: "figures/diagram.png" }]),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    open(host);
    await compileOnce(host);

    await openProjectPicker();
    fireEvent.click(screen.getByText("Other paper"));

    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(confirm.mock.lastCall?.[0]).toContain("confirm.overwrite");
    expect(host.writeProjectBytes).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("recompiles on a transparent background and opens the preview on request", async () => {
    const host = makeHost();
    open(host);
    await compileOnce(host);

    fireEvent.click(screen.getByLabelText("preview.backgroundLabel"));
    await waitFor(() => expect(host.compileIsolated).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByLabelText("preview.minimize"));
    expect(canvas.props.showPreviewAction).toBe(true);
    act(() => canvas.props.onShowPreview?.());
    expect(screen.getByAltText("preview.alt")).toBeInTheDocument();
  });

  it("offers Insert as Typst only for a Typst document with a drawing", async () => {
    const plain = makeHost();
    open(plain);
    await compileOnce(plain);
    fireEvent.click(screen.getByLabelText("composer.save"));
    await screen.findByText("composer.saveFigure");
    expect(screen.queryByText("composer.insertTypst")).not.toBeInTheDocument();
    cleanup();

    const latex = makeHost({ insertTarget: vi.fn(() => null) });
    open(latex);
    await compileOnce(latex);
    fireEvent.click(screen.getByLabelText("composer.save"));
    await screen.findByText("composer.saveFigure");
    expect(screen.queryByText("composer.insertTypst")).not.toBeInTheDocument();
    cleanup();

    const typst = makeHost({
      insertTarget: vi.fn(() => ({ projectId: "doc", language: "typst" as const })),
      typstContext: vi.fn(() => ({ projectId: "doc", typstVersion: "0.12.0" })),
    });
    open(typst);
    act(() => canvas.props.onChange?.({ version: 1, nodes: [], edges: [] }));
    fireEvent.click(screen.getByLabelText("composer.save"));
    await waitFor(() => expect(kit.toast.error).toHaveBeenCalledWith("toast.compileBeforeSave"));
    expect(screen.queryByText("composer.insertTypst")).not.toBeInTheDocument();
  });

  it("inserts the drawing as fletcher code without a compile and says so once", async () => {
    const host = makeHost({
      insertTarget: vi.fn(() => ({ projectId: "doc", language: "typst" as const })),
      typstContext: vi.fn(() => ({ projectId: "doc", typstVersion: "0.12.0" })),
    });
    open(host);

    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.insertTypst"));

    const drawing = canvas.props.model as DiagramModel;
    await waitFor(() => expect(host.insertAtCursor).toHaveBeenCalledOnce());
    expect(host.insertAtCursor).toHaveBeenCalledWith(`${modelToFletcher(drawing, { typstVersion: "0.12.0" })}\n`);
    expect((host.insertAtCursor as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(
      /^#import "@preview\/fletcher:0\.5\.5": diagram, node, edge, shapes\n#diagram\(/,
    );
    expect(kit.toast.success).toHaveBeenCalledOnce();
    expect(kit.toast.success).toHaveBeenCalledWith("toast.insertedTypst");
    expect(kit.toast.keys).toHaveBeenCalledWith("diagram-save");
    expect(kit.toast.error).not.toHaveBeenCalled();
    expect(host.compileIsolated).not.toHaveBeenCalled();
    expect(screen.queryByText("composer.insertTypst")).not.toBeInTheDocument();
  });

  it("reads hand-edited code before inserting it as Typst", async () => {
    const host = makeHost({ insertTarget: vi.fn(() => ({ projectId: "doc", language: "typst" as const })) });
    open(host);
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: "not a drawing" } });

    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.insertTypst"));

    await waitFor(() => expect(kit.toast.info).toHaveBeenCalledWith("toast.notDrawable"));
    expect(host.insertAtCursor).not.toHaveBeenCalled();
    expect(kit.toast.success).not.toHaveBeenCalled();
  });

  it("offers Insert into document only for a LaTeX document", async () => {
    const plain = makeHost();
    open(plain);
    await compileOnce(plain);
    fireEvent.click(screen.getByLabelText("composer.save"));
    await screen.findByText("composer.saveFigure");
    expect(screen.queryByText("composer.insertLatex")).not.toBeInTheDocument();
    cleanup();

    const typst = makeHost({ insertTarget: vi.fn(() => ({ projectId: "doc", language: "typst" as const })) });
    open(typst);
    fireEvent.click(screen.getByLabelText("composer.save"));
    await screen.findByText("composer.insertTypst");
    expect(screen.queryByText("composer.insertLatex")).not.toBeInTheDocument();
  });

  it("inserts the drawing as TikZ into a LaTeX document without a compile", async () => {
    const host = makeHost({ insertTarget: vi.fn(() => ({ projectId: "doc", language: "tikz" as const })) });
    open(host);

    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.insertLatex"));

    await waitFor(() => expect(host.insertAtCursor).toHaveBeenCalledOnce());
    const inserted = (host.insertAtCursor as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(inserted).toContain("\\begin{tikzpicture}");
    expect(inserted).toContain("\\end{tikzpicture}");
    expect(inserted.endsWith("\n")).toBe(true);
    expect(kit.toast.success).toHaveBeenCalledOnce();
    expect(kit.toast.success).toHaveBeenCalledWith("toast.insertedLatex");
    expect(kit.toast.keys).toHaveBeenCalledWith("diagram-save");
    expect(host.compileIsolated).not.toHaveBeenCalled();
    expect(screen.queryByText("composer.insertLatex")).not.toBeInTheDocument();
  });

  it("inserts hand-written TikZ into a LaTeX document as typed", async () => {
    const host = makeHost({ insertTarget: vi.fn(() => ({ projectId: "doc", language: "tikz" as const })) });
    open(host);
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    const tikz = "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}";
    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: tikz } });

    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.insertLatex"));

    await waitFor(() => expect(host.insertAtCursor).toHaveBeenCalledWith(`${tikz}\n`));
  });

  it("saves the drawing as fletcher code into a Typst project", async () => {
    const host = makeHost({
      listProjectNames: vi.fn(async () => [{ id: "typ", name: "Typst paper", typst: true }]),
    });
    open(host);
    await compileOnce(host);
    await openProjectPicker();
    fireEvent.click(screen.getByText("Typst paper"));

    await waitFor(() =>
      expect(kit.toast.success).toHaveBeenCalledWith("toast.savedTypstToProject figures/diagram.typ"),
    );
    const drawing = canvas.props.model as DiagramModel;
    expect(host.writeProjectBytes).toHaveBeenCalledWith("typ", "figures/diagram.png", "AAAA");
    const written = (host.writeFileContent as ReturnType<typeof vi.fn>).mock.calls.find(
      ([target, path]) => target === "typ" && path === "figures/diagram.typ",
    )?.[2] as string;
    expect(written.startsWith(`${modelToFletcher(drawing, { typstVersion: null })}\n// oleafly-diagram-v1: `)).toBe(true);
    expect(host.writeFileContent).not.toHaveBeenCalledWith("typ", "figures/diagram.tikz", expect.any(String));
  });

  it("downloads the drawing as a Typst file without a compile", async () => {
    const host = makeHost();
    open(host);
    fireEvent.click(screen.getByLabelText("composer.download"));
    fireEvent.click(screen.getByText("composer.formatTypst"));

    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledWith("toast.downloaded"));
    const drawing = canvas.props.model as DiagramModel;
    const [stem, extension, data] = (host.saveBytesToDisk as ReturnType<typeof vi.fn>).mock.calls[0];
    expect([stem, extension]).toEqual(["diagram", "typ"]);
    const bytes = Uint8Array.from(atob(data as string), (character) => character.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith(`${modelToFletcher(drawing, { typstVersion: null })}\n// oleafly-diagram-v1: `)).toBe(true);
    expect(host.compileIsolated).not.toHaveBeenCalled();
  });

  it("compiles once for a caller that forces the preview open", async () => {
    const host = makeHost();
    open(host, { forcePreviewOpen: true });

    await waitFor(() => expect(host.compileIsolated).toHaveBeenCalledOnce());
    expect(screen.getByText("preview.label")).toBeInTheDocument();
  });
});

const RENDERED_TYPST = {
  status: "rendered" as const,
  image: { format: "png" as const, pngBase64: "BBBB" },
  diagnostics: [],
};

function typstHost(overrides: Partial<DiagramHost> = {}): DiagramHost {
  return makeHost({
    renderTypst: vi.fn(async () => RENDERED_TYPST),
    typstContext: vi.fn(() => ({ projectId: "paper", typstVersion: "0.13.1" })),
    ...overrides,
  });
}

describe("DiagramComposer in Typst mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvas.props = {};
    code.inserted = [];
    code.revealed = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("opens with fletcher code, a Typst label and a .typ file name", () => {
    open(typstHost(), { language: "typst" });

    expect(screen.getByTestId("diagram-language")).toHaveTextContent("Typst");
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("diagram.typ");
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    const value = (screen.getByTestId("code-editor") as HTMLTextAreaElement).value;
    expect(value).toBe(modelToFletcher(canvas.props.model ?? { version: 1, nodes: [], edges: [] }, { typstVersion: "0.13.1" }));
    expect(value.startsWith('#import "@preview/fletcher:0.5.8": diagram, node, edge, shapes\n#diagram(')).toBe(true);
  });

  it("previews with the project's Typst at the chosen scale and never runs LaTeX", async () => {
    const host = typstHost();
    open(host, { language: "typst" });

    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() => expect(screen.getByAltText("preview.alt")).toHaveAttribute("src", "data:image/png;base64,BBBB"));
    const request = (host.renderTypst as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request).toMatchObject({ format: "png", ppi: 144, projectId: "paper", document: true });
    expect(request.source.split("\n")[0]).toBe('#set page(width: auto, height: auto, margin: 4pt, fill: rgb("#ffffff"))');
    expect(request.source.split("\n").slice(1).join("\n")).toBe(modelToFletcher(canvas.props.model as DiagramModel, { typstVersion: "0.13.1" }));
    expect(host.compileIsolated).not.toHaveBeenCalled();
  });

  it("shows Typst errors at code panel lines and jumps to them", async () => {
    const host = typstHost({
      renderTypst: vi.fn(async () => ({
        status: "failed" as const,
        diagnostics: [
          { severity: "error" as const, message: "unknown variable: nod", line: 4, column: 3 },
          { severity: "error" as const, message: "compiled with errors", line: null, column: null },
        ],
      })),
    });
    open(host, { language: "typst" });

    fireEvent.click(screen.getByTestId("diagram-compile"));

    const jump = await screen.findByText("preview.diagnosticAt 3 unknown variable: nod");
    expect(screen.getByText("compiled with errors")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.compileFailed");
    fireEvent.click(jump);
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    expect(code.revealed).toEqual([[3, 3]]);
  });

  it("explains a fletcher package that could not be downloaded", async () => {
    const host = typstHost({
      renderTypst: vi.fn(async () => ({
        status: "failed" as const,
        diagnostics: [
          {
            severity: "error" as const,
            message: "failed to download package (@preview/fletcher:0.5.8)",
            line: 2,
            column: 9,
          },
        ],
      })),
    });
    open(host, { language: "typst" });

    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() =>
      expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.typstPackageMissing"),
    );
  });

  it("reads hand-written fletcher into the canvas and lists what it keeps as code", async () => {
    open(typstHost(), { language: "typst" });
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    const source = [
      '#import "@preview/fletcher:0.5.8": diagram, node, edge',
      "#diagram(",
      "  spacing: 2em,",
      "  node((0cm, 0cm), [In], name: <in>, width: 2cm, height: 1cm),",
      "  node((4cm, 0cm), [Out], name: <out>, width: 2cm, height: 1cm),",
      '  edge(<in>, <out>, "->"),',
      ")",
    ].join("\n");
    fireEvent.change(screen.getByTestId("code-editor"), { target: { value: source } });
    fireEvent.click(screen.getByTestId("diagram-tab-draw"));

    await waitFor(() => expect(canvas.props.model?.nodes.map((n) => n.id)).toEqual(["in", "out"]));
    expect(canvas.props.model?.edges).toHaveLength(1);
    fireEvent.click(screen.getByTestId("diagram-notes"));
    expect(screen.getByTestId("diagram-notes-list")).toHaveTextContent("notes.diagramSetting spacing");

    act(() =>
      canvas.props.onChange?.({
        ...(canvas.props.model as DiagramModel),
        nodes: (canvas.props.model as DiagramModel).nodes.map((n) => (n.id === "out" ? { ...n, x: n.x + 40 } : n)),
      }),
    );
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    const next = (screen.getByTestId("code-editor") as HTMLTextAreaElement).value;
    expect(next).toContain("  spacing: 2em,");
    expect(next).toContain("  node((0cm, 0cm), [In], name: <in>, width: 2cm, height: 1cm),");
    expect(next).not.toContain("node((4cm, 0cm), [Out]");
  });

  it("asks the AI for fletcher code with the Typst errors", async () => {
    const fixWithAi = vi.fn(async () => '#import "@preview/fletcher:0.5.8": diagram, node, edge\n#diagram()');
    const host = typstHost({
      fixWithAi,
      renderTypst: vi.fn(async () => ({
        status: "failed" as const,
        diagnostics: [{ severity: "error" as const, message: "expected comma", line: 5, column: 1 }],
      })),
    });
    open(host, { language: "typst" });
    fireEvent.click(screen.getByTestId("diagram-compile"));
    fireEvent.click(await screen.findByText("composer.fixWithAi"));

    await waitFor(() => expect(fixWithAi).toHaveBeenCalledOnce());
    const [codeSent, log, prompt] = fixWithAi.mock.calls[0] as unknown as [string, string, { system: string; user: string }];
    expect(codeSent.startsWith('#import "@preview/fletcher')).toBe(true);
    expect(log).toBe("line 4, column 1: expected comma");
    expect(prompt.system).toContain("fletcher");
    expect(prompt.user).toContain("TYPST ERRORS:\nline 4, column 1: expected comma");
  });

  it("saves a new Typst diagram project as a standalone .typ", async () => {
    const host = typstHost();
    open(host, { language: "typst" });
    fireEvent.click(screen.getByTestId("diagram-compile"));
    await screen.findByAltText("preview.alt");
    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));

    await waitFor(() => expect(host.createDiagramProject).toHaveBeenCalledOnce());
    const [, source, language] = (host.createDiagramProject as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(language).toBe("typst");
    expect(source.split("\n")[0]).toBe('#set page(width: auto, height: auto, margin: 4pt, fill: rgb("#ffffff"))');
    expect(source).toContain("#diagram(");
    expect(source).toContain("// oleafly-diagram-v1: ");
  });

  it("downloads SVG rendered by Typst", async () => {
    const host = typstHost({
      renderTypst: vi.fn(async () => ({
        status: "rendered" as const,
        image: { format: "svg" as const, svg: "<svg/>" },
        diagnostics: [],
      })),
    });
    open(host, { language: "typst" });
    fireEvent.click(screen.getByLabelText("composer.download"));
    fireEvent.click(screen.getByTestId("diagram-download-svg"));

    await waitFor(() => expect(host.saveBytesToDisk).toHaveBeenCalledWith("diagram", "svg", btoa("<svg/>")));
  });

  it("imports a .typ file into Typst mode from a TikZ composer", async () => {
    const host = typstHost({
      pickTikzFile: vi.fn(async () => ({
        name: "flow.typ",
        content: [
          "#set page(width: auto, height: auto, margin: 4pt)",
          '#import "@preview/fletcher:0.5.8": diagram, node, edge',
          "#diagram(node((0cm, 0cm), [A], name: <a>, width: 2cm, height: 1cm))",
        ].join("\n"),
      })),
    });
    open(host);
    fireEvent.click(screen.getByLabelText("composer.importLabel"));

    await waitFor(() => expect(screen.getByTestId("diagram-language")).toHaveTextContent("Typst"));
    expect(host.pickTikzFile).toHaveBeenCalledWith(expect.stringContaining(".typ"));
    await waitFor(() => expect(canvas.props.model?.nodes.map((n) => n.id)).toEqual(["a"]));
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("flow.typ");
  });

  it("converts the drawing when a caller asks for another language while open", async () => {
    const host = typstHost();
    const view = render(
      <DiagramComposer open projectId="project" onClose={() => {}} host={host} language="tikz" languageRequest={1} />,
    );
    const drawing = canvas.props.model as DiagramModel;
    view.rerender(
      <DiagramComposer open projectId="project" onClose={() => {}} host={host} language="typst" languageRequest={2} />,
    );

    await waitFor(() => expect(screen.getByTestId("diagram-language")).toHaveTextContent("Typst"));
    expect(canvas.props.model?.nodes.map((n) => n.label)).toEqual(drawing.nodes.map((n) => n.label));
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    expect((screen.getByTestId("code-editor") as HTMLTextAreaElement).value).toContain("#diagram(");
  });
});

function mermaidHost(overrides: Partial<DiagramHost> = {}): DiagramHost {
  return makeHost({
    renderMermaid: vi.fn(async () => ({ svg: "<svg>m</svg>", pngBase64: "CCCC" })),
    ...overrides,
  });
}

describe("DiagramComposer in Mermaid mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvas.props = {};
    code.inserted = [];
    code.revealed = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("opens with a flowchart, a Mermaid label and a .mmd file name", () => {
    open(mermaidHost(), { language: "mermaid" });

    expect(screen.getByTestId("diagram-language")).toHaveTextContent("Mermaid");
    expect(screen.getByTestId("diagram-name-display")).toHaveTextContent("diagram.mmd");
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    expect((screen.getByTestId("code-editor") as HTMLTextAreaElement).value).toMatch(/^flowchart TD\n/);
  });

  it("previews with the app's Mermaid renderer and downloads its SVG", async () => {
    const host = mermaidHost();
    open(host, { language: "mermaid" });

    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() => expect(screen.getByAltText("preview.alt")).toHaveAttribute("src", "data:image/png;base64,CCCC"));
    const [source, options] = (host.renderMermaid as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(source).toMatch(/^flowchart TD\n/);
    expect(options).toEqual({ scale: 2, background: "#ffffff" });
    expect(host.compileIsolated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("composer.download"));
    fireEvent.click(screen.getByTestId("diagram-download-svg"));
    await waitFor(() => expect(host.saveBytesToDisk).toHaveBeenCalledWith("diagram", "svg", btoa("<svg>m</svg>")));
  });

  it("shows a Mermaid parse error at its line", async () => {
    const host = mermaidHost({
      renderMermaid: vi.fn(async () => {
        throw new Error("Parse error on line 2: unexpected token");
      }),
    });
    open(host, { language: "mermaid" });

    fireEvent.click(screen.getByTestId("diagram-compile"));

    expect(await screen.findByText("preview.diagnosticAt 2 Parse error on line 2: unexpected token")).toBeInTheDocument();
    expect(screen.getByTestId("diagram-compile-failure")).toHaveTextContent("toast.compileFailed");
  });

  it("inserts a fenced block into a Markdown document and saves its figure for the PDF", async () => {
    const host = mermaidHost({ insertTarget: vi.fn(() => ({ projectId: "notes", language: "mermaid" as const })) });
    open(host, { language: "mermaid" });

    fireEvent.click(screen.getByLabelText("composer.save"));
    fireEvent.click(await screen.findByText("composer.insertMermaid"));

    await waitFor(() => expect(host.insertAtCursor).toHaveBeenCalledOnce());
    const inserted = (host.insertAtCursor as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(inserted).toMatch(/^```mermaid\nflowchart TD\n[\s\S]*\n```\n$/);
    const body = inserted.slice("```mermaid\n".length, inserted.length - "\n```\n".length);
    expect(host.writeProjectBytes).toHaveBeenCalledWith("notes", `figures/mermaid-${figureHash(body)}.png`, expect.any(String));
    expect(kit.toast.success).toHaveBeenCalledWith("toast.insertedMermaid");
  });

  it("saves into a Markdown project as .mmd with its PNG and SVG", async () => {
    const host = mermaidHost({
      listProjectNames: vi.fn(async () => [{ id: "md", name: "Markdown notes", language: "mermaid" as const }]),
    });
    open(host, { language: "mermaid" });
    fireEvent.click(screen.getByTestId("diagram-compile"));
    await screen.findByAltText("preview.alt");
    await openProjectPicker();
    fireEvent.click(screen.getByText("Markdown notes"));

    await waitFor(() =>
      expect(kit.toast.success).toHaveBeenCalledWith("toast.savedMermaidToProject figures/diagram.mmd"),
    );
    expect(host.writeProjectBytes).toHaveBeenCalledWith("md", "figures/diagram.png", "CCCC");
    expect(host.writeFileContent).toHaveBeenCalledWith("md", "figures/diagram.svg", "<svg>m</svg>");
    const mmd = (host.writeFileContent as ReturnType<typeof vi.fn>).mock.calls.find(([, path]) => path === "figures/diagram.mmd")?.[2] as string;
    expect(mmd).toMatch(/^flowchart TD\n/);
    expect(mmd).toContain("%% oleafly-diagram-v1: ");
  });

  it("creates a Markdown diagram project around a fenced block", async () => {
    const host = mermaidHost();
    open(host, { language: "mermaid" });
    fireEvent.click(screen.getByTestId("diagram-compile"));
    await screen.findByAltText("preview.alt");
    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));

    await waitFor(() => expect(host.createDiagramProject).toHaveBeenCalledOnce());
    const [, source, language] = (host.createDiagramProject as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(language).toBe("mermaid");
    expect(source).toMatch(/^```mermaid\nflowchart TD\n[\s\S]*%% oleafly-diagram-v1: [^\n]*\n```\n$/);
    await waitFor(() => expect(host.writeProjectBytes).toHaveBeenCalledWith("new", expect.stringMatching(/^figures\/mermaid-[0-9a-f]{16}\.png$/), expect.any(String)));
  });

  it("imports a Markdown file's mermaid block into Mermaid mode", async () => {
    const host = mermaidHost({
      pickTikzFile: vi.fn(async () => ({
        name: "notes.md",
        content: "# Notes\n\n```mermaid\nflowchart LR\n  a[Start] --> b[End]\n```\n",
      })),
    });
    open(host);
    fireEvent.click(screen.getByLabelText("composer.importLabel"));

    await waitFor(() => expect(screen.getByTestId("diagram-language")).toHaveTextContent("Mermaid"));
    await waitFor(() => expect(canvas.props.model?.nodes.map((n) => n.label)).toEqual(["Start", "End"]));
    fireEvent.click(screen.getByTestId("diagram-tab-code"));
    expect((screen.getByTestId("code-editor") as HTMLTextAreaElement).value).toBe("flowchart LR\n  a[Start] --> b[End]");
  });
});
