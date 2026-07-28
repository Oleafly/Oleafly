// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
  registerLanguageServiceLifecycleActions,
} from "@/lib/analysis/language-service-actions";
import {
  LanguageServiceController,
  type LifecycleLanguageServiceClient,
} from "@/lib/analysis/language-service-controller";
import type {
  LanguageServiceClientListener,
  LanguageServiceClientStartOptions,
  LanguageServiceClientState,
  LanguageServiceFeature,
  TextDocumentItem,
} from "@/lib/language-service";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { LanguageServiceStatus } from "./LanguageServiceStatus";

afterEach(() => {
  cleanup();
  useFilesStore.setState({ projectId: null, activePath: null });
  useProjectAnalysisStore.getState().reset();
});

function activateProject() {
  useFilesStore.setState({
    projectId: "project-a",
    activePath: "main.tex",
  });
  useProjectAnalysisStore.getState().activateProject({
    projectId: "project-a",
    projectRevision: 1,
    languageServiceGeneration: 1,
  });
}

class StatusTestClient implements LifecycleLanguageServiceClient {
  state: LanguageServiceClientState = "stopped";
  readonly generation = 1;
  readonly workspaceRoot = "/projects/project-a";
  readonly rootUri = "file:///projects/project-a";
  private version = 1;

  subscribe(_listener: LanguageServiceClientListener): () => void {
    return () => {};
  }

  supports(_feature: LanguageServiceFeature): boolean {
    return false;
  }

  setProjectRevision(_revision: number): void {}

  async start(
    _options: LanguageServiceClientStartOptions,
  ): Promise<void> {
    this.state = "ready";
  }

  async stop(): Promise<void> {
    this.state = "stopped";
  }

  async openDocument(
    _textDocument: TextDocumentItem,
    _projectRevision?: number,
  ): Promise<void> {}

  async replaceDocument(
    _uri: string,
    _text: string,
    _projectRevision?: number,
  ): Promise<number> {
    this.version += 1;
    return this.version;
  }

  acknowledgeDocumentRevision(
    _uri: string,
    _projectRevision?: number,
  ): void {}

  async closeDocument(_uri: string): Promise<void> {}
}

