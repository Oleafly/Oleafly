// @vitest-environment jsdom

import { forwardRef, useImperativeHandle, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramModel } from "@oleafly/latex";
import type { DiagramHost } from "./host";

const kit = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const canvas = vi.hoisted(() => ({
  props: {} as {
    model?: DiagramModel;
    onChange?: (model: DiagramModel) => void;
    showPreviewAction?: boolean;
    onShowPreview?: () => void;
  },
}));

const code = vi.hoisted(() => ({ inserted: [] as string[] }));

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
    { insert: (text: string) => void },
    { value: string; onChange: (next: string) => void }
  >(function CmCodeEditor({ value, onChange }, ref) {
    useImperativeHandle(ref, () => ({
      insert: (text: string) => code.inserted.push(text),
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

import { DiagramComposer } from "./DiagramComposer";

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

describe("DiagramComposer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvas.props = {};
    code.inserted = [];
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

  it("reports a compile that produced no document, then one that threw", async () => {
    const host = makeHost({
      compileIsolated: vi.fn(async () => ({ log: "! Undefined control sequence", has_pdf: false })),
    });
    open(host);

    fireEvent.click(screen.getByTestId("diagram-compile"));
    await waitFor(() => expect(kit.toast.error).toHaveBeenCalledWith("toast.compileFailed"));
    expect(screen.getByText("! Undefined control sequence")).toBeInTheDocument();

    cleanup();
    const broken = makeHost({
      compileIsolated: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    open(broken);
    fireEvent.click(screen.getByTestId("diagram-compile"));

    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.compileError Error: boom"),
    );
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
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveFailed Error: disk full"),
    );

    await openProjectPicker();
    fireEvent.click(screen.getByText("composer.newProject"));
    await waitFor(() =>
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveAsProjectFailed Error: no room"),
    );
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
      expect(kit.toast.error).toHaveBeenCalledWith("toast.saveFigureFailed Error: nope"),
    );
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
      expect(kit.toast.error).toHaveBeenCalledWith("toast.importFailed Error: cancelled"),
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
    await waitFor(() => expect(kit.toast.success).toHaveBeenCalledWith("toast.aiFixApplied"));
    expect(host.fixWithAi).toHaveBeenCalledOnce();
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

  it("compiles once for a caller that forces the preview open", async () => {
    const host = makeHost();
    open(host, { forcePreviewOpen: true });

    await waitFor(() => expect(host.compileIsolated).toHaveBeenCalledOnce());
    expect(screen.getByText("preview.label")).toBeInTheDocument();
  });
});
