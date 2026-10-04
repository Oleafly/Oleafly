import { buildIndex } from "@/lib/index/build";
import {
  PROJECT_ANALYSIS_FEATURES,
} from "@/lib/analysis/project-snapshot";
import type {
  ExecuteCommandParams,
  JsonValue,
  LanguageServiceClientStartOptions,
  LanguageServiceClientEvent,
  LanguageServiceClientListener,
  LanguageServiceClientState,
  LanguageServiceFeature,
  LanguageServiceInstallStatus,
  LanguageServiceRequestOptions,
  TextDocumentItem,
  WorkspaceSymbolParams,
} from "@/lib/language-service";
import {
  getLanguageServiceRuntimeProfile,
  LanguageServiceBackendError,
  LanguageServiceClient,
  TauriLanguageServiceTransport,
} from "@/lib/language-service";
import {
  LANGUAGE_SERVICE_SETUP_FAILURE_ANALYSIS_REASON,
  LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
} from "@/lib/analysis/language-service-actions";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import { useIndexStore } from "@/store/project-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageServiceTimeoutError } from "@/lib/language-service/errors";
import {
  DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  type LanguageServiceSettingsSource,
  type TypstLanguageServiceSettings,
} from "@/lib/analysis/tinymist-configuration";
import {
  BIBTEX_LOCAL_ONLY_ANALYSIS_REASON,
  fileUriForProjectPath,
  LANGUAGE_SERVICE_DISPOSE_ANALYSIS_REASON,
  LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
  LanguageServiceController,
  languageServiceKindForEngine,
  languageServiceLanguageIdForPath,
  MARKDOWN_LOCAL_ONLY_ANALYSIS_REASON,
  type LanguageServiceProjectSnapshot,
  type LanguageServiceRestartScheduler,
  type LifecycleAnalysisCoordinator,
  type LifecycleLanguageServiceClient,
} from "./language-service-controller";

class FakeClient implements LifecycleLanguageServiceClient {
  state: LanguageServiceClientState = "stopped";
  readonly starts: LanguageServiceClientStartOptions[] = [];
  readonly opens: TextDocumentItem[] = [];
  readonly changes: Array<{
    uri: string;
    text: string;
    version: number;
  }> = [];
  readonly closes: string[] = [];
  readonly acknowledgements: Array<{
    uri: string;
    projectRevision: number;
  }> = [];
  stopCount = 0;
  stopFailures = 0;
  projectRevision = 0;
  startError: Error | null = null;
  versionSkew = 0;
  stopGate: Promise<void> | undefined;
  replaceGate: Promise<void> | undefined;
  closeGate: Promise<void> | undefined;
  saveDocument?: (uri: string) => Promise<void>;
  changeConfiguration?: (settings: JsonValue) => Promise<void>;
  supportsCommand?: (command: string) => boolean;
  executeCommand?: (
    params: ExecuteCommandParams,
    options?: Pick<LanguageServiceRequestOptions, "signal" | "timeoutMs">,
  ) => Promise<JsonValue>;
  requestWorkspaceSymbols?: (
    params: WorkspaceSymbolParams,
    options?: LanguageServiceRequestOptions,
  ) => Promise<JsonValue>;
  private readonly listeners = new Set<LanguageServiceClientListener>();
  private readonly retainedListeners: LanguageServiceClientListener[] = [];
  private readonly versions = new Map<string, number>();

  readonly workspaceRoot: string;
  readonly rootUri: string;

  constructor(
    readonly generation: number,
    readonly projectId: string,
    private readonly openGate?: Promise<void>,
    private readonly startGate?: Promise<void>,
  ) {
    this.workspaceRoot = `/projects/${projectId}`;
    this.rootUri = fileUriForProjectPath(this.workspaceRoot);
  }

  subscribe(listener: LanguageServiceClientListener): () => void {
    this.listeners.add(listener);
    this.retainedListeners.push(listener);
    return () => this.listeners.delete(listener);
  }

  supports(_feature: LanguageServiceFeature): boolean {
    return true;
  }

  setProjectRevision(revision: number): void {
    this.projectRevision = revision;
  }

  async start(
    options: LanguageServiceClientStartOptions,
  ): Promise<void> {
    this.state = "starting";
    this.starts.push(options);
    await this.startGate;
    if (this.startError) {
      this.state = "error";
      throw this.startError;
    }
    this.state = "ready";
    this.emit({
      type: "status",
      state: "ready",
      generation: this.generation,
      session: `session-${this.generation}`,
    });
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    await this.stopGate;
    if (this.stopFailures > 0) {
      this.stopFailures -= 1;
      throw new Error("native session cleanup failed");
    }
    this.state = "stopped";
  }

  async openDocument(
    textDocument: TextDocumentItem,
    projectRevision = this.projectRevision,
  ): Promise<void> {
    await this.openGate;
    this.projectRevision = projectRevision;
    this.opens.push({ ...textDocument });
    this.versions.set(textDocument.uri, textDocument.version);
  }

  async replaceDocument(
    uri: string,
    text: string,
    projectRevision = this.projectRevision,
  ): Promise<number> {
    await this.replaceGate;
    this.projectRevision = projectRevision;
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.changes.push({ uri, text, version });
    return version + this.versionSkew;
  }

  acknowledgeDocumentRevision(
    _uri: string,
    projectRevision = this.projectRevision,
  ): void {
    this.projectRevision = projectRevision;
    this.acknowledgements.push({ uri: _uri, projectRevision });
  }

  async closeDocument(uri: string): Promise<void> {
    await this.closeGate;
    this.closes.push(uri);
    this.versions.delete(uri);
  }

  exitUnexpectedly(message = "crashed"): void {
    this.state = "exited";
    this.emit({
      type: "status",
      state: "exited",
      generation: this.generation,
      session: `session-${this.generation}`,
      error: new Error(message),
    });
  }

  emitRetained(event: LanguageServiceClientEvent): void {
    for (const listener of this.retainedListeners) listener(event);
  }

