// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/proofreading/dictionary-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/dictionary-catalog")>()),
  loadDictionaryCatalog: async () => [],
}));
const disclosure = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/language-service/setup-disclosure", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/language-service/setup-disclosure")>();
  return {
    ...original,
    getLanguageServiceSetupDisclosure: (
      ...args: Parameters<typeof original.getLanguageServiceSetupDisclosure>
    ) => {
      if (disclosure.fail) {
        throw new Error("Language-server setup manifest field version is invalid");
      }
      return original.getLanguageServiceSetupDisclosure(...args);
    },
  };
});
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
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { useToastStore } from "@/store/toast";
import {
  LANGUAGE_SERVICE_RETRY_POLICY,
  LanguageServiceStatus,
} from "./LanguageServiceStatus";
import { ProjectInfoContent } from "./ProjectInfo";
import { fixRandomFraction } from "@/lib/test-utils";

const SETUP_LABEL = "Set up";
const SETUP_MESSAGE = "Language service setup required";
const UNAVAILABLE_SCOPE = "language service unavailable";
const SETUP_NOTICE = "language-service-setup";
const PROJECT_INFO_SNAPSHOT = {
  root: "/projects/project-a/main.tex",
  fileCount: 1,
  unreadable: [],
  stats: EMPTY_DOCUMENT_STATS,
  selectionWords: null,
};

beforeEach(() => {
  useToastStore.getState().reset();
  disclosure.fail = false;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: null, activePath: null });
  useProjectAnalysisStore.getState().reset();
});

function renderStatus(node = <LanguageServiceStatus />) {
  return render(
    <>
      {node}
      <ProjectInfoContent snapshot={PROJECT_INFO_SNAPSHOT} surface="source" />
    </>,
  );
}

function toasts() {
  return useToastStore.getState().toasts;
}

function setupNotice() {
  return screen.queryByTestId(SETUP_NOTICE);
}

