// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  createProjectFromAdHoc: vi.fn(),
  logError: vi.fn(),
  openProject: vi.fn(),
  pickSavePath: vi.fn(),
  refreshProjects: vi.fn(),
  runAdHocConverter: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeBytesFile: vi.fn(),
}));

vi.mock("@/features/ad-hoc-converters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/ad-hoc-converters")>();
  return { ...actual, runAdHocConverter: mocks.runAdHocConverter };
});
vi.mock("@/components/tools/CodeField", () => ({
  CodeField: ({
    value,
    onChange,
    testId,
  }: {
    value: string;
    onChange: (value: string) => void;
    testId?: string;
  }) => (
    <textarea
      data-testid={testId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("@/lib/tauri", () => ({
  convertAdHoc: vi.fn(),
  createProjectFromAdHoc: mocks.createProjectFromAdHoc,
  extractArxivSource: vi.fn(),
  getConfig: vi.fn(),
  writeBytesFile: mocks.writeBytesFile,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/lib/use-fullscreen", () => ({ useFullscreen: () => false }));
vi.mock("@/components/layout/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@/components/layout/ThemeControls", () => ({ ThemeMenu: () => null }));

import { ConverterToolView } from "./ConverterToolView";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createProjectFromAdHoc.mockResolvedValue("converted-project");
  mocks.openProject.mockResolvedValue(undefined);
  mocks.refreshProjects.mockResolvedValue(undefined);
  mocks.pickSavePath.mockResolvedValue(null);
  mocks.writeBytesFile.mockResolvedValue(undefined);
  useFilesStore.setState({
    projectId: null,
    openProject: mocks.openProject,
    refreshProjects: mocks.refreshProjects,
  });
  useHomeViewStore.setState({
    page: "converter",
    activeConverter: "markdown-to-latex",
  });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("ConverterToolView", () => {
  it("runs the built-in example and displays an editable result", async () => {
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "\\documentclass{article}\\begin{document}Converted\\end{document}",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });

    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));

    await waitFor(() => expect(mocks.runAdHocConverter).toHaveBeenCalledOnce());
    expect(mocks.runAdHocConverter).toHaveBeenCalledWith(
      "markdown-to-latex",
      expect.objectContaining({ text: expect.stringContaining("A compact example") }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(
      (await screen.findByTestId("converter-output") as HTMLTextAreaElement).value,
    ).toContain("Converted");
    expect(screen.getByRole("status")).toHaveTextContent("Converted");
  });

  it("aborts an in-flight conversion when Cancel is pressed", async () => {
    let receivedSignal: AbortSignal | undefined;
    mocks.runAdHocConverter.mockImplementation(
      (_id, _input, _onProgress, signal: AbortSignal | undefined) =>
        new Promise((_resolve, reject) => {
          receivedSignal = signal;
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Cancelled", "AbortError"));
          });
        }),
    );

    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.click(await screen.findByTestId("converter-cancel"));

    expect(receivedSignal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled");
    expect(screen.getByTestId("converter-run")).toBeEnabled();
  });

  it("wraps a LaTeX fragment and keeps assets when creating a project", async () => {
    useHomeViewStore.setState({
      page: "converter",
      activeConverter: "html-to-latex",
    });
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "\\section{Converted}",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [{ path: "assets/figure.png", dataBase64: "AQID" }],
    });
    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.click(await screen.findByRole("button", { name: /Create project/i }));

    await waitFor(() => {
      expect(mocks.createProjectFromAdHoc).toHaveBeenCalledWith({
        name: "HTML to LaTeX result",
        target: "latex",
        text: expect.stringContaining("\\documentclass{article}"),
        mainFile: undefined,
        files: [{ path: "assets/figure.png", dataBase64: "AQID" }],
      });
      expect(mocks.openProject).toHaveBeenCalledWith("converted-project");
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Project created from the conversion.",
      );
    });
  });

  it("renders nothing outside a converter route", () => {
    useHomeViewStore.setState({ page: "tools", activeConverter: null });
    const { container } = render(<ConverterToolView />);
    expect(container).toBeEmptyDOMElement();
  });

  it("accepts a file, removes it, and converts the replacement", async () => {
    useHomeViewStore.setState({ page: "converter", activeConverter: "word-to-latex" });
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "\\documentclass{article}",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });
    render(<ConverterToolView />);
    const input = screen.getByTestId("converter-file-input");
    const first = new File(["first"], "first.docx");
    fireEvent.change(input, { target: { files: [first] } });
    expect(screen.getByText("first.docx")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));
    expect(screen.getByTestId("converter-run")).toBeDisabled();

    const second = new File(["second"], "second.docx");
    fireEvent.change(input, { target: { files: [second] } });
    fireEvent.click(screen.getByTestId("converter-run"));
    await waitFor(() => {
      expect(mocks.runAdHocConverter).toHaveBeenCalledWith(
        "word-to-latex",
        { text: "", file: second },
        expect.any(Function),
        expect.any(AbortSignal),
      );
    });
  });

  it("switches equation input modes, clears input, and reloads the example", () => {
    useHomeViewStore.setState({ page: "converter", activeConverter: "equation-to-latex" });
    render(<ConverterToolView />);
    fireEvent.click(screen.getByRole("button", { name: "Equation image" }));
    expect(screen.getByTestId("converter-file-input")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Type equation" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    expect(screen.getByTestId("converter-run")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Load example" }));
    expect(screen.getByTestId("converter-run")).toBeEnabled();
  });

  it("shows local-model recovery without hiding the converter error", async () => {
    useHomeViewStore.setState({ page: "converter", activeConverter: "image-to-latex" });
    mocks.runAdHocConverter.mockRejectedValue(
      new Error("Start Ollama and install a local vision model."),
    );
    render(<ConverterToolView />);
    const image = new File(["image"], "notes.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("converter-file-input"), {
      target: { files: [image] },
    });
    fireEvent.click(screen.getByTestId("converter-run"));
    expect(await screen.findByText("This conversion needs attention")).toBeInTheDocument();
    expect(screen.getByText(/Start Ollama/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI settings" }));
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("ai");
    expect(mocks.logError).toHaveBeenCalledWith(
      "converter image-to-latex",
      expect.any(Error),
    );
  });

  it("copies editable output and reports a clipboard denial", async () => {
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "converted source",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });
    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.change(await screen.findByTestId("converter-output"), {
      target: { value: "edited source" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("edited source"));
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Oleafly couldn't copy the converted source.",
      );
    });
  });

  it("saves text, binary, and source bundles through the native save boundary", async () => {
    const outputs = [
      {
        kind: "text" as const,
        text: "plain output",
        dataBase64: null,
        fileName: "converted.tex",
        mediaType: "application/x-tex",
        files: [],
      },
      {
        kind: "binary" as const,
        text: null,
        dataBase64: "UEsDBA==",
        fileName: "converted.docx",
        mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        files: [],
      },
      {
        kind: "text" as const,
        text: "main source",
        dataBase64: null,
        fileName: "converted.tex",
        mediaType: "application/x-tex",
        files: [{ path: "assets/figure.png", dataBase64: "AQID" }],
      },
    ];
    const routes = ["markdown-to-latex", "latex-to-word", "word-to-latex"] as const;
    for (let index = 0; index < outputs.length; index += 1) {
      useHomeViewStore.setState({ page: "converter", activeConverter: routes[index] });
      mocks.runAdHocConverter.mockResolvedValueOnce(outputs[index]);
      mocks.pickSavePath.mockResolvedValueOnce(`/tmp/output-${index}`);
      const view = render(<ConverterToolView />);
      if (routes[index] === "word-to-latex") {
        fireEvent.change(screen.getByTestId("converter-file-input"), {
          target: { files: [new File(["docx"], "paper.docx")] },
        });
      }
      fireEvent.click(screen.getByTestId("converter-run"));
      const save = await screen.findByRole("button", {
        name: index === 2 ? "Save ZIP" : "Save",
      });
      if (index === 1) {
        expect(screen.getByText("converted.docx is ready")).toBeInTheDocument();
      }
      fireEvent.click(save);
      await waitFor(() => expect(mocks.writeBytesFile).toHaveBeenCalledTimes(index + 1));
      view.unmount();
    }
    expect(mocks.writeBytesFile).toHaveBeenNthCalledWith(1, "/tmp/output-0", "cGxhaW4gb3V0cHV0");
    expect(mocks.writeBytesFile).toHaveBeenNthCalledWith(2, "/tmp/output-1", "UEsDBA==");
    expect(mocks.writeBytesFile.mock.calls[2][1]).toMatch(/^UEs/);
  });

  it("does not write when the save dialog is cancelled", async () => {
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "converted",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });
    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.pickSavePath).toHaveBeenCalledOnce());
    expect(mocks.writeBytesFile).not.toHaveBeenCalled();
  });

  it("reports save failures instead of leaving an unhandled rejection", async () => {
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "converted",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });
    mocks.pickSavePath.mockResolvedValue("/tmp/converted.tex");
    mocks.writeBytesFile.mockRejectedValue(new Error("The destination is read-only."));
    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("The destination is read-only.");
      expect(mocks.logError).toHaveBeenCalledWith(
        "save converter output markdown-to-latex",
        expect.any(Error),
      );
    });
  });

  it("publishes an arXiv bundle with its detected main file", async () => {
    useHomeViewStore.setState({ page: "converter", activeConverter: "arxiv-to-latex" });
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "bundle",
      text: "\\documentclass{article}",
      dataBase64: null,
      fileName: "arxiv-paper.zip",
      mediaType: "application/zip",
      files: [{ path: "paper.tex", dataBase64: "WA==" }],
      mainFile: "paper.tex",
    });
    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.click(await screen.findByRole("button", { name: /Create project/i }));
    await waitFor(() => {
      expect(mocks.createProjectFromAdHoc).toHaveBeenCalledWith({
        name: "arXiv 1706.03762",
        target: "latex",
        text: undefined,
        mainFile: "paper.tex",
        files: [{ path: "paper.tex", dataBase64: "WA==" }],
      });
    });
  });

  it("keeps a cleared or unmounted conversion from publishing a late result", async () => {
    let resolve!: (value: {
      kind: "text";
      text: string;
      dataBase64: null;
      fileName: string;
      mediaType: string;
      files: [];
    }) => void;
    mocks.runAdHocConverter.mockImplementation(
      () => new Promise((done) => { resolve = done; }),
    );
    const view = render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    fireEvent.click(screen.getByRole("button", { name: /Clear/i }));
    resolve({
      kind: "text",
      text: "late",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });
    await Promise.resolve();
    expect(screen.queryByTestId("converter-output")).not.toBeInTheDocument();
    view.unmount();
  });

  it("reports project publication failures and releases the busy state", async () => {
    mocks.runAdHocConverter.mockResolvedValue({
      kind: "text",
      text: "converted",
      dataBase64: null,
      fileName: "converted.tex",
      mediaType: "application/x-tex",
      files: [],
    });
    mocks.createProjectFromAdHoc.mockRejectedValue("failed");
    render(<ConverterToolView />);
    fireEvent.click(screen.getByTestId("converter-run"));
    const create = await screen.findByRole("button", { name: /Create project/i });
    fireEvent.click(create);
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith("Oleafly couldn't create the project.");
      expect(create).toBeEnabled();
    });
  });
});