  private emit(event: LanguageServiceClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeCoordinator implements LifecycleAnalysisCoordinator {
  constructor(
    private readonly client: LifecycleLanguageServiceClient,
    private readonly store: ReturnType<typeof createProjectAnalysisStore>,
  ) {}

  activateProject(project: {
    projectId: string;
    projectRevision: number;
  }): void {
    this.client.setProjectRevision(project.projectRevision);
    this.store.getState().activateProject({
      ...project,
      languageServiceGeneration: this.client.generation,
    });
    for (const feature of PROJECT_ANALYSIS_FEATURES) {
      this.store
        .getState()
        .markFeatureNotRun(feature, { key: "supportedNotRun" });
    }
  }

  updateProjectRevision(revision: number): boolean {
    this.client.setProjectRevision(revision);
    return this.store.getState().setProjectRevision(revision);
  }

  trackDocument(uri: string, version: number): boolean {
    return this.store.getState().setDocumentVersion(uri, version);
  }

  untrackDocument(uri: string): void {
    this.store.getState().removeDocument(uri);
  }

  dispose(): void {}
}

class FakeScheduler implements LanguageServiceRestartScheduler {
  readonly delays: number[] = [];
  private readonly jobs: Array<{
    callback: () => void;
    cancelled: boolean;
    delayMs: number;
  }> = [];

  setTimeout(callback: () => void, delayMs: number): unknown {
    this.delays.push(delayMs);
    const job = { callback, cancelled: false, delayMs };
    this.jobs.push(job);
    return job;
  }

  clearTimeout(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }

  get pending(): number {
    return this.jobs.filter((job) => !job.cancelled).length;
  }

  get pendingDelays(): number[] {
    return this.jobs
      .filter((job) => !job.cancelled)
      .map((job) => job.delayMs);
  }

  runDelay(delayMs: number): void {
    const job = this.jobs.find(
      (candidate) => !candidate.cancelled && candidate.delayMs === delayMs,
    );
    if (!job) throw new Error(`No scheduled job after ${delayMs} ms`);
    job.cancelled = true;
    job.callback();
  }

  runNext(): void {
    const job = this.jobs.find((candidate) => !candidate.cancelled);
    if (!job) throw new Error("No scheduled restart");
    job.cancelled = true;
    job.callback();
  }
}

function snapshot(
  overrides: Partial<LanguageServiceProjectSnapshot> = {},
): LanguageServiceProjectSnapshot {
  const files = {
    "main.tex": { content: "\\input{chapter}" },
    "chapter.tex": { content: "First" },
    "refs.bib": { content: "@book{one}" },
  };
  return {
    projectId: "project-a",
    engineId: "latex",
    engineLoaded: true,
    mainDoc: "main.tex",
    tree: Object.keys(files).map((path) => ({ path, is_dir: false })),
    files,
    indexTexts: {},
    index: buildIndex(
      Object.fromEntries(
        Object.entries(files).map(([path, file]) => [path, file.content]),
      ),
    ),
    ...overrides,
  };
}

function harness(
  overrides: {
    available?: boolean;
    scheduler?: FakeScheduler;
    restartBaseDelayMs?: number;
    restartMaxDelayMs?: number;
    maxRestartAttempts?: number;
    restartStableWindowMs?: number;
    installState?: "installed" | "missing" | "installing" | "failed";
    deferOpen?: boolean;
    deferStart?: boolean;
    isAvailable?: () => boolean;
    configureClient?: (client: FakeClient) => void;
    defaultCoordinator?: boolean;
    settings?: LanguageServiceSettingsSource;
  } = {},
) {
  const store = createProjectAnalysisStore();
  const clients: FakeClient[] = [];
  let currentInstallState =
    overrides.installState ?? ("installed" as const);
  let releaseOpen = () => {};
  const openGate = overrides.deferOpen
    ? new Promise<void>((resolve) => {
        releaseOpen = resolve;
      })
    : undefined;
  let releaseStart = () => {};
  const startGate = overrides.deferStart
    ? new Promise<void>((resolve) => {
        releaseStart = resolve;
      })
    : undefined;
  const installStatus = vi.fn(
    async (
      kind: "texlab" | "tinymist",
    ): Promise<LanguageServiceInstallStatus> => ({
      kind,
      version: getLanguageServiceRuntimeProfile(kind).version,
      state: currentInstallState,
    }),
  );
  const install = vi.fn(async (kind: "texlab" | "tinymist") => {
    currentInstallState = "installed";
    return {
      kind,
      version: getLanguageServiceRuntimeProfile(kind).version,
      state: "installed" as const,
    };
  });
  const controller = new LanguageServiceController({
    store,
    isAvailable:
      overrides.isAvailable ?? (() => overrides.available ?? true),
    provisioner: { installStatus, install },
    createClient: (_kind, projectId) => {
      const client = new FakeClient(
        clients.length + 1,
        projectId,
        openGate,
        startGate,
      );
      overrides.configureClient?.(client);
      clients.push(client);
      return client;
    },
    ...(overrides.defaultCoordinator
      ? {}
      : {
          createCoordinator: (
            client: LifecycleLanguageServiceClient,
            targetStore: ReturnType<typeof createProjectAnalysisStore>,
          ) => new FakeCoordinator(client, targetStore),
        }),
    ...(overrides.settings ? { settings: overrides.settings } : {}),
    ...(overrides.scheduler
      ? { scheduler: overrides.scheduler }
      : {}),
    ...(overrides.restartBaseDelayMs === undefined
      ? {}
      : { restartBaseDelayMs: overrides.restartBaseDelayMs }),
    ...(overrides.restartMaxDelayMs === undefined
      ? {}
      : { restartMaxDelayMs: overrides.restartMaxDelayMs }),
    ...(overrides.maxRestartAttempts === undefined
      ? {}
      : { maxRestartAttempts: overrides.maxRestartAttempts }),
    ...(overrides.restartStableWindowMs === undefined
      ? {}
      : {
          restartStableWindowMs:
            overrides.restartStableWindowMs,
        }),
  });
  return {
    controller,
    store,
    clients,
    installStatus,
    install,
    releaseOpen,
    releaseStart,
  };
}

describe("language-service lifecycle routing", () => {
  it("maps only LaTeX and Typst engines and keeps BibTeX local", () => {
    expect(languageServiceKindForEngine("latex")).toBe("texlab");
    expect(languageServiceKindForEngine("typst")).toBe("tinymist");
    expect(languageServiceKindForEngine("markdown")).toBeNull();
    expect(languageServiceKindForEngine("unknown")).toBeNull();
    expect(
      languageServiceLanguageIdForPath("texlab", "paper.cls"),
    ).toBe("latex");
    expect(
      languageServiceLanguageIdForPath("texlab", "refs.bib"),
    ).toBeNull();
    expect(
      languageServiceLanguageIdForPath("tinymist", "main.typ"),
    ).toBe("typst");
  });

  it("creates file URIs without leaking unescaped project paths", () => {
    expect(fileUriForProjectPath("/Project Files/paper", "a b.tex")).toBe(
      "file:///Project%20Files/paper/a%20b.tex",
    );
    expect(fileUriForProjectPath("C:\\Papers", "main.typ")).toBe(
      "file:///C:/Papers/main.typ",
    );
  });
});

describe("LanguageServiceController", () => {
  it("does not advertise ready before the initial documents finish syncing", async () => {
    const { controller, store, clients, releaseOpen } = harness({
      deferOpen: true,
    });
    controller.update(snapshot());
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("syncing");
    });

    releaseOpen();
    await controller.whenIdle();
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("ready");
  });

  it("cannot publish stale document sync after a project switch", async () => {
    const { controller, store, clients, releaseOpen } = harness({
      deferOpen: true,
    });
    controller.update(snapshot());
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("syncing");
    });

    controller.update(
      snapshot({
        projectId: "project-b",
        tree: [{ path: "main.tex", is_dir: false }],
        files: { "main.tex": { content: "project b" } },
      }),
    );
    releaseOpen();
    await controller.whenIdle();

    expect(clients).toHaveLength(2);
    expect(store.getState().snapshot.identity.projectId).toBe(
      "project-b",
    );
    expect(
      Object.keys(store.getState().snapshot.documents),
    ).toEqual(["file:///projects/project-b/main.tex"]);
  });

  it("coalesces repeated semantic edits while the initial server start is pending", async () => {
    const { controller, store, clients, releaseStart } = harness({
      deferStart: true,
    });
    const initial = snapshot();
    const readyRevisions: number[] = [];
    const unsubscribe = store.subscribe((state) => {
      if (state.snapshot.languageService.readiness === "ready") {
        readyRevisions.push(state.snapshot.identity.projectRevision);
      }
    });
    controller.update(initial);
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(clients[0].starts).toHaveLength(1);
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("starting");
    });

    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Second" },
      },
    });
    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Latest" },
      },
    });
    releaseStart();
    await controller.whenIdle();
    unsubscribe();

    expect(clients).toHaveLength(1);
    expect(clients[0].starts).toHaveLength(1);
    expect(clients[0].stopCount).toBe(0);
    expect(
      clients[0].opens.find(
        (document) =>
          document.uri ===
          "file:///projects/project-a/chapter.tex",
      )?.text,
    ).toBe("Latest");
    expect(readyRevisions).toEqual([3]);
  });

  it("keeps an immutable sync attempt and applies only the newest queued edit before ready", async () => {
    const { controller, store, clients, releaseOpen } = harness({
      deferOpen: true,
    });
    const initial = snapshot();
    const readyRevisions: number[] = [];
    const unsubscribe = store.subscribe((state) => {
      if (state.snapshot.languageService.readiness === "ready") {
        readyRevisions.push(state.snapshot.identity.projectRevision);
      }
    });
    controller.update(initial);
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("syncing");
    });

    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Second" },
      },
    });
    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Latest" },
      },
    });
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("syncing");

    releaseOpen();
    await controller.whenIdle();
    unsubscribe();

    expect(clients).toHaveLength(1);
    expect(clients[0].starts).toHaveLength(1);
    expect(clients[0].stopCount).toBe(0);
    expect(
      clients[0].opens.find(
        (document) =>
          document.uri ===
          "file:///projects/project-a/chapter.tex",
      )?.text,
    ).toBe("Latest");
    expect(
      clients[0].acknowledgements.every(
        ({ projectRevision }) => projectRevision === 3,
      ),
    ).toBe(true);
    expect(readyRevisions).toEqual([3]);
  });

  it("detaches synchronously on project close so late exits cannot repopulate the reset store", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients, releaseOpen } = harness({
      deferOpen: true,
      scheduler,
    });
    controller.update(snapshot());
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("syncing");
    });

    controller.update(snapshot({ projectId: null }));
    clients[0].emitRetained({
      type: "status",
      state: "exited",
      generation: clients[0].generation,
      session: `session-${clients[0].generation}`,
      error: new Error("late event after project close"),
    });
    expect(store.getState().snapshot.identity.projectId).toBeNull();
    expect(scheduler.pending).toBe(0);

    releaseOpen();
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectId).toBeNull();
    expect(scheduler.pending).toBe(0);
    expect(clients[0].stopCount).toBe(1);

    controller.update(
      snapshot({
        projectId: "project-b",
        tree: [{ path: "main.tex", is_dir: false }],
        files: { "main.tex": { content: "replacement" } },
        indexTexts: {},
        index: buildIndex({ "main.tex": "replacement" }),
      }),
    );
    await controller.whenIdle();
    expect(clients).toHaveLength(2);
    expect(store.getState().snapshot.identity.projectId).toBe(
      "project-b",
    );
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("ready");
  });

  it("starts once, opens relevant buffers, and sends monotonic full changes", async () => {
    const { controller, store, clients } = harness();
    const initial = snapshot();
    controller.update(initial);
    controller.update(initial);
    await controller.whenIdle();

    expect(clients).toHaveLength(1);
    expect(clients[0].starts).toEqual([
      expect.objectContaining({
        runtimeProfile: expect.objectContaining({
          kind: "texlab",
        }),
      }),
    ]);
    expect(clients[0].opens.map((item) => item.uri)).toEqual([
      "file:///projects/project-a/main.tex",
      "file:///projects/project-a/chapter.tex",
    ]);
    expect(clients[0].opens.every((item) => item.version === 1)).toBe(
      true,
    );
    expect(
      Object.values(store.getState().snapshot.documents).find(
        (document) =>
          document.reason === BIBTEX_LOCAL_ONLY_ANALYSIS_REASON,
      ),
    ).toMatchObject({
      analysis: "local_only",
      status: "not_run",
      version: 1,
    });

    controller.update(
      snapshot({
        tree: initial.tree,
        files: {
          ...initial.files,
          "chapter.tex": { content: "Unsaved second draft", dirty: true },
        },
      }),
    );
    await controller.whenIdle();
    expect(clients[0].changes).toEqual([
      {
        uri: "file:///projects/project-a/chapter.tex",
        text: "Unsaved second draft",
        version: 2,
      },
    ]);
    expect(clients[0].acknowledgements).toContainEqual({
      uri: "file:///projects/project-a/main.tex",
      projectRevision: 2,
    });
    expect(store.getState().snapshot.identity.projectRevision).toBe(2);

    const sameText = snapshot({
      tree: initial.tree,
      files: {
        ...initial.files,
        "chapter.tex": {
          content: "Unsaved second draft",
          dirty: false,
        },
      },
    });
    controller.update(sameText);
    await controller.whenIdle();
    expect(clients[0].changes).toHaveLength(1);
    expect(store.getState().snapshot.identity.projectRevision).toBe(2);
  });

  it("ignores semantic tree clones and advances revision for real tree, main, include, and bibliography changes", async () => {
    const { controller, store } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(1);

    controller.update({
      ...initial,
      tree: [...initial.tree].reverse(),
    });
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(1);

    const changedTree = {
      ...initial,
      tree: [
        ...initial.tree,
        { path: "appendix.tex", is_dir: false },
      ],
      files: {
        ...initial.files,
        "appendix.tex": { content: "Appendix" },
      },
    };
    controller.update(changedTree);
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(2);

    const renamedMain = {
      ...changedTree,
      mainDoc: "chapter.tex",
    };
    controller.update(renamedMain);
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(3);

    controller.update({
      ...renamedMain,
      files: {
        ...renamedMain.files,
        "chapter.tex": { content: "Changed include" },
        "refs.bib": { content: "@book{two}" },
      },
    });
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(4);
    const bib = Object.values(
      store.getState().snapshot.documents,
    ).find(
      (document) =>
        document.reason === BIBTEX_LOCAL_ONLY_ANALYSIS_REASON,
    );
    expect(bib?.version).toBe(2);
  });

  it("closes removed documents and closes/stops the old session on project switch", async () => {
    const { controller, clients } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();

    controller.update(
      snapshot({
        tree: initial.tree.filter(
          (entry) => entry.path !== "chapter.tex",
        ),
        files: {
          "main.tex": initial.files["main.tex"],
          "refs.bib": initial.files["refs.bib"],
        },
      }),
    );
    await controller.whenIdle();
    expect(clients[0].closes).toContain(
      "file:///projects/project-a/chapter.tex",
    );

    controller.update(
      snapshot({
        projectId: "project-b",
        engineId: "typst",
        mainDoc: "main.typ",
        tree: [{ path: "main.typ", is_dir: false }],
        files: { "main.typ": { content: "= Paper" } },
        index: buildIndex({ "main.typ": "= Paper" }),
      }),
    );
    await controller.whenIdle();
    expect(clients).toHaveLength(2);
    expect(clients[0].closes).toContain(
      "file:///projects/project-a/main.tex",
    );
    expect(clients[0].stopCount).toBe(1);
    expect(clients[1].opens[0]).toMatchObject({
      uri: "file:///projects/project-b/main.typ",
      languageId: "typst",
    });
  });

  it("ignores retained events from an old project session", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    controller.update(snapshot());
    await controller.whenIdle();
    const old = clients[0];

    controller.update(
      snapshot({
        projectId: "project-b",
        tree: [{ path: "main.tex", is_dir: false }],
        files: { "main.tex": { content: "new project" } },
      }),
    );
    old.emitRetained({
      type: "status",
      state: "exited",
      generation: old.generation,
      session: `session-${old.generation}`,
      error: new Error("late old-session event"),
    });
    await controller.whenIdle();

    expect(scheduler.pending).toBe(1);
    expect(scheduler.delays).not.toContain(250);
    expect(store.getState().snapshot.identity.projectId).toBe(
      "project-b",
    );
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("ready");
  });

  it("degrades visibly without native IPC and still publishes the local index", async () => {
    const { controller, store, clients, installStatus } = harness({
      available: false,
    });
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients).toHaveLength(0);
    expect(installStatus).not.toHaveBeenCalled();
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      failure: { retryable: false },
    });
    expect(store.getState().snapshot.features.hover.status).toBe(
      "unavailable",
    );
    expect(store.getState().snapshot.projectIndex.status).toBe(
      "success",
    );
  });

  it("marks Markdown as explicit local-only analysis", async () => {
    const { controller, store, clients } = harness();
    controller.update(
      snapshot({
        engineId: "markdown",
        mainDoc: "main.md",
        tree: [{ path: "main.md", is_dir: false }],
        files: { "main.md": { content: "# Paper" } },
        index: buildIndex({ "main.md": "# Paper" }),
      }),
    );
    await controller.whenIdle();

    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "local_only",
      reason: MARKDOWN_LOCAL_ONLY_ANALYSIS_REASON,
    });
    expect(store.getState().snapshot.features.completion.status).toBe(
      "unsupported",
    );
    expect(
      Object.values(store.getState().snapshot.documents)[0],
    ).toMatchObject({
      analysis: "local_only",
      status: "not_run",
      reason: MARKDOWN_LOCAL_ONLY_ANALYSIS_REASON,
    });
  });

  it("exposes setup-required and starts only after explicit installation", async () => {
    const { controller, store, clients, install } = harness({
      installState: "missing",
    });
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "setup_required",
      failure: { code: "sidecar_setup_required" },
    });

    await controller.setup();
    expect(install).toHaveBeenCalledWith("texlab");
    expect(clients).toHaveLength(1);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "ready",
    );
  });

  it("rejects failed setup with a stable safe message and keeps retry available", async () => {
    const { controller, store, clients, install } = harness({
      installState: "missing",
    });
    controller.update(snapshot());
    await controller.whenIdle();
    install.mockRejectedValueOnce(
      new Error(
        "signed-token=private at /Users/private/language-server",
      ),
    );

    await expect(controller.setup()).rejects.toThrow(
      LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
    );
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "setup_required",
      reason: LANGUAGE_SERVICE_SETUP_FAILURE_ANALYSIS_REASON,
      failure: {
        message: LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
        retryable: true,
      },
    });
    expect(
      JSON.stringify(store.getState().snapshot.languageService),
    ).not.toMatch(/signed-token|\/Users\/private/u);
    expect(clients).toHaveLength(0);

    await expect(controller.setup()).resolves.toBeUndefined();
    expect(install).toHaveBeenCalledTimes(2);
    expect(clients).toHaveLength(1);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "ready",
    );
  });

  it("uses capped deterministic exponential restart delays without duplicate timers", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({
      scheduler,
      restartBaseDelayMs: 10,
      restartMaxDelayMs: 40,
      maxRestartAttempts: 3,
    });
    controller.update(snapshot());
    await controller.whenIdle();

    for (const expectedDelay of [10, 20, 40]) {
      const current = clients.at(-1);
      if (!current) throw new Error("Expected active client");
      current.exitUnexpectedly();
      current.exitUnexpectedly("duplicate exit");
      expect(scheduler.pending).toBe(1);
      expect(scheduler.delays.at(-1)).toBe(expectedDelay);
      scheduler.runNext();
      await controller.whenIdle();
    }
    expect(clients).toHaveLength(4);

    clients.at(-1)?.exitUnexpectedly("final crash");
    expect(scheduler.pending).toBe(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      restartAttempt: 3,
      failure: { retryable: false },
    });

    controller.retry();
    await controller.whenIdle();
    expect(clients).toHaveLength(5);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "ready",
      restartAttempt: 0,
    });
  });

  it("resets consecutive crash attempts only after the stable window", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({
      scheduler,
      restartBaseDelayMs: 10,
      restartMaxDelayMs: 40,
      maxRestartAttempts: 3,
      restartStableWindowMs: 100,
    });
    controller.update(snapshot());
    await controller.whenIdle();

    clients[0].exitUnexpectedly();
    scheduler.runNext();
    await controller.whenIdle();
    expect(
      store.getState().snapshot.languageService.restartAttempt,
    ).toBe(1);

    scheduler.runNext();
    expect(
      store.getState().snapshot.languageService.restartAttempt,
    ).toBe(0);

    clients.at(-1)?.exitUnexpectedly();
    expect(scheduler.delays.at(-1)).toBe(10);
  });

  it("does not create duplicate sessions for repeated identical updates", async () => {
    const { controller, clients, installStatus } = harness();
    const current = snapshot();
    for (let index = 0; index < 8; index += 1) {
      controller.update(current);
    }
    await controller.whenIdle();
    expect(clients).toHaveLength(1);
    expect(clients[0].starts).toHaveLength(1);
    expect(installStatus).toHaveBeenCalledTimes(1);
  });

  it("publishes index metadata without resyncing for dirty/save and rebuild noise", async () => {
    const { controller, store, clients, installStatus } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const readiness: string[] = [];
    const unsubscribe = store.subscribe((state) => {
      readiness.push(state.snapshot.languageService.readiness);
    });

    controller.update({
      ...initial,
      files: Object.fromEntries(
        Object.entries(initial.files).map(([path, file]) => [
          path,
          { ...file, dirty: true },
        ]),
      ),
      indexTexts: { ...initial.indexTexts },
      index: buildIndex(
        Object.fromEntries(
          Object.entries(initial.files).map(([path, file]) => [
            path,
            file.content,
          ]),
        ),
      ),
      indexBuilding: true,
    });
    await controller.whenIdle();
    unsubscribe();

    expect(clients).toHaveLength(1);
    expect(clients[0].starts).toHaveLength(1);
    expect(clients[0].stopCount).toBe(0);
    expect(clients[0].opens).toHaveLength(2);
    expect(clients[0].changes).toHaveLength(0);
    expect(installStatus).toHaveBeenCalledTimes(1);
    expect(readiness.length).toBeGreaterThan(0);
    expect(readiness.every((value) => value === "ready")).toBe(true);
    expect(store.getState().snapshot.projectIndex.status).toBe(
      "partial",
    );
  });

  it("does not supersede in-flight synchronization for non-semantic file noise", async () => {
    const { controller, store, clients, releaseOpen } = harness({
      deferOpen: true,
    });
    const initial = snapshot();
    controller.update(initial);
    await vi.waitFor(() => {
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("syncing");
    });

    controller.update({
      ...initial,
      files: Object.fromEntries(
        Object.entries(initial.files).map(([path, file]) => [
          path,
          { ...file, dirty: true },
        ]),
      ),
      indexBuilding: true,
    });
    releaseOpen();
    await controller.whenIdle();

    expect(clients).toHaveLength(1);
    expect(clients[0].stopCount).toBe(0);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "ready",
    );
  });

  it("reconciles an engineLoaded transition even when all object inputs are unchanged", async () => {
    const { controller, store, clients } = harness();
    const loading = snapshot({ engineLoaded: false });
    controller.update(loading);
    await controller.whenIdle();
    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "not_run",
    );

    controller.update({ ...loading, engineLoaded: true });
    await controller.whenIdle();
    expect(clients).toHaveLength(1);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "ready",
    );
  });

  it("treats engine unload during deferred start as a cancellation boundary", async () => {
    const { controller, store, clients, releaseStart } = harness({
      deferStart: true,
    });
    const initial = snapshot();
    const readyRevisions: number[] = [];
    const unsubscribe = store.subscribe((state) => {
      if (state.snapshot.languageService.readiness === "ready") {
        readyRevisions.push(state.snapshot.identity.projectRevision);
      }
    });
    controller.update(initial);
    await vi.waitFor(() => {
      expect(clients).toHaveLength(1);
      expect(
        store.getState().snapshot.languageService.readiness,
      ).toBe("starting");
    });

    controller.update({ ...initial, engineLoaded: false });
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("not_run");
    clients[0].emitRetained({
      type: "status",
      state: "exited",
      generation: clients[0].generation,
      session: `session-${clients[0].generation}`,
      error: new Error("late event after engine unload"),
    });
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("not_run");
    releaseStart();
    await controller.whenIdle();
    unsubscribe();

    expect(readyRevisions).toEqual([]);
    expect(clients).toHaveLength(1);
    expect(clients[0].stopCount).toBe(1);
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("not_run");
  });

  it("closes documents and stops on disposal", async () => {
    const { controller, store, clients } = harness();
    controller.update(snapshot());
    await controller.whenIdle();
    await controller.dispose();
    expect(clients[0].closes).toEqual([
      "file:///projects/project-a/main.tex",
      "file:///projects/project-a/chapter.tex",
    ]);
    expect(clients[0].stopCount).toBe(1);
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("stopped");
  });

  it("propagates a sanitized disposal failure after bounded native cleanup retries", async () => {
    const { controller, clients } = harness();
    controller.update(snapshot());
    await controller.whenIdle();
    clients[0].stopFailures = 2;

    const disposal = controller.dispose();
    await expect(disposal).rejects.toThrow(
      LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
    );
    await disposal.catch((error: unknown) => {
      expect(String(error)).not.toContain("native session cleanup failed");
      expect(String(error)).not.toContain("/projects/project-a");
    });
    expect(clients[0].stopCount).toBe(2);
  });

  it("retains failed cleanup ownership and retries only after an explicit retry", async () => {
    const { controller, store, clients } = harness();
    controller.update(snapshot());
    await controller.whenIdle();
    clients[0].stopFailures = 2;

    controller.update(
      snapshot({
        projectId: "project-b",
        files: {
          "main.tex": { content: "Replacement project" },
        },
        tree: [{ path: "main.tex", is_dir: false }],
        indexTexts: {},
        index: buildIndex({
          "main.tex": "Replacement project",
        }),
      }),
    );
    await controller.whenIdle();

    expect(clients).toHaveLength(1);
    expect(clients[0].stopCount).toBe(2);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      failure: {
        message: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
        retryable: true,
      },
    });

    controller.update(
      snapshot({
        projectId: "project-b",
        files: {
          "main.tex": { content: "Latest replacement project" },
        },
        tree: [{ path: "main.tex", is_dir: false }],
        indexTexts: {},
        index: buildIndex({
          "main.tex": "Latest replacement project",
        }),
      }),
    );
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(2);
    expect(clients).toHaveLength(1);

    controller.retry();
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(3);
    expect(clients).toHaveLength(2);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "ready",
    );
  });

  it("surfaces retained cleanup failure after close and recovers the next project on explicit retry", async () => {
    const { controller, store, clients } = harness();
    controller.update(snapshot());
    await controller.whenIdle();
    clients[0].stopFailures = 2;

    controller.update(snapshot({ projectId: null }));
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(2);
    expect(store.getState().snapshot.identity.projectId).toBeNull();

    controller.update(
      snapshot({
        projectId: "project-b",
        tree: [{ path: "main.tex", is_dir: false }],
        files: { "main.tex": { content: "replacement" } },
        indexTexts: {},
        index: buildIndex({ "main.tex": "replacement" }),
      }),
    );
    await controller.whenIdle();
    expect(clients).toHaveLength(1);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: LANGUAGE_SERVICE_DISPOSE_ANALYSIS_REASON,
      failure: {
        message: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
        retryable: true,
      },
    });
    expect(
      JSON.stringify(store.getState().snapshot.languageService),
    ).not.toMatch(/native session cleanup failed|\/projects\/project-a/u);

    controller.retry();
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(3);
    expect(clients).toHaveLength(2);
    expect(clients[1].starts).toHaveLength(1);
    expect(store.getState().snapshot.identity.projectId).toBe(
      "project-b",
    );
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("ready");
  });

  it("surfaces restart cleanup failure and recovers without an orphan timer", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    controller.update(snapshot());
    await controller.whenIdle();
    clients[0].stopFailures = 2;
    clients[0].exitUnexpectedly();
    expect(scheduler.pending).toBe(1);

    scheduler.runNext();
    await controller.whenIdle();
    expect(clients).toHaveLength(1);
    expect(clients[0].stopCount).toBe(2);
    expect(scheduler.pending).toBe(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: LANGUAGE_SERVICE_DISPOSE_ANALYSIS_REASON,
      failure: {
        message: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
        retryable: true,
      },
    });

    controller.retry();
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(3);
    expect(clients).toHaveLength(2);
    expect(clients[1].starts).toHaveLength(1);
    expect(
      store.getState().snapshot.languageService.readiness,
    ).toBe("ready");
  });

  it("retains a transport-owned malformed-start session through client and controller cleanup", async () => {
    const store = createProjectAnalysisStore();
    let nativeActive = false;
    let startCount = 0;
    let stopFailures = 4;
    let stopCount = 0;
    let createdClients = 0;
    let activeChannel:
      | { onmessage: (message: unknown) => void }
      | null = null;
    let activeSession:
      | {
          session: string;
          kind: "texlab";
          generation: number;
          projectId: string;
          workspaceRoot: string;
        }
      | null = null;
    let eventSequence = 1;

    const invoke = async <T>(
      command:
        | "language_service_start"
        | "language_service_send"
        | "language_service_stop"
        | "language_service_status"
        | "language_service_install"
        | "language_service_install_status",
      args: Record<string, unknown>,
    ): Promise<T> => {
      const request = args.request as Record<string, unknown>;
      if (command === "language_service_start") {
        if (nativeActive) {
          throw new Error(
            "exclusive native language-service session is still active",
          );
        }
        nativeActive = true;
        startCount += 1;
        activeChannel = args.onEvent as {
          onmessage: (message: unknown) => void;
        };
        activeSession = {
          session: `ls_${startCount.toString(16).padStart(32, "0")}`,
          kind: "texlab",
          generation: startCount,
          projectId: String(request.projectId),
          workspaceRoot: `/projects/${String(request.projectId)}`,
        };
        if (startCount === 1) {
          // The native process exists, but the runtime DTO is missing its root.
          return {
            session: activeSession.session,
            kind: activeSession.kind,
            generation: activeSession.generation,
            projectId: activeSession.projectId,
            status: "running",
          } as T;
        }
        activeChannel.onmessage({
          ...activeSession,
          sequence: eventSequence++,
          event: "started",
        });
        return { ...activeSession, status: "running" } as T;
      }
      if (command === "language_service_stop") {
        stopCount += 1;
        if (stopFailures > 0) {
          stopFailures -= 1;
          throw new Error("bounded native cleanup failure");
        }
        const stopped = activeSession;
        if (!stopped) throw new Error("missing native test session");
        nativeActive = false;
        return {
          session: stopped.session,
          kind: stopped.kind,
          generation: stopped.generation,
          status: "stopped",
          alreadyStopped: false,
        } as T;
      }
      if (command === "language_service_send") {
        const current = activeSession;
        const channel = activeChannel;
        if (!current || !channel) {
          throw new Error("missing active native test session");
        }
        const message = request.message as Record<string, unknown>;
        if (Object.hasOwn(message, "id")) {
          channel.onmessage({
            session: current.session,
            kind: current.kind,
            generation: current.generation,
            sequence: eventSequence++,
            event: "message",
            message: {
              jsonrpc: "2.0",
              id: message.id,
              result:
                message.method === "initialize"
                  ? {
                      capabilities: {
                        textDocumentSync: {
                          openClose: true,
                          change: 2,
                        },
                      },
                    }
                  : message.method === "shutdown"
                    ? null
                    : [],
            },
          });
        }
        return {
          session: current.session,
          kind: current.kind,
          generation: current.generation,
          accepted: true,
          messageBytes: 1,
        } as T;
      }
      throw new Error(`unexpected language-service command ${command}`);
    };

    const controller = new LanguageServiceController({
      store,
      isAvailable: () => true,
      provisioner: {
        installStatus: async () => ({
          kind: "texlab",
          version: "5.26.0",
          state: "installed",
        }),
        install: async () => ({
          kind: "texlab",
          version: "5.26.0",
          state: "already_installed",
        }),
      },
      createClient: (kind, projectId) => {
        createdClients += 1;
        return new LanguageServiceClient({
          kind,
          projectId,
          transport: new TauriLanguageServiceTransport({
            invoke,
            channelFactory: <T>(
              onmessage: (message: T) => void,
            ) => ({ onmessage }),
          }),
        });
      },
    });

    controller.update(snapshot());
    await controller.whenIdle();
    expect(startCount).toBe(1);
    expect(stopCount).toBe(4);
    expect(nativeActive).toBe(true);
    expect(createdClients).toBe(1);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "unavailable",
    );

    controller.retry();
    await controller.whenIdle();
    expect(stopCount).toBe(5);
    expect(startCount).toBe(2);
    expect(createdClients).toBe(2);
    expect(nativeActive).toBe(true);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "ready",
    );

    await controller.dispose();
    expect(nativeActive).toBe(false);
  });
});

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function projectB(): LanguageServiceProjectSnapshot {
  return snapshot({
    projectId: "project-b",
    tree: [{ path: "main.tex", is_dir: false }],
    files: { "main.tex": { content: "project b" } },
    index: buildIndex({ "main.tex": "project b" }),
  });
}