async function openSetupFromProjectInfo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: SETUP_LABEL }));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

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
      reason: { text: "Document engine details are still loading." },
    });
    renderStatus();

    expect(toasts()).toEqual([]);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "unsupported",
        reason: {
          text: "No language analyzer is available for this engine.",
        },
      });
    });
    expect(toasts()).toEqual([]);
  });

  it("stays quiet when ready and announces synchronization", () => {
    activateProject();
    useProjectAnalysisStore.getState().setLanguageService({
      readiness: "ready",
    });
    const view = renderStatus();
    expect(toasts()).toEqual([]);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "syncing",
        reason: { text: "Synchronizing" },
      });
    });
    expect(toasts()).toEqual([]);
    view.unmount();
  });

  it("discloses TexLab policy before explicit setup from project info and never toasts", async () => {
    activateProject();
    const setup = vi.fn();
    const retry = vi.fn();
    const unregister =
      registerLanguageServiceLifecycleActions({ setup, retry });
    const user = userEvent.setup();
    renderStatus();

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        kind: "texlab",
        readiness: "setup_required",
        reason: { text: "Install the pinned server" },
      });
    });
    expect(toasts()).toEqual([]);
    expect(setupNotice()).toHaveTextContent(SETUP_MESSAGE);
    await openSetupFromProjectInfo(user);
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

    await openSetupFromProjectInfo(user);
    await user.click(
      screen.getByRole("button", {
        name: "Install TexLab 5.26.0",
      }),
    );
    expect(setup).toHaveBeenCalledTimes(1);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "unavailable",
        reason: { text: "Server crashed" },
      });
    });
    expect(toasts()).toEqual([]);
    expect(retry).not.toHaveBeenCalled();
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
    renderStatus();
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        kind: "texlab",
        readiness: "setup_required",
        reason: { text: "Install the pinned server" },
      });
    });

    await openSetupFromProjectInfo(user);
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

    await openSetupFromProjectInfo(user);
    await user.click(
      screen.getByRole("button", {
        name: "Install TexLab 5.26.0",
      }),
    );
    expect(
      await screen.findByText(
        LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
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
    const view = renderStatus(
      <StrictMode>
        <LanguageServiceStatus />
      </StrictMode>,
    );

    await openSetupFromProjectInfo(user);
    await user.click(
      screen.getByRole("button", { name: "Cancel" }),
    );
    expect(install).not.toHaveBeenCalled();

    await openSetupFromProjectInfo(user);
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
        LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
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
      reason: { text: "Install the pinned server" },
    });
    const user = userEvent.setup();
    const view = renderStatus();
    await openSetupFromProjectInfo(user);
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
      reason: { text: "Replacement project has no language server." },
    });
    renderStatus();
    await act(async () => {
      rejectInstall(
        new Error(
          "signed-token=late at /Users/private/language-server",
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toasts()).toEqual([]);
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
    renderStatus();
    expect(toasts()).toEqual([]);
  });


  it("offers TexLab setup inline for each project and never raises a toast for it", () => {
    activateProject();
    renderStatus();
    const setupRequired = {
      kind: "texlab" as const,
      readiness: "setup_required" as const,
      reason: { text: "Install the pinned server" },
    };
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(setupRequired);
    });
    expect(setupNotice()).toHaveTextContent(SETUP_MESSAGE);
    expect(toasts()).toEqual([]);

    act(() => {
      useFilesStore.setState({ activePath: "references.bib" });
    });
    expect(setupNotice()).toBeNull();
    act(() => {
      useFilesStore.setState({ activePath: "main.tex" });
    });
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        reason: { text: "Still missing" },
      });
    });
    expect(setupNotice()).toHaveTextContent(SETUP_MESSAGE);
    expect(toasts()).toEqual([]);

    act(() => {
      useFilesStore.setState({ projectId: "project-b", activePath: "main.tex" });
      useProjectAnalysisStore.getState().activateProject({
        projectId: "project-b",
        projectRevision: 1,
        languageServiceGeneration: 2,
      });
    });
    expect(setupNotice()).toBeNull();
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(setupRequired);
    });
    expect(setupNotice()).toHaveTextContent(SETUP_MESSAGE);
    expect(toasts()).toEqual([]);
  });

  it("stays silent when an engine reload or a main document rename asks for setup again", () => {
    activateProject();
    renderStatus();
    const setupRequired = {
      kind: "texlab" as const,
      readiness: "setup_required" as const,
      reason: { text: "Install the pinned server" },
    };
    for (let round = 0; round < 3; round++) {
      act(() => {
        useProjectAnalysisStore.getState().setLanguageService(setupRequired);
      });
      expect(setupNotice()).toHaveTextContent(SETUP_MESSAGE);
      act(() => {
        useProjectAnalysisStore.getState().setLanguageService({ readiness: "not_run" });
      });
      expect(setupNotice()).toBeNull();
    }
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(setupRequired);
    });
    expect(setupNotice()).toHaveTextContent(SETUP_MESSAGE);
    expect(toasts()).toEqual([]);
  });

  it("drops the setup offer when setup is no longer needed", () => {
    activateProject();
    renderStatus();
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        kind: "texlab",
        readiness: "setup_required",
        reason: { text: "Install the pinned server" },
      });
    });
    expect(setupNotice()).not.toBeNull();

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "installing",
        reason: { text: "Installing" },
      });
    });
    expect(setupNotice()).toBeNull();
    expect(toasts()).toEqual([]);
  });

  it("logs missing setup details instead of offering an action that cannot work", () => {
    disclosure.fail = true;
    activateProject();
    renderStatus();
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        kind: "texlab",
        readiness: "setup_required",
        reason: { text: "Install the pinned server" },
      });
    });

    expect(toasts()).toEqual([]);
    expect(setupNotice()).toBeNull();
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(
      "read the language service setup details",
      "Language-server setup manifest field version is invalid",
    );
  });

  it("retries an unavailable server silently with growing delays and stops when it unmounts", async () => {
    vi.useFakeTimers();
    fixRandomFraction(1);
    activateProject();
    const retry = vi.fn();
    const unregister = registerLanguageServiceLifecycleActions({
      setup: vi.fn(),
      retry,
    });
    const view = renderStatus();
    const unavailable = {
      kind: "texlab" as const,
      readiness: "unavailable" as const,
      reason: { key: "restartStopped" as const },
    };
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(unavailable);
    });
    expect(toasts()).toEqual([]);

    const first = LANGUAGE_SERVICE_RETRY_POLICY.baseMs;
    await advance(first - 1);
    expect(retry).not.toHaveBeenCalled();
    await advance(1);
    expect(retry).toHaveBeenCalledTimes(1);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({
        readiness: "starting",
      });
    });
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(unavailable);
    });
    await advance(first * 2 - 1);
    expect(retry).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(retry).toHaveBeenCalledTimes(2);

    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(
      UNAVAILABLE_SCOPE,
      "The language service repeatedly exited and automatic restart was stopped.",
    );
    expect(toasts()).toEqual([]);

    view.unmount();
    await advance(LANGUAGE_SERVICE_RETRY_POLICY.maxMs * 4);
    expect(retry).toHaveBeenCalledTimes(2);
    unregister();
  });

  it("starts the backoff over after the server recovers", async () => {
    vi.useFakeTimers();
    fixRandomFraction(1);
    activateProject();
    const retry = vi.fn();
    const unregister = registerLanguageServiceLifecycleActions({
      setup: vi.fn(),
      retry,
    });
    renderStatus();
    const unavailable = {
      kind: "texlab" as const,
      readiness: "unavailable" as const,
      reason: { key: "processExited" as const },
    };
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(unavailable);
    });
    await advance(LANGUAGE_SERVICE_RETRY_POLICY.baseMs);
    expect(retry).toHaveBeenCalledTimes(1);

    act(() => {
      useProjectAnalysisStore.getState().setLanguageService({ readiness: "ready" });
    });
    act(() => {
      useProjectAnalysisStore.getState().setLanguageService(unavailable);
    });
    await advance(LANGUAGE_SERVICE_RETRY_POLICY.baseMs);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(mocks.logError).toHaveBeenCalledTimes(2);
    unregister();
  });
});
