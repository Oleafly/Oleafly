import { create } from "zustand";
import type { ProjectIndex } from "@/lib/index/types";
import { lazyLegacyIndex } from "@/lib/project-intelligence/legacy-index";
import { mergeLanguageServiceIntelligence } from "@/lib/project-intelligence/merge-language-service";
import {
  isProjectIntelligencePath,
  normalizeProjectPath,
} from "@/lib/project-intelligence/source";
import type {
  BibliographyEntryDetail,
  ExternalProjectIntelligence,
  ProjectIntelligenceIdentity,
  ProjectIntelligenceSnapshot,
  ProjectIntelligenceState,
} from "@/lib/project-intelligence/types";
import {
  ProjectIntelligenceWorkerClient,
  ProjectIntelligenceWorkerError,
  type ProjectIntelligenceAnalyzeInput,
} from "@/lib/project-intelligence/worker-client";
import type {
  ProjectFileUpsert,
  ProjectUnreadableFile,
} from "@/lib/project-intelligence/worker-protocol";
import {
  readProjectSourcesBatch,
  resetProjectSourcesCache,
} from "@/lib/project-sources";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { useFilesStore } from "@/store/files";

const PROJECT_ANALYSIS_IDLE_MS = 300;

export interface IndexStore {
  index: ProjectIndex | null;
  // Path -> exact text represented by the pending/current analysis request.
  texts: Record<string, string>;
  building: boolean;
  projectRevision: number;
  requestGeneration: number;
  intelligenceState: ProjectIntelligenceState;
  rebuildFromDisk: () => Promise<void>;
  invalidateFilesystem: () => void;
  updateFile: (path: string, text: string) => void;
  deleteFile: (path: string) => void;
  renameFile: (from: string, to: string) => void;
  mergeLanguageService: (
    contribution: ExternalProjectIntelligence,
  ) => boolean;
  retryIntelligence: () => Promise<void>;
  reset: () => void;
  dispose: () => void;
}

interface ScheduledAnalysis {
  readonly identity: ProjectIntelligenceIdentity;
  readonly input: Omit<
    ProjectIntelligenceAnalyzeInput,
    "identity"
  >;
}

let rebuildSequence = 0;
let activeProjectId: string | null = null;
let projectRevision = 0;
let filesystemEpoch = 0;
let requestGeneration = 0;
let workerProjectId: string | null = null;
let workerNeedsReset = true;
let workerKnownSourceFiles = new Set<string>();
let knownFilesSignature = "";
let unreadableFiles = new Set<string>();
let sourceRevisions = new Map<string, number>();
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledAnalysis: ScheduledAnalysis | null = null;
let workerClient: ProjectIntelligenceWorkerClient | null = null;
let externalContribution: ExternalProjectIntelligence | null = null;

const initialIntelligenceState = (
  reason = "No project is active.",
): ProjectIntelligenceState => ({
  status: "not_run",
  identity: null,
  data: null,
  stale: false,
  reason,
});

function getWorkerClient(): ProjectIntelligenceWorkerClient {
  workerClient ??= new ProjectIntelligenceWorkerClient();
  return workerClient;
}

function stopAnalysisTimer(): void {
  if (analysisTimer !== null) {
    clearTimeout(analysisTimer);
    analysisTimer = null;
  }
  scheduledAnalysis = null;
}

function resetRuntimeState(): void {
  stopAnalysisTimer();
  resetProjectSourcesCache();
  activeProjectId = null;
  projectRevision = 0;
  filesystemEpoch = 0;
  requestGeneration = 0;
  workerProjectId = null;
  workerNeedsReset = true;
  workerKnownSourceFiles = new Set();
  knownFilesSignature = "";
  unreadableFiles = new Set();
  sourceRevisions = new Map();
  externalContribution = null;
}

function ensureProject(projectId: string): void {
  if (activeProjectId === projectId) return;
  stopAnalysisTimer();
  resetProjectSourcesCache();
  activeProjectId = projectId;
  projectRevision = 0;
  filesystemEpoch = 0;
  requestGeneration = 0;
  workerNeedsReset = true;
  workerKnownSourceFiles = new Set();
  knownFilesSignature = "";
  unreadableFiles = new Set();
  sourceRevisions = new Map();
  externalContribution = null;
}