function typstProject(
  overrides: Partial<LanguageServiceProjectSnapshot> = {},
): LanguageServiceProjectSnapshot {
  return snapshot({
    engineId: "typst",
    mainDoc: "main.typ",
    tree: [{ path: "main.typ", is_dir: false }],
    files: { "main.typ": { content: "= Paper\n" } },
    index: null,
    ...overrides,
  });
}

function settingsSource() {
  let current: TypstLanguageServiceSettings = {
    ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  };
  const listeners = new Set<() => void>();
  const source: LanguageServiceSettingsSource = {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    set(next: Partial<TypstLanguageServiceSettings>) {
      current = { ...current, ...next };
      for (const listener of listeners) listener();
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

const CHAPTER_URI = "file:///projects/project-a/chapter.tex";

describe("LanguageServiceController inputs", () => {
  it.each([
    { restartBaseDelayMs: -1 },
    { restartBaseDelayMs: 100, restartMaxDelayMs: 50 },
    { maxRestartAttempts: 1.5 },
    { maxRestartAttempts: -1 },
    { restartStableWindowMs: Number.POSITIVE_INFINITY },
    { restartStableWindowMs: -1 },
  ])("rejects the restart policy %o", (policy) => {
    expect(
      () =>
        new LanguageServiceController({
          store: createProjectAnalysisStore(),
          isAvailable: () => true,
          provisioner: { installStatus: vi.fn(), install: vi.fn() },
          ...policy,
        }),
    ).toThrow(RangeError);
  });

  it("syncs index-only sources while the project tree is still empty", async () => {
    const { controller, clients } = harness();
    controller.update(
      snapshot({ tree: [], indexTexts: { "notes.tex": "Indexed notes" } }),
    );
    await controller.whenIdle();
    expect(
      Object.fromEntries(
        clients[0].opens.map((document) => [document.uri, document.text]),
      ),
    ).toEqual({
      "file:///projects/project-a/notes.tex": "Indexed notes",
      "file:///projects/project-a/main.tex": "\\input{chapter}",
      [CHAPTER_URI]: "First",
    });
  });

  it("ignores directories and index texts outside the tree and prefers open buffers", async () => {
    const { controller, clients } = harness();
    const base = snapshot();
    controller.update({
      ...base,
      tree: [{ path: "figures", is_dir: true }, ...base.tree],
      files: {
        ...base.files,
        "scratch.tex": { content: "Buffer for a file outside the tree" },
      },
      indexTexts: {
        "orphan.tex": "Deleted on disk",
        "chapter.tex": "Saved text",
      },
    });
    await controller.whenIdle();
    expect(
      Object.fromEntries(
        clients[0].opens.map((document) => [document.uri, document.text]),
      ),
    ).toEqual({
      [CHAPTER_URI]: "First",
      "file:///projects/project-a/main.tex": "\\input{chapter}",
    });
  });

  it("compares trees as multisets so reordered duplicates keep the revision", async () => {
    const { controller, store } = harness();
    const main = { path: "main.tex", is_dir: false };
    const chapter = { path: "chapter.tex", is_dir: false };
    const refs = { path: "refs.bib", is_dir: false };
    const figures = { path: "figures", is_dir: true };
    controller.update(snapshot({ tree: [figures, main, main, chapter, refs] }));
    await controller.whenIdle();

    controller.update(snapshot({ tree: [chapter, main, figures, refs, main] }));
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(1);

    controller.update(snapshot({ tree: [chapter, main, figures, refs, refs] }));
    await controller.whenIdle();
    expect(store.getState().snapshot.identity.projectRevision).toBe(2);
  });

  it("replaces the server when the project switches engines", async () => {
    const { controller, store, clients } = harness();
    controller.update(snapshot());
    await controller.whenIdle();

    controller.update(typstProject());
    await controller.whenIdle();

    expect(clients).toHaveLength(2);
    expect(clients[0].stopCount).toBe(1);
    expect(clients[1].starts[0]?.runtimeProfile.kind).toBe("tinymist");
    expect(clients[1].opens.map((document) => document.uri)).toEqual([
      "file:///projects/project-a/main.typ",
    ]);
    expect(store.getState().snapshot.identity).toMatchObject({
      projectId: "project-a",
      projectRevision: 2,
    });
    expect(store.getState().snapshot.languageService).toMatchObject({
      kind: "tinymist",
      readiness: "ready",
    });
  });

  it("reports engines without a language server as not run and keeps local documents", async () => {
    const { controller, store, clients } = harness();
    controller.update(snapshot({ engineId: "unknown" }));
    await controller.whenIdle();
    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "not_run",
      reason: { key: "noLanguageServerMapping" },
    });
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "not_run",
      reason: { key: "noLanguageServerMapping" },
    });
    expect(Object.values(store.getState().snapshot.documents)).toEqual([
      expect.objectContaining({ reason: BIBTEX_LOCAL_ONLY_ANALYSIS_REASON }),
    ]);
  });

  it("drops the local BibTeX document when the file leaves the project", async () => {
    const { controller, store } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const bibUri = "oleafly-project://project-a/refs.bib";
    expect(store.getState().snapshot.documents[bibUri]).toBeDefined();

    controller.update(
      snapshot({
        tree: initial.tree.filter((entry) => entry.path !== "refs.bib"),
        files: {
          "main.tex": initial.files["main.tex"],
          "chapter.tex": initial.files["chapter.tex"],
        },
      }),
    );
    await controller.whenIdle();
    expect(store.getState().snapshot.documents[bibUri]).toBeUndefined();
  });
});

