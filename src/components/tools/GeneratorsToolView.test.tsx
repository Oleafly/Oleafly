// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeViewStore } from "@/store/home-view";
import { ThemeProvider } from "@/lib/theme";

const mocks = vi.hoisted(() => ({
  ensureProvider: vi.fn(),
  handoff: vi.fn(),
  selection: vi.fn(),
  error: vi.fn(),
}));

const files = { projectId: "project" as string | null, activePath: "main.tex" as string | null, docVersion: 0 };

vi.mock("@/features/assistant-handoff", () => ({
  ensureAiProviderOrOpenSettings: mocks.ensureProvider,
  handoffToAssistant: mocks.handoff,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign((select: (store: typeof files) => unknown) => select(files), { getState: () => files }),
}));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: "main.tex" }) }));
vi.mock("@/components/editor/selection-text", () => ({ activeSelectionText: mocks.selection }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.error } }));

import { GeneratorsToolView } from "./GeneratorsToolView";

beforeEach(() => {
  vi.clearAllMocks();
  files.projectId = "project";
  files.activePath = "main.tex";
  files.docVersion = 0;
  mocks.selection.mockReturnValue(null);
  mocks.ensureProvider.mockResolvedValue(true);
  useHomeViewStore.setState({ page: "generators" });
});

const generate = () => fireEvent.click(screen.getByTestId("generator-launch"));
const promptPreview = () => screen.getByTestId("generator-prompt-preview").textContent;

describe("GeneratorsToolView", () => {
  it("shows task and preview panes without launching when a task is selected", () => {
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    expect(screen.getByRole("region", { name: "Writing task" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Prompt preview" })).toBeInTheDocument();
    expect(screen.getByTestId("generators-tool-view-back")).toHaveFocus();
    expect(promptPreview()).toContain("Write an abstract");
    fireEvent.click(screen.getByTestId("generator-thesis"));
    expect(screen.getByTestId("generator-thesis")).toHaveAttribute("aria-pressed", "true");
    expect(promptPreview()).toContain("Propose a chapter-by-chapter outline");
    expect(mocks.ensureProvider).not.toHaveBeenCalled();
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("sends exactly the reviewed prompt, including selection and optional instructions", async () => {
    mocks.selection.mockReturnValue("Dense original prose.");
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    fireEvent.click(screen.getByTestId("generator-summarize"));
    fireEvent.change(screen.getByTestId("generator-instructions"), { target: { value: "Use five short points." } });
    expect(promptPreview()).toContain("Dense original prose.");
    expect(promptPreview()).toContain("Use five short points.");
    const reviewed = promptPreview();
    generate();
    await vi.waitFor(() => expect(mocks.handoff).toHaveBeenCalledExactlyOnceWith(reviewed, { autoSend: true }));
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("allows a summary to use the full document instead of the selection", () => {
    mocks.selection.mockReturnValue("Selected passage.");
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    fireEvent.click(screen.getByTestId("generator-summarize"));
    expect(promptPreview()).toContain("Selected passage.");
    fireEvent.click(screen.getByTestId("generator-source-document"));
    expect(promptPreview()).toContain("Work from @main.tex.");
    expect(promptPreview()).not.toContain("Selected passage.");
  });

  it("requires a source selection for Paraphrase", async () => {
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    fireEvent.click(screen.getByTestId("generator-paraphrase"));
    expect(screen.getByTestId("generator-launch")).toBeDisabled();
    expect(promptPreview()).toContain("Select a passage in the editor");
    expect(mocks.handoff).not.toHaveBeenCalled();

    mocks.selection.mockReturnValue("Dense original prose.");
    fireEvent.click(screen.getByTestId("generator-paraphrase"));
    expect(screen.getByTestId("generator-launch")).toBeEnabled();
    generate();
    await vi.waitFor(() => expect(mocks.handoff).toHaveBeenCalled());
    expect(mocks.handoff.mock.calls[0][0]).toContain("Dense original prose.");
  });

  it("requires an open project before generating", () => {
    files.projectId = null;
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    expect(screen.getByTestId("generator-launch")).toBeDisabled();
    expect(promptPreview()).toBe("Open a project to use a writing task.");
    expect(mocks.ensureProvider).not.toHaveBeenCalled();
  });

  it("waits for provider configuration before handing work to the assistant", async () => {
    mocks.ensureProvider.mockResolvedValue(false);
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    generate();
    await vi.waitFor(() => expect(mocks.ensureProvider).toHaveBeenCalled());
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("does not send the same request twice while provider setup is pending", async () => {
    let allowProvider!: (configured: boolean) => void;
    mocks.ensureProvider.mockReturnValue(new Promise((resolve) => { allowProvider = resolve; }));
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    generate();
    expect(screen.getByTestId("generator-launch")).toBeDisabled();
    generate();
    expect(mocks.ensureProvider).toHaveBeenCalledOnce();
    await act(async () => allowProvider(true));
    expect(mocks.handoff).toHaveBeenCalledOnce();
  });

  it("does not send a prompt after the active document changes during provider setup", async () => {
    let allowProvider!: (configured: boolean) => void;
    mocks.ensureProvider.mockReturnValue(new Promise((resolve) => { allowProvider = resolve; }));
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    generate();
    files.activePath = "other.tex";
    await act(async () => allowProvider(true));
    expect(screen.getByRole("alert")).toHaveTextContent("The source changed");
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("does not send a prompt after the selected source changes during provider setup", async () => {
    let allowProvider!: (configured: boolean) => void;
    mocks.selection.mockReturnValue("Original selection.");
    mocks.ensureProvider.mockReturnValue(new Promise((resolve) => { allowProvider = resolve; }));
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    fireEvent.click(screen.getByTestId("generator-paraphrase"));
    generate();
    mocks.selection.mockReturnValue("New selection.");
    await act(async () => allowProvider(true));
    expect(screen.getByRole("alert")).toHaveTextContent("The source changed");
    expect(promptPreview()).toContain("New selection.");
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("does not send a prompt after leaving the tool", async () => {
    let allowProvider!: (configured: boolean) => void;
    mocks.ensureProvider.mockReturnValue(new Promise((resolve) => { allowProvider = resolve; }));
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    generate();
    fireEvent.click(screen.getByTestId("generators-tool-view-back"));
    await act(async () => allowProvider(true));
    expect(mocks.handoff).not.toHaveBeenCalled();
  });

  it("shows provider errors and allows retry", async () => {
    mocks.ensureProvider.mockRejectedValueOnce(new Error("Unavailable"));
    render(<ThemeProvider><GeneratorsToolView /></ThemeProvider>);
    generate();
    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not open the assistant"));
    expect(screen.getByTestId("generator-launch")).toBeEnabled();
    generate();
    await vi.waitFor(() => expect(mocks.handoff).toHaveBeenCalledOnce());
  });
});
