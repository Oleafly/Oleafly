import { buildIndex } from "@/lib/index/build";
import {
  PROJECT_ANALYSIS_FEATURES,
} from "@/lib/analysis/project-snapshot";
import type {
  LanguageServiceClientStartOptions,
  LanguageServiceClientEvent,
  LanguageServiceClientListener,
  LanguageServiceClientState,
  LanguageServiceFeature,
  TextDocumentItem,
} from "@/lib/language-service";
import {
  getLanguageServiceRuntimeProfile,
  LanguageServiceClient,
  TauriLanguageServiceTransport,
} from "@/lib/language-service";
import { LANGUAGE_SERVICE_SETUP_FAILURE_REASON } from "@/lib/analysis/language-service-actions";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import { describe, expect, it, vi } from "vitest";
import {
  BIBTEX_LOCAL_ONLY_REASON,
  fileUriForProjectPath,
  LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
  LanguageServiceController,
  languageServiceKindForEngine,
  languageServiceLanguageIdForPath,
  MARKDOWN_LOCAL_ONLY_REASON,
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
    this.projectRevision = projectRevision;
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.changes.push({ uri, text, version });
    return version;
  }

  acknowledgeDocumentRevision(
    _uri: string,
    projectRevision = this.projectRevision,
  ): void {
    this.projectRevision = projectRevision;
    this.acknowledgements.push({ uri: _uri, projectRevision });
  }

  async closeDocument(uri: string): Promise<void> {
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
        .markFeatureNotRun(feature, "Ready; analysis has not run.");
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
  }> = [];

  setTimeout(callback: () => void, delayMs: number): unknown {
    this.delays.push(delayMs);
    const job = { callback, cancelled: false };
    this.jobs.push(job);
    return job;
  }

  clearTimeout(handle: unknown): void {
    (handle as { cancelled: boolean }).cancelled = true;
  }

  get pending(): number {
    return this.jobs.filter((job) => !job.cancelled).length;
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
  const installStatus = vi.fn(async (kind: "texlab" | "tinymist") => ({
    kind,
    version: getLanguageServiceRuntimeProfile(kind).version,
    state: currentInstallState,
  }));
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
    isAvailable: () => overrides.available ?? true,
    provisioner: { installStatus, install },
    createClient: (_kind, projectId) => {
      const client = new FakeClient(
        clients.length + 1,
        projectId,
        openGate,
        startGate,
      );
      clients.push(client);
      return client;
    },
    createCoordinator: (client, targetStore) =>
      new FakeCoordinator(client, targetStore),
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
        (document) => document.reason === BIBTEX_LOCAL_ONLY_REASON,
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
    ).find((document) => document.reason === BIBTEX_LOCAL_ONLY_REASON);
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
      reason: MARKDOWN_LOCAL_ONLY_REASON,
    });
    expect(store.getState().snapshot.features.completion.status).toBe(
      "unsupported",
    );
    expect(
      Object.values(store.getState().snapshot.documents)[0],
    ).toMatchObject({
      analysis: "local_only",
      status: "not_run",
      reason: MARKDOWN_LOCAL_ONLY_REASON,
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
      reason: LANGUAGE_SERVICE_SETUP_FAILURE_REASON,
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
      reason: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
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
      reason: LANGUAGE_SERVICE_DISPOSE_FAILURE_REASON,
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