describe("LanguageServiceController lifecycle guards", () => {
  it("ignores updates, retries and setup after disposal", async () => {
    const { controller, store, clients, installStatus, install } = harness();
    controller.update(snapshot());
    await controller.whenIdle();
    await controller.dispose();
    await controller.dispose();

    controller.update(projectB());
    controller.retry();
    await controller.setup();
    await controller.whenIdle();

    expect(clients).toHaveLength(1);
    expect(installStatus).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "stopped",
    );
  });

  it("treats retry and setup as no-ops without a project or a server mapping", async () => {
    const { controller, store, clients, install } = harness();
    controller.retry();
    await controller.setup();
    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.identity.projectId).toBeNull();

    controller.update(
      snapshot({
        engineId: "markdown",
        mainDoc: "main.md",
        tree: [{ path: "main.md", is_dir: false }],
        files: { "main.md": { content: "# Paper" } },
        index: buildIndex({ "main.md": "# Paper" }),
      }),
    );
    await controller.whenIdle();
    await controller.setup();
    expect(install).not.toHaveBeenCalled();
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "local_only",
    );
  });

  it("does not reset the store again when an already closed project closes", async () => {
    const { controller, store } = harness();
    controller.update(snapshot({ projectId: null }));
    await controller.whenIdle();
    const closed = store.getState().snapshot;

    controller.update(snapshot({ projectId: null }));
    await controller.whenIdle();
    expect(store.getState().snapshot).toBe(closed);
  });

  it("starts only the newest project when switches are queued back to back", async () => {
    const { controller, store, clients, installStatus } = harness();
    controller.update(snapshot());
    controller.update(projectB());
    await controller.whenIdle();
    expect(clients.map((client) => client.projectId)).toEqual(["project-b"]);
    expect(installStatus).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshot.identity.projectId).toBe("project-b");
  });
});

