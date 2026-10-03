import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CompileResult } from "@oleafly/backend-port";
import { describeError } from "@/lib/app-error";
import { compileOfflineForEngine } from "@/lib/document-engine";
import { logError } from "@/lib/log";
import { mainDocumentMissing } from "@/lib/main-document";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import {
  applyTypstLiveResult,
  compileProjectRevision,
  reportCompileSaveFailure,
  saveActiveForCompile,
  typstLivePreviewWanted,
  useCompileStore,
  type LivePreviewStatus,
} from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { activeTypstVariant, useTypstVariantStore } from "@/store/typst-variant";

export const LIVE_SAVE_DEBOUNCE_MS = 150;

const RESULT_EVENT = "typst-watch:result";
const STATUS_EVENT = "typst-watch:status";

type WatchState = "starting" | "watching" | "compiling" | "restarting" | "stopped" | "failed" | "idle";

interface StatusPayload {
  readonly projectId: string;
  readonly mainDocument: string;
  readonly sessionId: number;
  readonly state: WatchState;
  readonly message: string | null;
}

interface ResultPayload {
  readonly projectId: string;
  readonly mainDocument: string;
  readonly sessionId: number;
  readonly cycle: number;
  readonly result: CompileResult;
}

interface StartedPayload {
  readonly sessionId: number;
  readonly started: boolean;
}

export interface LiveCompileRequest {
  readonly projectId: string;
  readonly mainDoc: string;
  readonly offline: boolean;
  readonly typstVariant: string | null;
  readonly fresh: boolean;
}

interface Desired {
  readonly projectId: string;
  readonly mainDoc: string;
  readonly offline: boolean;
  readonly typstVariant: string | null;
  readonly key: string;
}

interface LiveSession {
  readonly projectId: string;
  readonly key: string;
  sessionId: number;
  alive: boolean;
  paused: boolean;
}

type FilesState = ReturnType<typeof useFilesStore.getState>;

const STATUS_FOR: Readonly<Record<WatchState, LivePreviewStatus | null>> = {
  starting: "starting",
  watching: "on",
  compiling: "compiling",
  restarting: "restarting",
  failed: "failed",
  stopped: null,
  idle: null,
};

let session: LiveSession | null = null;
let queue: Promise<void> = Promise.resolve();
let uninstall: (() => void) | null = null;
let listening: Promise<UnlistenFn[]> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savedRevision: number | null = null;
let cycleRevision: number | null = null;
let interruptions = 0;
let compilingProject: string | null = null;

const BUSY_STATUSES: ReadonlySet<LivePreviewStatus> = new Set(["starting", "compiling", "restarting"]);

function desired(): Desired | null | "hold" {
  const files = useFilesStore.getState();
  if (session && files.projectId === session.projectId && (!files.engineLoaded || files.loading)) {
    return "hold";
  }
  if (!files.projectId || files.loading || !typstLivePreviewWanted(files) || mainDocumentMissing(files)) {
    return null;
  }
  const mainDoc = resolveEffectiveMainDoc().mainDoc;
  const offline = compileOfflineForEngine(files.engine, useSettingsStore.getState().offline).offline;
  const typstVariant = activeTypstVariant(files.projectId, files.engine);
  const key = JSON.stringify([
    files.projectId,
    mainDoc,
    offline,
    typstVariant,
    files.engine.typst_version ?? null,
    files.engine.typst_resolved ?? null,
    files.engine.typst_options ?? null,
    files.engine.typst_vendor_packages ?? null,
  ]);
  return { projectId: files.projectId, mainDoc, offline, typstVariant, key };
}

function setStatus(projectId: string, status: LivePreviewStatus, message: string | null = null): void {
  useCompileStore.getState().setLivePreviewStatus(projectId, status, message);
}

function activeContent(state: FilesState): string | undefined {
  return state.activePath ? state.files[state.activePath]?.content : undefined;
}

function activeDirty(state: FilesState): boolean {
  return Boolean(state.activePath && state.files[state.activePath]?.dirty);
}

function clearSaveTimer(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
}

async function saveForLive(): Promise<void> {
  const files = useFilesStore.getState();
  if (!session || files.projectId !== session.projectId || !activeDirty(files)) return;
  const revision = compileProjectRevision(session.projectId);
  try {
    await saveActiveForCompile(files);
    savedRevision = revision;
    if (session && !session.alive) {
      session.paused = false;
      void syncLivePreview();
    }
  } catch (error) {
    reportCompileSaveFailure("live preview save", useFilesStore.getState(), error);
  }
}

function scheduleSave(): void {
  clearSaveTimer();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveForLive();
  }, LIVE_SAVE_DEBOUNCE_MS);
}

function onFiles(state: FilesState, previous: FilesState): void {
  if (
    state.projectId !== previous.projectId ||
    state.engine !== previous.engine ||
    state.engineLoaded !== previous.engineLoaded ||
    state.mainDoc !== previous.mainDoc ||
    state.loading !== previous.loading
  ) {
    void syncLivePreview();
  }
  if (
    session &&
    state.projectId === session.projectId &&
    state.activePath === previous.activePath &&
    activeContent(state) !== activeContent(previous)
  ) {
    scheduleSave();
  }
}