function nextSourceRevision(path: string): number {
  const next = (sourceRevisions.get(path) ?? 0) + 1;
  sourceRevisions.set(path, next);
  return next;
}

function currentSourceRevision(path: string): number {
  return sourceRevisions.get(path) ?? nextSourceRevision(path);
}

function treePaths(): string[] {
  return useFilesStore
    .getState()
    .tree.filter((entry) => !entry.is_dir)
    .map((entry) => normalizeProjectPath(entry.path))
    .filter((path): path is string => path !== null)
    .sort();
}

function currentKnownFiles(extraPath?: string): string[] {
  const paths = new Set(treePaths());
  const normalizedExtra = extraPath
    ? normalizeProjectPath(extraPath)
    : null;
  if (normalizedExtra) paths.add(normalizedExtra);
  return [...paths].sort((a, b) => Number(a > b) - Number(a < b));
}

function sourcePathsFromKnown(
  knownFiles: readonly string[],
): string[] {
  return knownFiles.filter(isProjectIntelligencePath);
}

export function currentProjectSourcePaths(
  extraPath?: string,
): string[] {
  return sourcePathsFromKnown(currentKnownFiles(extraPath));
}

export function projectFilesystemEpoch(): number {
  return filesystemEpoch;
}

export function bibliographyEntryDetails(
  snapshot: ProjectIntelligenceSnapshot,
  entryIds: readonly string[],
): Promise<readonly BibliographyEntryDetail[]> {
  if (entryIds.length === 0) return Promise.resolve([]);
  if (!workerClient) {
    return Promise.reject(
      new ProjectIntelligenceWorkerError(
        "The project-intelligence worker holds no analysis for this snapshot.",
        "stale_snapshot",
        false,
      ),
    );
  }
  return workerClient.bibliographyEntries(snapshot.identity, entryIds);
}

function sameIdentity(
  left: ProjectIntelligenceIdentity | null,
  right: ProjectIntelligenceIdentity,
): boolean {
  return (
    left !== null &&
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.requestGeneration === right.requestGeneration
  );
}

function runningState(
  previous: ProjectIntelligenceState,
  identity: ProjectIntelligenceIdentity,
  currentFileFallbackAllowed = false,
): ProjectIntelligenceState {
  const retained = previous.data;
  return {
    status: "running",
    identity,
    data: retained,
    stale: retained !== null,
    currentFileFallbackAllowed,
    reason: retained
      ? "Project content changed. Retained analysis is stale while the current revision runs."
      : "Project intelligence is analyzing the current revision.",
  };
}

function failureState(
  previous: ProjectIntelligenceState,
  identity: ProjectIntelligenceIdentity,
  error: unknown,
): ProjectIntelligenceState {
  const workerError =
    error instanceof ProjectIntelligenceWorkerError ? error : null;
  const unavailable = workerError?.code === "worker_unavailable";
  return {
    status: unavailable ? "unavailable" : "error",
    identity,
    data: previous.data,
    stale: previous.data !== null,
    reason: unavailable
      ? "The project-intelligence worker is unavailable."
      : "Current-revision project analysis failed.",
    failure: {
      name:
        error instanceof Error
          ? error.name
          : "ProjectIntelligenceError",
      message:
        error instanceof Error
          ? error.message
          : "Project intelligence failed.",
      retryable: workerError?.retryable ?? true,
    },
  };
}

function normalizedKnownSignature(paths: readonly string[]): string {
  return paths.join("\0");
}

export async function readProjectSources(
  projectId: string,
  paths: readonly string[],
  options: { readonly diskForDirty?: boolean } = {},
): Promise<{
  texts: Record<string, string>;
  unreadable: Set<string>;
}> {
  const texts: Record<string, string> = {};
  const files = useFilesStore.getState();
  const diskPaths: string[] = [];
  for (const path of paths) {
    const open = files.files[path];
    if (open && (!options.diskForDirty || !open.dirty)) {
      texts[path] = open.content;
    } else {
      diskPaths.push(path);
    }
  }
  const loaded = await readProjectSourcesBatch(projectId, diskPaths);
  Object.assign(texts, loaded.texts);
  return { texts, unreadable: loaded.unreadable };
}