describe("LanguageServiceController setup status", () => {
  it("explains an uncheckable setup status without leaking backend details", async () => {
    const { controller, store, clients, installStatus } = harness();
    installStatus.mockRejectedValueOnce(
      new Error("token=secret at /Users/private/bin"),
    );
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "setupStatusUncheckable" },
      failure: { reason: { key: "startFailedRetry" }, retryable: true },
    });
    expect(
      JSON.stringify(store.getState().snapshot.languageService),
    ).not.toMatch(/secret|\/Users\/private/u);
  });

  it.each([
    ["session_limit", "sessionLimit"],
    ["integrity_failure", "integrityFailure"],
    ["brand_new_code", "startFailedRetry"],
  ])("maps the backend code %s to the %s reason", async (code, key) => {
    const { controller, store, installStatus } = harness();
    installStatus.mockRejectedValueOnce(
      new LanguageServiceBackendError(code, "backend refused"),
    );
    controller.update(snapshot());
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService.failure).toMatchObject({
      code,
      reason: { key },
    });
  });

  it("requires setup when the installed server is not the pinned version", async () => {
    const { controller, store, clients, installStatus } = harness();
    const expected = getLanguageServiceRuntimeProfile("texlab").version;
    installStatus.mockResolvedValueOnce({
      kind: "texlab",
      version: "0.0.1",
      state: "installed",
    });
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients).toHaveLength(0);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "setup_required",
      reason: { key: "pinnedVersionRequired" },
      failure: {
        reason: {
          key: "versionMismatch",
          params: { kind: "texlab", expected, reported: "0.0.1" },
        },
      },
    });
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "unavailable",
      reason: { key: "versionMismatch" },
    });
  });

  it("shows a running installation and starts once it completes", async () => {
    const { controller, store, clients, installStatus } = harness();
    const version = getLanguageServiceRuntimeProfile("texlab").version;
    installStatus.mockResolvedValueOnce({
      kind: "texlab",
      version,
      state: "installing",
    });
    controller.update(snapshot());
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "installing",
      reason: { key: "beingInstalled" },
    });
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "not_run",
      reason: { key: "setupRunning" },
    });

    installStatus.mockResolvedValueOnce({
      kind: "texlab",
      version,
      state: "installing",
      message: "Unpacking texlab",
    });
    controller.retry();
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService.reason).toEqual({
      text: "Unpacking texlab",
    });
    expect(clients).toHaveLength(0);

    controller.retry();
    await controller.whenIdle();
    expect(clients).toHaveLength(1);
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("passes a failed installation's own message through as the setup reason", async () => {
    const { controller, store, installStatus } = harness();
    installStatus.mockResolvedValueOnce({
      kind: "texlab",
      version: getLanguageServiceRuntimeProfile("texlab").version,
      state: "failed",
      message: "Checksum mismatch",
    });
    controller.update(snapshot());
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "setup_required",
      reason: { key: "setupRequiredBeforeAnalysis" },
      failure: {
        code: "sidecar_setup_required",
        message: "Checksum mismatch",
        reason: { text: "Checksum mismatch" },
      },
    });
  });
});