function onStatus(payload: StatusPayload): void {
  if (payload.projectId !== session?.projectId || payload.sessionId < session.sessionId) return;
  session.sessionId = payload.sessionId;
  if (payload.state === "compiling") {
    const files = useFilesStore.getState();
    cycleRevision =
      activeDirty(files) && savedRevision !== null ? savedRevision : compileProjectRevision(payload.projectId);
  }
  if (payload.state === "stopped" || payload.state === "idle" || payload.state === "failed") {
    session.alive = false;
  }
  const status = STATUS_FOR[payload.state];
  if (status) setStatus(payload.projectId, status, payload.state === "failed" ? payload.message : null);
}

function onResult(payload: ResultPayload): void {
  const files = useFilesStore.getState();
  if (files.projectId !== payload.projectId || !typstLivePreviewWanted(files)) return;
  if (session?.projectId === payload.projectId && payload.sessionId < session.sessionId) return;
  const projectRevision = cycleRevision ?? compileProjectRevision(payload.projectId);
  cycleRevision = null;
  void applyTypstLiveResult({
    projectId: payload.projectId,
    mainDocument: payload.mainDocument,
    projectRevision,
    result: payload.result,
  }).catch((error: unknown) => logError("live preview", error));
}

function install(): Promise<UnlistenFn[]> {
  if (listening && uninstall) return listening;
  const unsubscribers = [
    useFilesStore.subscribe(onFiles),
    useTypstVariantStore.subscribe(() => void syncLivePreview()),
    useSettingsStore.subscribe((state, previous) => {
      if (state.offline !== previous.offline) void syncLivePreview();
    }),
  ];
  const ready = Promise.all([
    listen<StatusPayload>(STATUS_EVENT, (event) => onStatus(event.payload)),
    listen<ResultPayload>(RESULT_EVENT, (event) => onResult(event.payload)),
  ]);
  listening = ready;
  uninstall = () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
    void ready.then((unlisten) => {
      for (const stop of unlisten) stop();
    });
  };
  return ready;
}

async function stopSession(): Promise<void> {
  const ending = session;
  session = null;
  clearSaveTimer();
  savedRevision = null;
  cycleRevision = null;
  if (!ending) return;
  try {
    await invoke<boolean>("typst_watch_stop", { projectId: ending.projectId });
  } catch (error) {
    void logError("stop live preview", error);
  }
}

async function runSync(): Promise<void> {
  await install();
  const want = desired();
  if (want === "hold") return;
  if (!want) {
    await stopSession();
    return;
  }
  if (session && session.projectId !== want.projectId) await stopSession();
  if (session?.key === want.key && (session.alive || session.paused)) return;
  try {
    const started = await invoke<StartedPayload>("typst_watch_start", {
      projectId: want.projectId,
      mainDoc: want.mainDoc,
      offline: want.offline,
      typstVariant: want.typstVariant,
    });
    session = { projectId: want.projectId, key: want.key, sessionId: started.sessionId, alive: true, paused: false };
    if (useCompileStore.getState().livePreview.status === "starting") setStatus(want.projectId, "on");
  } catch (error) {
    session = null;
    void logError("start live preview", error);
    setStatus(want.projectId, "failed", describeError(error));
  }
}

export function syncLivePreview(): Promise<void> {
  queue = queue.then(runSync, runSync);
  return queue;
}

export function stopLivePreview(): Promise<void> {
  queue = queue.then(stopSession, stopSession);
  return queue;
}

function stoppedSession(): LiveSession | null {
  if (session) return session;
  if (!compilingProject) return null;
  const want = desired();
  if (!want || want === "hold" || want.projectId !== compilingProject) return null;
  session = { projectId: compilingProject, key: want.key, sessionId: 0, alive: false, paused: true };
  return session;
}

async function interruptSession(): Promise<void> {
  clearSaveTimer();
  const running = stoppedSession();
  if (!running) return;
  running.alive = false;
  running.paused = true;
  try {
    await invoke<boolean>("typst_watch_stop", { projectId: running.projectId });
  } catch (error) {
    void logError("stop live preview", error);
  }
  const live = useCompileStore.getState().livePreview;
  if (live.projectId === running.projectId && BUSY_STATUSES.has(live.status)) setStatus(running.projectId, "on");
}

export function interruptLivePreview(): Promise<void> {
  interruptions += 1;
  queue = queue.then(interruptSession, interruptSession);
  return queue;
}

function stoppedResult(): CompileResult {
  return {
    ok: false,
    has_pdf: false,
    output_id: null,
    output_revision: null,
    log: "",
    errors: [],
    diagnostics: [],
    synctex_path: null,
    out_dir: null,
    compile_time_ms: 0,
    stopped: true,
  };
}

export async function disposeLivePreview(): Promise<void> {
  await stopLivePreview();
  uninstall?.();
  uninstall = null;
  listening = null;
}

export async function compileLive(request: LiveCompileRequest): Promise<CompileResult> {
  await install();
  const interruptedBefore = interruptions;
  compilingProject = request.projectId;
  let result: CompileResult;
  try {
    result = await invoke<CompileResult>("typst_watch_compile", {
      projectId: request.projectId,
      mainDoc: request.mainDoc,
      offline: request.offline,
      typstVariant: request.typstVariant,
      fresh: request.fresh,
    });
  } catch (error) {
    if (interruptions !== interruptedBefore) return stoppedResult();
    throw error;
  } finally {
    if (compilingProject === request.projectId) compilingProject = null;
  }
  if (interruptions !== interruptedBefore) return result;
  const want = desired();
  if (want && want !== "hold" && want.projectId === request.projectId) {
    const sessionId = session?.projectId === request.projectId ? session.sessionId : 0;
    session = { projectId: request.projectId, key: want.key, sessionId, alive: true, paused: false };
  }
  return result;
}