export const useIndexStore = create<IndexStore>((set, get) => {
  const runScheduledAnalysis = async (
    scheduled: ScheduledAnalysis,
  ): Promise<void> => {
    let snapshot: ProjectIntelligenceSnapshot;
    try {
      snapshot = await getWorkerClient().analyze({
        ...scheduled.input,
        identity: scheduled.identity,
      });
    } catch (error) {
      workerNeedsReset = true;
      const current = get();
      if (
        !sameIdentity(
          current.intelligenceState.identity,
          scheduled.identity,
        ) ||
        useFilesStore.getState().projectId !==
          scheduled.identity.projectId
      ) {
        return;
      }
      set({
        building: false,
        intelligenceState: failureState(
          current.intelligenceState,
          scheduled.identity,
          error,
        ),
      });
      return;
    }

    const current = get();
    if (
      !sameIdentity(
        current.intelligenceState.identity,
        scheduled.identity,
      ) ||
      useFilesStore.getState().projectId !==
        scheduled.identity.projectId
    ) {
      return;
    }
    const merged =
      externalContribution &&
      sameIdentity(externalContribution.identity, scheduled.identity)
        ? mergeLanguageServiceIntelligence(
            snapshot,
            externalContribution,
          )
        : snapshot;
    set({
      index: lazyLegacyIndex(merged),
      building: false,
      intelligenceState: {
        status: merged.status,
        identity: merged.identity,
        data: merged,
        stale: false,
        ...(merged.reason ? { reason: merged.reason } : {}),
      },
    });
  };

  const scheduleAnalysis = (
    projectId: string,
    options: {
      readonly knownFiles: readonly string[];
      readonly upserts: readonly ProjectFileUpsert[];
      readonly removals: readonly string[];
      readonly unreadable: readonly ProjectUnreadableFile[];
      readonly mainDocument?: string;
      readonly immediate?: boolean;
      readonly texts?: Record<string, string>;
      readonly currentFileFallbackAllowed?: boolean;
    },
  ): ProjectIntelligenceIdentity => {
    ensureProject(projectId);
    const priorScheduled = scheduledAnalysis;
    const identity: ProjectIntelligenceIdentity = {
      projectId,
      projectRevision,
      requestGeneration: ++requestGeneration,
    };
    const reset =
      workerNeedsReset || workerProjectId !== projectId;
    if (reset) {
      workerNeedsReset = false;
      workerProjectId = projectId;
    }
    const analysisTexts = options.texts ?? get().texts;
    const readableByPath = new Map(
      options.upserts.map((file) => [file.file, file]),
    );
    const upserts = reset
      ? sourcePathsFromKnown(options.knownFiles)
          .map((file) => {
            const explicit = readableByPath.get(file);
            if (explicit) return explicit;
            const text = analysisTexts[file];
            return text === undefined
              ? null
              : {
                  file,
                  sourceRevision: currentSourceRevision(file),
                  text,
                };
          })
          .filter(
            (file): file is ProjectFileUpsert => file !== null,
          )
      : options.upserts;
    const combinedUpserts = new Map<string, ProjectFileUpsert>();
    if (priorScheduled?.identity.projectId === projectId) {
      for (const file of priorScheduled.input.upserts) {
        combinedUpserts.set(file.file, file);
      }
    }
    for (const file of upserts) combinedUpserts.set(file.file, file);
    const combinedRemovals = new Set<string>(
      priorScheduled?.identity.projectId === projectId
        ? priorScheduled.input.removals
        : [],
    );
    for (const file of options.removals) combinedRemovals.add(file);
    for (const file of combinedUpserts.keys()) combinedRemovals.delete(file);
    const combinedUnreadable = new Map<string, ProjectUnreadableFile>();
    if (priorScheduled?.identity.projectId === projectId) {
      for (const file of priorScheduled.input.unreadable) {
        combinedUnreadable.set(file.file, file);
      }
    }
    for (const file of options.unreadable) {
      combinedUnreadable.set(file.file, file);
      combinedUpserts.delete(file.file);
    }
    for (const file of combinedRemovals) combinedUnreadable.delete(file);

    const scheduled: ScheduledAnalysis = {
      identity,
      input: {
        reset:
          reset ||
          (priorScheduled?.identity.projectId === projectId &&
            priorScheduled.input.reset),
        ...(options.mainDocument
          ? { mainDocument: options.mainDocument }
          : {}),
        knownFiles: [...options.knownFiles],
        upserts: [...combinedUpserts.values()],
        removals: reset ? [] : [...combinedRemovals],
        unreadable: [...combinedUnreadable.values()],
      },
    };
    workerKnownSourceFiles = new Set(
      sourcePathsFromKnown(options.knownFiles),
    );
    stopAnalysisTimer();
    scheduledAnalysis = scheduled;
    set((state) => ({
      ...(options.texts ? { texts: options.texts } : {}),
      building: true,
      projectRevision,
      requestGeneration,
      intelligenceState: runningState(
        state.intelligenceState,
        identity,
        options.currentFileFallbackAllowed ?? false,
      ),
    }));
    const dispatch = () => {
      if (scheduledAnalysis !== scheduled) return;
      scheduledAnalysis = null;
      analysisTimer = null;
      void runScheduledAnalysis(scheduled);
    };
    if (options.immediate) dispatch();
    else analysisTimer = setTimeout(dispatch, PROJECT_ANALYSIS_IDLE_MS);
    return identity;
  };

  const scheduleCurrentTexts = (
    projectId: string,
    changedPaths: readonly string[],
    options: {
      readonly immediate?: boolean;
      readonly removedPaths?: readonly string[];
      readonly texts?: Record<string, string>;
      readonly currentFileFallbackAllowed?: boolean;
    } = {},
  ): void => {
    const current = get();
    const analysisTexts = options.texts ?? current.texts;
    const removedPaths = new Set(options.removedPaths ?? []);
    const knownFiles = [
      ...new Set([
        ...currentKnownFiles(),
        ...Object.keys(analysisTexts),
        ...changedPaths,
      ]),
    ]
      .filter((path) => !removedPaths.has(path))
      .sort((a, b) => Number(a > b) - Number(a < b));
    const sourcePaths = new Set(sourcePathsFromKnown(knownFiles));
    const removals = [...workerKnownSourceFiles].filter(
      (path) => !sourcePaths.has(path),
    );
    const upserts = changedPaths
      .filter((path) => sourcePaths.has(path))
      .map((file) => ({
        file,
        sourceRevision: currentSourceRevision(file),
        text: analysisTexts[file],
      }))
      .filter(
        (file): file is ProjectFileUpsert =>
          file.text !== undefined,
      );
    scheduleAnalysis(projectId, {
      knownFiles,
      upserts,
      removals,
      unreadable: [...unreadableFiles]
        .filter((file) => sourcePaths.has(file))
        .map((file) => ({
          file,
          sourceRevision: currentSourceRevision(file),
          message: "The project file could not be read.",
        })),
      mainDocument: resolveEffectiveMainDoc().mainDoc,
      ...(options.immediate === undefined
        ? {}
        : { immediate: options.immediate }),
      ...(options.texts ? { texts: options.texts } : {}),
      currentFileFallbackAllowed:
        options.currentFileFallbackAllowed ?? false,
    });
  };

  return {
    index: null,
    texts: {},
    building: false,
    projectRevision: 0,
    requestGeneration: 0,
    intelligenceState: initialIntelligenceState(),

    invalidateFilesystem: () => {
      const projectId = useFilesStore.getState().projectId;
      if (!projectId) return;
      ensureProject(projectId);
      // Invalidate synchronously when the file tree changes. The debounced
      // disk read may follow, but an old graph must not remain current during
      // that debounce window or while an older worker response is in flight.
      rebuildSequence++;
      stopAnalysisTimer();
      projectRevision = Math.max(1, projectRevision + 1);
      filesystemEpoch++;
      externalContribution = null;
      const identity: ProjectIntelligenceIdentity = {
        projectId,
        projectRevision,
        requestGeneration: ++requestGeneration,
      };
      set((state) => ({
        building: true,
        projectRevision,
        requestGeneration,
        intelligenceState: {
          ...runningState(state.intelligenceState, identity),
          reason:
            "Project files changed. The source graph is being refreshed.",
        },
      }));
    },

    rebuildFromDisk: async () => {
      const sequence = ++rebuildSequence;
      const files = useFilesStore.getState();
      const projectId = files.projectId;
      if (!projectId) return;
      ensureProject(projectId);
      const intelligenceBeforeRead = get().intelligenceState;
      set((state) => ({
        building: true,
        intelligenceState: {
          status: "running",
          identity: state.intelligenceState.identity,
          data: state.intelligenceState.data,
          stale: state.intelligenceState.data !== null,
          reason:
            "Project files changed. Source snapshots are being loaded for current analysis.",
        },
      }));

      const knownFiles = currentKnownFiles();
      const sourcePaths = sourcePathsFromKnown(knownFiles);
      try {
        const loaded = await readProjectSources(
          projectId,
          sourcePaths,
        );
        if (
          sequence !== rebuildSequence ||
          useFilesStore.getState().projectId !== projectId ||
          normalizedKnownSignature(currentKnownFiles()) !==
            normalizedKnownSignature(knownFiles)
        ) {
          return;
        }

        const previous = get();
        const previousPaths = new Set(Object.keys(previous.texts));
        const nextPaths = new Set(Object.keys(loaded.texts));
        const changedPaths = Object.entries(loaded.texts)
          .filter(
            ([path, text]) =>
              previous.texts[path] !== text ||
              !sourceRevisions.has(path),
          )
          .map(([path]) => path);
        const removedPaths = [...previousPaths].filter(
          (path) => !nextPaths.has(path),
        );
        const unreadableChanged =
          [...loaded.unreadable].some(
            (path) => !unreadableFiles.has(path),
          ) ||
          [...unreadableFiles].some(
            (path) => !loaded.unreadable.has(path),
          );
        const nextKnownSignature =
          normalizedKnownSignature(knownFiles);
        const projectChanged =
          projectRevision === 0 ||
          changedPaths.length > 0 ||
          removedPaths.length > 0 ||
          unreadableChanged ||
          nextKnownSignature !== knownFilesSignature;

        for (const path of changedPaths) nextSourceRevision(path);
        for (const path of loaded.unreadable) {
          if (!unreadableFiles.has(path)) nextSourceRevision(path);
        }
        for (const path of removedPaths) {
          nextSourceRevision(path);
        }
        unreadableFiles = loaded.unreadable;
        knownFilesSignature = nextKnownSignature;
        if (
          !projectChanged &&
          intelligenceBeforeRead.data &&
          !intelligenceBeforeRead.stale &&
          (intelligenceBeforeRead.status === "success" ||
            intelligenceBeforeRead.status === "partial") &&
          !workerNeedsReset
        ) {
          set({
            texts: loaded.texts,
            building: false,
            intelligenceState: intelligenceBeforeRead,
          });
          return;
        }
        if (projectChanged) {
          projectRevision++;
          externalContribution = null;
        }

        const reset =
          workerNeedsReset || workerProjectId !== projectId;
        const pathsToSend = reset
          ? Object.keys(loaded.texts)
          : changedPaths;
        const workerRemovals = [...workerKnownSourceFiles].filter(
          (path) => !new Set(sourcePaths).has(path),
        );
        scheduleAnalysis(projectId, {
          knownFiles,
          upserts: pathsToSend.map((file) => ({
            file,
            sourceRevision: currentSourceRevision(file),
            text: loaded.texts[file],
          })),
          removals: workerRemovals,
          unreadable: [...loaded.unreadable].map((file) => ({
            file,
            sourceRevision: currentSourceRevision(file),
            message: "The project file could not be read.",
          })),
          mainDocument: resolveEffectiveMainDoc().mainDoc,
          immediate: true,
          texts: loaded.texts,
        });
      } catch (error) {
        if (
          sequence !== rebuildSequence ||
          useFilesStore.getState().projectId !== projectId
        ) {
          return;
        }
        if (projectRevision === 0) projectRevision = 1;
        const identity: ProjectIntelligenceIdentity = {
          projectId,
          projectRevision,
          requestGeneration: ++requestGeneration,
        };
        const current = get();
        set({
          building: false,
          projectRevision,
          requestGeneration,
          intelligenceState: failureState(
            current.intelligenceState,
            identity,
            error,
          ),
        });
      }
    },

    updateFile: (rawPath, text) => {
      const path = normalizeProjectPath(rawPath);
      if (!path || !isProjectIntelligencePath(path)) return;
      const projectId = useFilesStore.getState().projectId;
      if (!projectId) return;
      ensureProject(projectId);
      const current = get();
      if (current.texts[path] === text) return;
      const currentFileFallbackAllowed =
        current.intelligenceState.currentFileFallbackAllowed === true ||
        (!current.intelligenceState.stale &&
          (current.intelligenceState.status === "success" ||
            current.intelligenceState.status === "partial"));
      rebuildSequence++;
      nextSourceRevision(path);
      projectRevision = Math.max(1, projectRevision + 1);
      externalContribution = null;
      unreadableFiles.delete(path);
      const texts = { ...current.texts, [path]: text };
      scheduleCurrentTexts(projectId, [path], {
        texts,
        currentFileFallbackAllowed,
      });
    },

    deleteFile: (rawPath) => {
      const path = normalizeProjectPath(rawPath);
      const projectId = useFilesStore.getState().projectId;
      if (!path || !projectId) return;
      ensureProject(projectId);
      const current = get();
      if (!(path in current.texts) && !sourceRevisions.has(path)) return;
      rebuildSequence++;
      const texts = { ...current.texts };
      delete texts[path];
      nextSourceRevision(path);
      unreadableFiles.delete(path);
      projectRevision = Math.max(1, projectRevision + 1);
      filesystemEpoch++;
      externalContribution = null;
      scheduleCurrentTexts(projectId, [], {
        removedPaths: [path],
        texts,
      });
    },

    renameFile: (rawFrom, rawTo) => {
      const from = normalizeProjectPath(rawFrom);
      const to = normalizeProjectPath(rawTo);
      const projectId = useFilesStore.getState().projectId;
      if (!from || !to || !projectId || from === to) return;
      ensureProject(projectId);
      const current = get();
      const texts = { ...current.texts };
      const content = texts[from];
      delete texts[from];
      if (content !== undefined && isProjectIntelligencePath(to)) {
        texts[to] = content;
      }
      const priorRevision = sourceRevisions.get(from);
      const targetRevision = sourceRevisions.get(to);
      nextSourceRevision(from);
      if (content !== undefined && isProjectIntelligencePath(to)) {
        sourceRevisions.set(
          to,
          Math.max(priorRevision ?? 0, targetRevision ?? 0) + 1,
        );
      }
      unreadableFiles.delete(from);
      projectRevision = Math.max(1, projectRevision + 1);
      filesystemEpoch++;
      externalContribution = null;
      rebuildSequence++;
      scheduleCurrentTexts(
        projectId,
        content !== undefined && isProjectIntelligencePath(to)
          ? [to]
          : [],
        { removedPaths: [from], texts },
      );
    },

    mergeLanguageService: (contribution) => {
      const current = get();
      const snapshot = current.intelligenceState.data;
      if (
        !sameIdentity(
          current.intelligenceState.identity,
          contribution.identity,
        )
      ) {
        return false;
      }
      externalContribution = contribution;
      if (
        !snapshot ||
        current.intelligenceState.stale ||
        !sameIdentity(snapshot.identity, contribution.identity)
      ) {
        // The worker is still producing this exact identity. Retain the
        // current-revision contribution and merge it atomically when the local
        // snapshot arrives; never paint it onto the retained stale snapshot.
        return true;
      }
      const merged = mergeLanguageServiceIntelligence(
        snapshot,
        contribution,
      );
      set({
        index: lazyLegacyIndex(merged),
        intelligenceState: {
          ...current.intelligenceState,
          data: merged,
        },
      });
      return true;
    },

    retryIntelligence: async () => {
      workerNeedsReset = true;
      await get().rebuildFromDisk();
    },

    reset: () => {
      rebuildSequence++;
      resetRuntimeState();
      set({
        index: null,
        texts: {},
        building: false,
        projectRevision: 0,
        requestGeneration: 0,
        intelligenceState: initialIntelligenceState(),
      });
    },

    dispose: () => {
      rebuildSequence++;
      resetRuntimeState();
      workerClient?.dispose();
      workerClient = null;
      set({
        index: null,
        texts: {},
        building: false,
        projectRevision: 0,
        requestGeneration: 0,
        intelligenceState: initialIntelligenceState(
          "Project intelligence is stopped.",
        ),
      });
    },
  };
});