describe("LanguageServiceController start failures", () => {
  it("reports an initialize timeout and stops the half-started session", async () => {
    const { controller, store, clients } = harness({
      configureClient: (client) => {
        client.startError = new LanguageServiceTimeoutError("initialize", 50);
      },
    });
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients[0].stopCount).toBe(1);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "startFailed" },
      failure: {
        name: "LanguageServiceTimeoutError",
        reason: { key: "initializeTimeout" },
      },
    });
  });

  it("asks for setup when the backend reports the server binary missing at start", async () => {
    const { controller, store, clients } = harness({
      configureClient: (client) => {
        client.startError = new LanguageServiceBackendError(
          "sidecar_setup_required",
          "missing binary at /Users/private/texlab",
        );
      },
    });
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients[0].stopCount).toBe(1);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "setup_required",
      reason: { key: "setupRequiredBeforeAnalysis" },
      failure: { reason: { key: "sidecarSetupRequired" } },
    });
    expect(
      JSON.stringify(store.getState().snapshot.languageService),
    ).not.toContain("/Users/private");
  });

  it("tears down and reports a runtime the default coordinator cannot drive", async () => {
    const { controller, store, clients } = harness({
      defaultCoordinator: true,
    });
    controller.update(snapshot());
    await controller.whenIdle();

    expect(clients[0].stopCount).toBe(1);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "couldNotSynchronize" },
      failure: { name: "TypeError", retryable: true },
    });
  });

  it("reports a cleanup failure when setup cannot stop the runtime it could not synchronize", async () => {
    const { controller, store, clients } = harness({
      installState: "missing",
      defaultCoordinator: true,
      configureClient: (client) => {
        client.stopFailures = 2;
      },
    });
    controller.update(snapshot());
    await controller.whenIdle();

    await expect(controller.setup()).rejects.toThrow(
      LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
    );
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(2);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: LANGUAGE_SERVICE_DISPOSE_ANALYSIS_REASON,
      failure: { message: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON },
    });
  });

  it("tears down and reports setup that installs but cannot synchronize", async () => {
    const { controller, store, install, clients } = harness({
      installState: "missing",
      defaultCoordinator: true,
    });
    controller.update(snapshot());
    await controller.whenIdle();

    await expect(controller.setup()).rejects.toThrow(
      LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
    );
    await controller.whenIdle();
    expect(install).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].stopCount).toBe(1);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "setupCouldNotSynchronize" },
      failure: { message: LANGUAGE_SERVICE_SETUP_FAILURE_REASON },
    });
  });

  it("stops a session whose document versions stop advancing and recovers on retry", async () => {
    const { controller, store, clients } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    clients[0].versionSkew = 1;

    controller.update({
      ...initial,
      files: { ...initial.files, "chapter.tex": { content: "Edited" } },
    });
    await controller.whenIdle();

    expect(clients[0].stopCount).toBe(1);
    expect(clients[0].closes).toEqual([
      "file:///projects/project-a/main.tex",
      CHAPTER_URI,
    ]);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "couldNotSynchronize" },
    });

    controller.retry();
    await controller.whenIdle();
    expect(clients).toHaveLength(2);
    expect(
      clients[1].opens.find((document) => document.uri === CHAPTER_URI)?.text,
    ).toBe("Edited");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("does not report a failed sync once another project has been opened", async () => {
    const { controller, store, clients } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const reasons: unknown[] = [];
    const unsubscribe = store.subscribe((state) => {
      reasons.push(state.snapshot.languageService.reason);
    });
    const stop = deferred();
    clients[0].versionSkew = 1;
    clients[0].stopGate = stop.promise;

    controller.update({
      ...initial,
      files: { ...initial.files, "chapter.tex": { content: "Edited" } },
    });
    await vi.waitFor(() => expect(clients[0].stopCount).toBe(1));
    controller.update(projectB());
    stop.resolve();
    await controller.whenIdle();
    unsubscribe();

    expect(reasons).not.toContainEqual({ key: "couldNotSynchronize" });
    expect(clients).toHaveLength(2);
    expect(store.getState().snapshot.identity.projectId).toBe("project-b");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });
});

describe("LanguageServiceController setup supersession", () => {
  it("skips installation when another project opens before setup runs", async () => {
    const { controller, store, install } = harness({ installState: "missing" });
    controller.update(snapshot());
    await controller.whenIdle();

    const setup = controller.setup();
    controller.update(projectB());
    await expect(setup).resolves.toBeUndefined();
    await controller.whenIdle();

    expect(install).not.toHaveBeenCalled();
    expect(store.getState().snapshot.identity.projectId).toBe("project-b");
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "setup_required",
    );
  });

  it.each([
    ["fails", false],
    ["succeeds", true],
  ])(
    "does not apply a setup that %s after another project opened",
    async (_label, succeeds) => {
      const { controller, store, clients, install } = harness({
        installState: "missing",
      });
      controller.update(snapshot());
      await controller.whenIdle();
      const installation = deferred<{
        kind: "texlab";
        version: string;
        state: "installed";
      }>();
      install.mockImplementationOnce(() => installation.promise);

      const setup = controller.setup();
      await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(1));
      controller.update(projectB());
      if (succeeds) {
        installation.resolve({
          kind: "texlab",
          version: getLanguageServiceRuntimeProfile("texlab").version,
          state: "installed",
        });
      } else {
        installation.reject(new Error("network down"));
      }
      await expect(setup).resolves.toBeUndefined();
      await controller.whenIdle();

      expect(clients).toHaveLength(0);
      expect(store.getState().snapshot.identity.projectId).toBe("project-b");
      expect(store.getState().snapshot.languageService).toMatchObject({
        readiness: "setup_required",
        reason: { key: "setupRequiredBeforeAnalysis" },
      });
    },
  );
});

describe("LanguageServiceController superseded work", () => {
  it.each([
    [
      "the engine details unload",
      (controller: LanguageServiceController) =>
        controller.update(snapshot({ engineLoaded: false })),
    ],
    [
      "the project switches to Markdown",
      (controller: LanguageServiceController) =>
        controller.update(snapshot({ engineId: "markdown" })),
    ],
    [
      "the project closes",
      (controller: LanguageServiceController) =>
        controller.update(snapshot({ projectId: null })),
    ],
    [
      "the project switches to Typst",
      (controller: LanguageServiceController) =>
        controller.update(typstProject()),
    ],
    [
      "the user retries",
      (controller: LanguageServiceController) => controller.retry(),
    ],
  ])(
    "abandons the teardown started when %s once another project opens",
    async (_label, interrupt) => {
      const { controller, store, clients } = harness();
      controller.update(snapshot());
      await controller.whenIdle();
      const stop = deferred();
      clients[0].stopGate = stop.promise;

      interrupt(controller);
      await vi.waitFor(() => expect(clients[0].stopCount).toBe(1));
      controller.update(projectB());
      stop.resolve();
      await controller.whenIdle();

      expect(clients).toHaveLength(2);
      expect(clients[1].projectId).toBe("project-b");
      expect(clients[1].starts[0]?.runtimeProfile.kind).toBe("texlab");
      expect(store.getState().snapshot.identity.projectId).toBe("project-b");
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    },
  );

  it.each([
    ["answer", true],
    ["failure", false],
  ])(
    "drops a setup status %s that arrives after another project opened",
    async (_label, succeeds) => {
      const { controller, store, clients, installStatus } = harness();
      const status = deferred<{
        kind: "texlab";
        version: string;
        state: "installed";
      }>();
      installStatus.mockImplementationOnce(() => status.promise);
      controller.update(snapshot());
      await vi.waitFor(() => expect(installStatus).toHaveBeenCalledTimes(1));

      controller.update(projectB());
      if (succeeds) {
        status.resolve({
          kind: "texlab",
          version: getLanguageServiceRuntimeProfile("texlab").version,
          state: "installed",
        });
      } else {
        status.reject(new Error("status unavailable"));
      }
      await controller.whenIdle();

      expect(clients.map((client) => client.projectId)).toEqual(["project-b"]);
      expect(installStatus).toHaveBeenCalledTimes(2);
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    },
  );

  it("abandons an unavailable-IPC teardown once another project opens", async () => {
    let available = true;
    const { controller, store, clients } = harness({
      isAvailable: () => available,
    });
    controller.update(snapshot());
    await controller.whenIdle();
    const stop = deferred();
    clients[0].stopGate = stop.promise;

    available = false;
    controller.retry();
    await vi.waitFor(() => expect(clients[0].stopCount).toBe(1));
    controller.update(projectB());
    stop.resolve();
    await controller.whenIdle();

    expect(clients).toHaveLength(1);
    expect(store.getState().snapshot.identity.projectId).toBe("project-b");
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "ipcUnavailable" },
    });
  });

  it("abandons setup while the running server stops once another project opens", async () => {
    const { controller, store, clients, install } = harness();
    controller.update(snapshot());
    await controller.whenIdle();
    const stop = deferred();
    clients[0].stopGate = stop.promise;

    const setup = controller.setup();
    await vi.waitFor(() => expect(clients[0].stopCount).toBe(1));
    controller.update(projectB());
    stop.resolve();
    await expect(setup).resolves.toBeUndefined();
    await controller.whenIdle();

    expect(install).not.toHaveBeenCalled();
    expect(clients.map((client) => client.projectId)).toEqual([
      "project-a",
      "project-b",
    ]);
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("does not report a start failure for a project that was already replaced", async () => {
    const { controller, store, clients, releaseStart } = harness({
      deferStart: true,
      configureClient: (client) => {
        if (client.generation === 1) {
          client.startError = new Error("spawn failed");
        }
      },
    });
    controller.update(snapshot());
    await vi.waitFor(() => expect(clients[0]?.starts).toHaveLength(1));
    const reasons: unknown[] = [];
    const unsubscribe = store.subscribe((state) => {
      reasons.push(state.snapshot.languageService.reason);
    });

    controller.update(projectB());
    releaseStart();
    await controller.whenIdle();
    unsubscribe();

    expect(reasons).not.toContainEqual({ key: "startFailed" });
    expect(clients[0].stopCount).toBe(1);
    expect(clients[1].projectId).toBe("project-b");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("stops a session whose document close was overtaken by another project", async () => {
    const { controller, store, clients } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const close = deferred();
    clients[0].closeGate = close.promise;

    controller.update(
      snapshot({
        tree: initial.tree.filter((entry) => entry.path !== "chapter.tex"),
        files: {
          "main.tex": initial.files["main.tex"],
          "refs.bib": initial.files["refs.bib"],
        },
      }),
    );
    await vi.waitFor(() =>
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "syncing",
      ),
    );
    controller.update(projectB());
    close.resolve();
    await controller.whenIdle();

    expect(clients[0].closes).toEqual([
      CHAPTER_URI,
      "file:///projects/project-a/main.tex",
    ]);
    expect(clients[0].stopCount).toBe(1);
    expect(store.getState().snapshot.identity.projectId).toBe("project-b");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("leaves a server that crashes mid-sync to its restart timer", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const replace = deferred();
    clients[0].replaceGate = replace.promise;

    controller.update({
      ...initial,
      files: { ...initial.files, "chapter.tex": { content: "Crash edit" } },
    });
    await vi.waitFor(() =>
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "syncing",
      ),
    );
    clients[0].exitUnexpectedly();
    replace.resolve();
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(0);
    expect(scheduler.pendingDelays).toEqual([250]);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "restarting",
    );

    scheduler.runDelay(250);
    await controller.whenIdle();
    expect(clients[0].stopCount).toBe(1);
    expect(
      clients[1].opens.find((document) => document.uri === CHAPTER_URI)?.text,
    ).toBe("Crash edit");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("keeps edits away from a crashed server and hands them to its replacement", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    clients[0].exitUnexpectedly();

    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Written during the crash" },
        "refs.bib": { content: "@book{two}" },
      },
    });
    await controller.whenIdle();
    expect(clients[0].changes).toEqual([]);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "restarting",
    );
    expect(
      store.getState().snapshot.documents[
        "oleafly-project://project-a/refs.bib"
      ]?.version,
    ).toBe(2);

    scheduler.runDelay(250);
    await controller.whenIdle();
    expect(
      clients[1].opens.find((document) => document.uri === CHAPTER_URI)?.text,
    ).toBe("Written during the crash");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("resyncs an edit after the stable window and arms a new one", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    scheduler.runDelay(30_000);
    expect(scheduler.pendingDelays).toEqual([]);

    controller.update({
      ...initial,
      files: { ...initial.files, "chapter.tex": { content: "Later edit" } },
    });
    await controller.whenIdle();
    expect(clients[0].changes.map((change) => change.text)).toEqual([
      "Later edit",
    ]);
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
    expect(scheduler.pendingDelays).toEqual([30_000]);
  });

  it("stops a session whose edit sync was overtaken by another project", async () => {
    const { controller, store, clients } = harness();
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const replace = deferred();
    clients[0].replaceGate = replace.promise;

    controller.update({
      ...initial,
      files: { ...initial.files, "chapter.tex": { content: "Slow edit" } },
    });
    await vi.waitFor(() =>
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "syncing",
      ),
    );
    controller.update(projectB());
    replace.resolve();
    await controller.whenIdle();

    expect(clients[0].stopCount).toBe(1);
    expect(clients).toHaveLength(2);
    expect(store.getState().snapshot.identity.projectId).toBe("project-b");
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });
});