describe("LanguageServiceStatus", () => {
  it("stays quiet for non-failure readiness states", () => {
    activateProject();
    useProjectAnalysisStore.getState().setLanguageService({
      readiness: "not_run",
      reason: "Document engine details are still loading.",
    });
    render(<LanguageServiceStatus />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "unsupported",
        reason: "No language analyzer is available for this engine.",
      });
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays quiet when ready and announces synchronization", () => {
    activateProject();
    useProjectAnalysisStore.getState().setLanguageService({
      readiness: "ready",
    });
    const view = render(<LanguageServiceStatus />);
    expect(
      screen.queryByLabelText("Language analysis status"),
    ).not.toBeInTheDocument();

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "syncing",
        reason: "Synchronizing",
      });
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    view.unmount();
  });

  it("discloses TexLab policy before explicit setup and keeps retry separate", async () => {
    activateProject();
    const setup = vi.fn();
    const retry = vi.fn();
    const unregister =
      registerLanguageServiceLifecycleActions({ setup, retry });
    const user = userEvent.setup();
    render(<LanguageServiceStatus />);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        kind: "texlab",
        readiness: "setup_required",
        reason: "Install the pinned server",
      });
    });
    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    expect(setup).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Install TexLab 5.26.0?",
    });
    expect(dialog).toHaveTextContent(
      "Provide project-aware LaTeX diagnostics",
    );
    expect(dialog).toHaveTextContent(
      "manifest-pinned sizes and SHA-256 checksums",
    );
    expect(dialog).toHaveTextContent(
      "language-servers/texlab/5.26.0/<platform>/texlab[.exe]",
    );
    expect(
      screen.getByRole("link", {
        name: /GPL-3\.0-only license/u,
      }),
    ).toHaveAttribute(
      "href",
      "https://raw.githubusercontent.com/latex-lsp/texlab/v5.26.0/LICENSE",
    );
    expect(
      screen.getByRole("link", {
        name: /Pinned corresponding source/u,
      }),
    ).toHaveAttribute(
      "href",
      "https://github.com/latex-lsp/texlab/tree/v5.26.0",
    );
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute(
        "rel",
        "noopener noreferrer",
      );
    }

    await user.click(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(setup).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Install TexLab 5.26.0",
      }),
    );
    expect(setup).toHaveBeenCalledTimes(1);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "unavailable",
        reason: "Server crashed",
      });
    });
    await user.click(
      screen.getByRole("button", { name: "Retry" }),
    );
    expect(retry).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("prevents duplicate installs and leaves a failed download retryable", async () => {
    activateProject();
    let releaseInstall = () => {};
    const firstInstall = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const setup = vi
      .fn()
      .mockImplementationOnce(() => firstInstall)
      .mockRejectedValueOnce(new Error("Download interrupted"));
    const unregister =
      registerLanguageServiceLifecycleActions({
        setup,
        retry: vi.fn(),
      });
    const user = userEvent.setup();
    render(<LanguageServiceStatus />);
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        kind: "texlab",
        readiness: "setup_required",
        reason: "Install the pinned server",
      });
    });

    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    const install = screen.getByRole("button", {
      name: "Install TexLab 5.26.0",
    });
    await user.click(install);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(install).toBeDisabled();
    expect(install).toHaveTextContent("Installing TexLab…");
    await user.click(install);
    expect(setup).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseInstall();
      await firstInstall;
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Install TexLab 5.26.0",
      }),
    );
    expect(
      await screen.findByText(
        `Setup failed: ${LANGUAGE_SERVICE_SETUP_FAILURE_REASON}. You can retry.`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Retry TexLab download",
      }),
    ).toBeEnabled();
    unregister();
  });

  it("keeps the real controller setup flow open, sanitized, and retryable", async () => {
    let installed = false;
    let rejectFirstInstall = (_error: Error) => {};
    const firstInstall = new Promise<void>((_resolve, reject) => {
      rejectFirstInstall = reject;
    });
    const install = vi.fn(async () => {
      if (install.mock.calls.length === 1) {
        await firstInstall;
      }
      installed = true;
      return {
        kind: "texlab" as const,
        version: "5.26.0",
        state: "installed" as const,
      };
    });
    const controller = new LanguageServiceController({
      store: useProjectAnalysisStore,
      isAvailable: () => true,
      provisioner: {
        installStatus: async () => ({
          kind: "texlab",
          version: "5.26.0",
          state: installed ? "installed" : "missing",
        }),
        install,
      },
      createClient: () => new StatusTestClient(),
      createCoordinator: () => ({
        activateProject: () => {},
        updateProjectRevision: () => true,
        trackDocument: () => true,
        untrackDocument: () => {},
        dispose: () => {},
      }),
    });
    useFilesStore.setState({
      projectId: "project-a",
      activePath: "main.tex",
    });
    controller.update({
      projectId: "project-a",
      engineId: "latex",
      engineLoaded: true,
      mainDoc: "main.tex",
      tree: [{ path: "main.tex", is_dir: false }],
      files: { "main.tex": { content: "Paper" } },
      indexTexts: {},
      index: null,
    });
    await controller.whenIdle();
    const unregister = registerLanguageServiceLifecycleActions({
      retry: () => controller.retry(),
      setup: () => controller.setup(),
    });
    const user = userEvent.setup();
    const view = render(
      <StrictMode>
        <LanguageServiceStatus />
      </StrictMode>,
    );

    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(install).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Install TexLab 5.26.0",
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Installing TexLab…",
      }),
    ).toBeDisabled();
    await act(async () => {
      rejectFirstInstall(
        new Error(
          "signed-token=private at /Users/private/language-server",
        ),
      );
      await firstInstall.catch(() => {});
    });
    expect(
      await screen.findByText(
        `Setup failed: ${LANGUAGE_SERVICE_SETUP_FAILURE_REASON}. You can retry.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      JSON.stringify(
        useProjectAnalysisStore.getState().snapshot.languageService,
      ),
    ).not.toMatch(/signed-token|\/Users\/private/u);
    expect(document.body.textContent).not.toMatch(
      /signed-token|\/Users\/private/u,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Retry TexLab download",
      }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        useProjectAnalysisStore.getState().snapshot.languageService
          .readiness,
      ).toBe("ready");
    });
    expect(install).toHaveBeenCalledTimes(2);

    unregister();
    view.unmount();
    await controller.dispose();
  });

  it("does not publish stale dialog state after an install settles post-unmount", async () => {
    activateProject();
    let rejectInstall = (_error: Error) => {};
    const pendingInstall = new Promise<void>((_resolve, reject) => {
      rejectInstall = reject;
    });
    const unregister = registerLanguageServiceLifecycleActions({
      setup: () => pendingInstall,
      retry: vi.fn(),
    });
    useProjectAnalysisStore.getState().setLanguageService({
      kind: "texlab",
      readiness: "setup_required",
      reason: "Install the pinned server",
    });
    const user = userEvent.setup();
    const view = render(<LanguageServiceStatus />);
    await user.click(
      screen.getByRole("button", { name: "Set up" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Install TexLab 5.26.0",
      }),
    );

    view.unmount();
    useFilesStore.setState({
      projectId: "project-b",
      activePath: "main.tex",
    });
    useProjectAnalysisStore.getState().activateProject({
      projectId: "project-b",
      projectRevision: 1,
      languageServiceGeneration: 0,
    });
    useProjectAnalysisStore.getState().setLanguageService({
      kind: null,
      readiness: "unsupported",
      reason: "Replacement project has no language server.",
    });
    render(<LanguageServiceStatus />);
    await act(async () => {
      rejectInstall(
        new Error(
          "signed-token=late at /Users/private/language-server",
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /signed-token|\/Users\/private/u,
    );
    unregister();
  });

  it("surfaces BibTeX as local analysis even while the project server is ready", () => {
    activateProject();
    useFilesStore.setState({ activePath: "references.bib" });
    useProjectAnalysisStore.getState().setLanguageService({
      readiness: "ready",
    });
    render(<LanguageServiceStatus />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