describe("LanguageServiceController restart timers", () => {
  it("cancels a pending restart when another project opens", async () => {
    const scheduler = new FakeScheduler();
    const { controller, clients } = harness({ scheduler });
    controller.update(snapshot());
    await controller.whenIdle();
    clients[0].exitUnexpectedly();
    expect(scheduler.pendingDelays).toEqual([250]);

    controller.update(projectB());
    await controller.whenIdle();
    expect(scheduler.pendingDelays).toEqual([30_000]);
    expect(clients.map((client) => client.projectId)).toEqual([
      "project-a",
      "project-b",
    ]);
  });

  it("cancels a pending restart when the user retries", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    controller.update(snapshot());
    await controller.whenIdle();
    clients[0].exitUnexpectedly();

    controller.retry();
    await controller.whenIdle();
    expect(scheduler.pendingDelays).toEqual([30_000]);
    expect(clients).toHaveLength(2);
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "ready",
      restartAttempt: 0,
    });
  });

  it("restarts after an error status and ignores non-terminal status events", async () => {
    const scheduler = new FakeScheduler();
    const { controller, store, clients } = harness({ scheduler });
    controller.update(snapshot());
    await controller.whenIdle();
    const client = clients[0];

    client.emitRetained({
      type: "status",
      state: "starting",
      generation: client.generation,
      session: "session-1",
    });
    client.emitRetained({
      type: "log",
      stream: "stderr",
      message: "noise",
      generation: client.generation,
    });
    client.emitRetained({
      type: "status",
      state: "error",
      generation: client.generation + 1,
      session: "session-2",
    });
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");

    client.emitRetained({
      type: "status",
      state: "error",
      generation: client.generation,
      session: "session-1",
    });
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "restarting",
      restartAttempt: 1,
      reason: { key: "exitedRestartScheduled", params: { attempt: 1 } },
      failure: { reason: { key: "processExited" } },
    });
    expect(scheduler.pendingDelays).toEqual([250]);
  });

  it("replaces a crashed Tinymist with the new startup settings instead of waiting for the restart", async () => {
    const scheduler = new FakeScheduler();
    const settings = settingsSource();
    const { controller, store, clients } = harness({
      scheduler,
      settings: settings.source,
    });
    controller.update(typstProject());
    await controller.whenIdle();
    clients[0].exitUnexpectedly();
    expect(scheduler.pendingDelays).toEqual([250]);

    settings.set({ lint: true });
    await controller.whenIdle();

    expect(scheduler.pendingDelays).toEqual([30_000]);
    expect(clients).toHaveLength(2);
    expect(clients[1].starts[0]?.runtimeProfile.initializationOptions).toMatchObject(
      { lint: { enabled: true } },
    );
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("ignores settings changes while no server is running", () => {
    const settings = settingsSource();
    const { clients } = harness({ settings: settings.source });
    settings.set({ lint: true });
    expect(clients).toHaveLength(0);
  });
});

describe("LanguageServiceController optional server requests", () => {
  it("resends a live configuration change the server failed to apply", async () => {
    const settings = settingsSource();
    const changeConfiguration = vi
      .fn(async (_settings: JsonValue) => {})
      .mockRejectedValueOnce(new Error("busy"));
    const { controller, clients } = harness({
      settings: settings.source,
      configureClient: (client) => {
        client.changeConfiguration = changeConfiguration;
      },
    });
    controller.update(typstProject());
    await controller.whenIdle();
    expect(changeConfiguration).not.toHaveBeenCalled();

    settings.set({ formatterPrintWidth: 80 });
    expect(changeConfiguration).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      settings.notify();
      expect(changeConfiguration).toHaveBeenCalledTimes(2);
    });
    settings.notify();
    expect(changeConfiguration).toHaveBeenCalledTimes(2);
    expect(changeConfiguration.mock.calls[1]?.[0]).toEqual(
      changeConfiguration.mock.calls[0]?.[0],
    );
    expect(changeConfiguration.mock.calls[1]?.[0]).toMatchObject({
      formatterPrintWidth: 80,
    });
    expect(clients).toHaveLength(1);
  });

  it("keeps a newer configuration when an older push fails late", async () => {
    const settings = settingsSource();
    const first = deferred();
    const changeConfiguration = vi
      .fn(async (_settings: JsonValue) => {})
      .mockImplementationOnce(() => first.promise);
    const { controller } = harness({
      settings: settings.source,
      configureClient: (client) => {
        client.changeConfiguration = changeConfiguration;
      },
    });
    controller.update(typstProject());
    await controller.whenIdle();

    settings.set({ formatterPrintWidth: 80 });
    settings.set({ formatterPrintWidth: 90 });
    expect(changeConfiguration).toHaveBeenCalledTimes(2);
    first.reject(new Error("busy"));
    await flushMicrotasks();

    settings.notify();
    expect(changeConfiguration).toHaveBeenCalledTimes(2);
    expect(changeConfiguration.mock.calls[1]?.[0]).toMatchObject({
      formatterPrintWidth: 90,
    });
  });

  it("keeps a newer pin when an older pin fails late", async () => {
    const firstPin = deferred<JsonValue>();
    const executeCommand = vi
      .fn(async (_params: ExecuteCommandParams) => null as JsonValue)
      .mockImplementationOnce(() => firstPin.promise);
    const { controller } = harness({
      configureClient: (client) => {
        client.supportsCommand = () => true;
        client.executeCommand = executeCommand;
      },
    });
    const files = {
      "main.typ": { content: "= Paper\n" },
      "chapter.typ": { content: "= Chapter\n" },
    };
    const tree = Object.keys(files).map((path) => ({ path, is_dir: false }));
    controller.update(typstProject({ files, tree }));
    await controller.whenIdle();
    controller.update(typstProject({ files, tree, mainDoc: "chapter.typ" }));
    await controller.whenIdle();
    expect(executeCommand).toHaveBeenCalledTimes(2);

    firstPin.reject(new Error("busy"));
    await flushMicrotasks();
    controller.update(
      typstProject({
        files: { ...files, "chapter.typ": { content: "= Chapter\nMore\n" } },
        tree,
        mainDoc: "chapter.typ",
      }),
    );
    await controller.whenIdle();
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(executeCommand.mock.calls[1]?.[0]).toEqual({
      command: "tinymist.pinMain",
      arguments: ["/projects/project-a/chapter.typ"],
    });
  });

  it("pins the main file only once it is a Typst file", async () => {
    const executeCommand = vi.fn(async () => null as JsonValue);
    const { controller } = harness({
      configureClient: (client) => {
        client.supportsCommand = () => true;
        client.executeCommand = executeCommand;
      },
    });
    controller.update(typstProject({ mainDoc: "" }));
    await controller.whenIdle();
    expect(executeCommand).not.toHaveBeenCalled();

    controller.update(typstProject());
    await controller.whenIdle();
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledWith(
      {
        command: "tinymist.pinMain",
        arguments: ["/projects/project-a/main.typ"],
      },
      { timeoutMs: 5_000 },
    );
  });

  it("pins the main file again after a failed pin", async () => {
    const executeCommand = vi
      .fn(async (_params: ExecuteCommandParams) => null as JsonValue)
      .mockRejectedValueOnce(new Error("busy"));
    const { controller } = harness({
      configureClient: (client) => {
        client.supportsCommand = () => true;
        client.executeCommand = executeCommand;
      },
    });
    const initial = typstProject();
    controller.update(initial);
    await controller.whenIdle();
    expect(executeCommand).toHaveBeenCalledTimes(1);
    await flushMicrotasks();

    controller.update({
      ...initial,
      files: { "main.typ": { content: "= Paper\nMore\n" } },
    });
    await controller.whenIdle();
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(executeCommand.mock.calls[1]?.[0]).toEqual(
      executeCommand.mock.calls[0]?.[0],
    );
  });

  it("forwards a save that lands before its edit reaches the server once the edit is synced", async () => {
    const saveDocument = vi.fn(async (_uri: string) => {});
    const { controller, clients } = harness({
      configureClient: (client) => {
        client.saveDocument = saveDocument;
      },
    });
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();

    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Draft", dirty: true },
      },
    });
    controller.update({
      ...initial,
      files: {
        ...initial.files,
        "chapter.tex": { content: "Draft", dirty: false },
      },
    });
    expect(saveDocument).not.toHaveBeenCalled();
    await controller.whenIdle();

    expect(clients[0].changes.map((change) => change.text)).toEqual(["Draft"]);
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument).toHaveBeenCalledWith(CHAPTER_URI);
  });

  it.each([
    [
      "a BibTeX file the server never opened",
      (initial: LanguageServiceProjectSnapshot) => [
        {
          ...initial,
          files: {
            ...initial.files,
            "refs.bib": { content: "@book{one}", dirty: true },
          },
        },
        {
          ...initial,
          files: {
            ...initial.files,
            "refs.bib": { content: "@book{one}", dirty: false },
          },
        },
      ],
    ],
    [
      "a file edited again before the save reached the server",
      (initial: LanguageServiceProjectSnapshot) => [
        {
          ...initial,
          files: {
            ...initial.files,
            "chapter.tex": { content: "Draft", dirty: true },
          },
        },
        {
          ...initial,
          files: {
            ...initial.files,
            "chapter.tex": { content: "Draft", dirty: false },
          },
        },
        {
          ...initial,
          files: {
            ...initial.files,
            "chapter.tex": { content: "Draft again", dirty: true },
          },
        },
      ],
    ],
    [
      "a file deleted before the save reached the server",
      (initial: LanguageServiceProjectSnapshot) => [
        {
          ...initial,
          files: {
            ...initial.files,
            "chapter.tex": { content: "Draft", dirty: true },
          },
        },
        {
          ...initial,
          files: {
            ...initial.files,
            "chapter.tex": { content: "Draft", dirty: false },
          },
        },
        snapshot({
          tree: initial.tree.filter((entry) => entry.path !== "chapter.tex"),
          files: {
            "main.tex": initial.files["main.tex"],
            "refs.bib": initial.files["refs.bib"],
          },
        }),
      ],
    ],
  ])("does not forward a save for %s", async (_label, updates) => {
    const saveDocument = vi.fn(async (_uri: string) => {});
    const { controller } = harness({
      configureClient: (client) => {
        client.saveDocument = saveDocument;
      },
    });
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();

    for (const next of updates(initial)) controller.update(next);
    await controller.whenIdle();
    expect(saveDocument).not.toHaveBeenCalled();
  });
});

describe("LanguageServiceController project intelligence", () => {
  const initialIndexState = useIndexStore.getState();
  const identity = {
    projectId: "project-a",
    projectRevision: 7,
    requestGeneration: 3,
  };

  function setIntelligenceIdentity(next: typeof identity) {
    useIndexStore.setState({
      intelligenceState: {
        ...useIndexStore.getState().intelligenceState,
        identity: next,
      },
    });
  }

  function intelligenceHarness(
    requestWorkspaceSymbols: (
      params: WorkspaceSymbolParams,
      options?: LanguageServiceRequestOptions,
    ) => Promise<JsonValue>,
  ) {
    const merge = vi.fn(() => true);
    useIndexStore.setState({ mergeLanguageService: merge });
    setIntelligenceIdentity(identity);
    const scheduler = new FakeScheduler();
    const setup = harness({
      scheduler,
      configureClient: (client) => {
        client.requestWorkspaceSymbols = requestWorkspaceSymbols;
      },
    });
    return { ...setup, scheduler, merge };
  }

  afterEach(() => {
    useIndexStore.setState(initialIndexState, true);
  });

  it("merges workspace symbols for the current intelligence identity once", async () => {
    const request = vi.fn(async () => [] as JsonValue);
    const { controller, scheduler, merge } = intelligenceHarness(request);
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    expect(scheduler.pendingDelays).toEqual([400, 30_000]);

    scheduler.runDelay(400);
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith(
      { query: "" },
      { projectRevision: 1, timeoutMs: 8_000 },
    );
    expect(merge).toHaveBeenCalledWith({
      identity,
      definitions: [],
      uses: [],
    });

    controller.update({ ...initial, indexBuilding: true });
    expect(scheduler.pendingDelays).toEqual([30_000]);
  });

  it("does not ask for symbols when intelligence belongs to another project", async () => {
    const request = vi.fn(async () => [] as JsonValue);
    const { controller, scheduler } = intelligenceHarness(request);
    setIntelligenceIdentity({ ...identity, projectId: "project-z" });
    controller.update(snapshot());
    await controller.whenIdle();
    expect(scheduler.pendingDelays).toEqual([30_000]);
    expect(request).not.toHaveBeenCalled();
  });

  it("discards symbols that arrive after the intelligence identity moved on", async () => {
    const answer = deferred<JsonValue>();
    const request = vi.fn(() => answer.promise);
    const { controller, scheduler, merge } = intelligenceHarness(request);
    controller.update(snapshot());
    await controller.whenIdle();

    scheduler.runDelay(400);
    expect(request).toHaveBeenCalledTimes(1);
    setIntelligenceIdentity({ ...identity, requestGeneration: 4 });
    answer.resolve([]);
    await flushMicrotasks();
    expect(merge).not.toHaveBeenCalled();
  });

  it("asks again after a failed symbol request", async () => {
    const request = vi
      .fn(async (_params: WorkspaceSymbolParams) => [] as JsonValue)
      .mockRejectedValueOnce(new Error("timed out"));
    const { controller, scheduler, merge } = intelligenceHarness(request);
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    scheduler.runDelay(400);
    await flushMicrotasks();
    expect(merge).not.toHaveBeenCalled();

    controller.update({ ...initial, indexBuilding: true });
    expect(scheduler.pendingDelays).toContain(400);
    scheduler.runDelay(400);
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("replaces a pending symbol request when the identity changes before it fires", async () => {
    const request = vi.fn(async () => [] as JsonValue);
    const { controller, scheduler, merge } = intelligenceHarness(request);
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const next = { ...identity, requestGeneration: 4 };
    setIntelligenceIdentity(next);

    controller.update({ ...initial, indexBuilding: true });
    expect(scheduler.pendingDelays.filter((delay) => delay === 400)).toHaveLength(
      1,
    );
    scheduler.runDelay(400);
    await vi.waitFor(() => expect(merge).toHaveBeenCalledTimes(1));
    expect(merge).toHaveBeenCalledWith(
      expect.objectContaining({ identity: next }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("skips a symbol request that fires while an edit is still syncing", async () => {
    const request = vi.fn(async () => [] as JsonValue);
    const { controller, store, clients, scheduler } = intelligenceHarness(
      request,
    );
    const initial = snapshot();
    controller.update(initial);
    await controller.whenIdle();
    const replace = deferred();
    clients[0].replaceGate = replace.promise;

    controller.update({
      ...initial,
      files: { ...initial.files, "chapter.tex": { content: "Edit" } },
    });
    await vi.waitFor(() =>
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "syncing",
      ),
    );
    scheduler.runDelay(400);
    expect(request).not.toHaveBeenCalled();

    replace.resolve();
    await controller.whenIdle();
    scheduler.runDelay(400);
    expect(request).toHaveBeenCalledWith(
      { query: "" },
      { projectRevision: 2, timeoutMs: 8_000 },
    );
  });

  it.each([
    [
      "the server exits",
      async (
        _controller: LanguageServiceController,
        clients: FakeClient[],
      ) => {
        clients[0].exitUnexpectedly();
      },
    ],
    [
      "another project opens",
      async (controller: LanguageServiceController) => {
        controller.update(projectB());
        await controller.whenIdle();
      },
    ],
    [
      "the controller is disposed",
      async (controller: LanguageServiceController) => {
        await controller.dispose();
      },
    ],
  ])("cancels a pending symbol request when %s", async (_label, act) => {
    const request = vi.fn(async () => [] as JsonValue);
    const { controller, clients, scheduler } = intelligenceHarness(request);
    controller.update(snapshot());
    await controller.whenIdle();
    expect(scheduler.pendingDelays).toContain(400);

    await act(controller, clients);
    expect(scheduler.pendingDelays).not.toContain(400);
    expect(request).not.toHaveBeenCalled();
  });
});
