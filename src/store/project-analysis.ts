import { create, type StateCreator } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { ProjectIndex } from "@/lib/index/types";
import {
  createFeaturePlaceholders,
  createProjectAnalysisSnapshot,
  isProjectAnalysisIdentityCurrent,
  normalizeAnalysisFailure,
  normalizeProjectIndex,
  notRunAnalysisSlot,
  sameAnalysisRequest,
  type AnalysisFailure,
  type AnalysisSlot,
  type NormalizedDiagnostic,
  type ProjectDocumentDiagnostics,
  type ProjectAnalysisFeature,
  type ProjectAnalysisIdentity,
  type ProjectAnalysisRequestIdentity,
  type ProjectAnalysisSnapshot,
  type ProjectLanguageServiceSnapshot,
} from "@/lib/analysis/project-snapshot";

export interface ProjectIndexUpdate {
  request: ProjectAnalysisRequestIdentity;
  index: ProjectIndex;
  partialReason?: string;
}

export interface ProjectAnalysisStore {
  snapshot: ProjectAnalysisSnapshot;
  activateProject: (identity: ProjectAnalysisIdentity) => void;
  setProjectRevision: (revision: number) => boolean;
  setDocumentVersion: (uri: string, version: number) => boolean;
  setLocalDocument: (
    uri: string,
    version: number,
    reason: string,
  ) => boolean;
  removeDocument: (uri: string) => void;
  beginDocumentDiagnostics: (
    uri: string,
    diagnosticEpoch: number,
    request: ProjectAnalysisRequestIdentity,
  ) => boolean;
  resolveDocumentDiagnostics: (
    uri: string,
    diagnosticEpoch: number,
    request: ProjectAnalysisRequestIdentity,
    data: NormalizedDiagnostic[],
  ) => boolean;
  clearDocumentDiagnostics: (uri: string) => void;
  setLanguageService: (
    update: Partial<ProjectLanguageServiceSnapshot>,
  ) => void;
  invalidateLanguageService: (generation: number) => void;
  beginFeature: (
    feature: ProjectAnalysisFeature,
    request: ProjectAnalysisRequestIdentity,
  ) => boolean;
  resolveFeature: (
    feature: ProjectAnalysisFeature,
    request: ProjectAnalysisRequestIdentity,
    data: unknown,
  ) => boolean;
  resolveFeaturePartial: (
    feature: ProjectAnalysisFeature,
    request: ProjectAnalysisRequestIdentity,
    data: unknown,
    reason: string,
  ) => boolean;
  failFeature: (
    feature: ProjectAnalysisFeature,
    request: ProjectAnalysisRequestIdentity,
    failure: AnalysisFailure,
  ) => boolean;
  markFeatureUnsupported: (
    feature: ProjectAnalysisFeature,
    reason: string,
  ) => void;
  markFeatureUnavailable: (
    feature: ProjectAnalysisFeature,
    reason: string,
    retryable?: boolean,
  ) => void;
  markFeatureNotRun: (
    feature: ProjectAnalysisFeature,
    reason?: string,
  ) => void;
  beginProjectIndex: (
    request: ProjectAnalysisRequestIdentity,
  ) => boolean;
  installProjectIndex: (update: ProjectIndexUpdate) => boolean;
  failProjectIndex: (
    request: ProjectAnalysisRequestIdentity,
    failure: AnalysisFailure,
  ) => boolean;
  reset: () => void;
}

export type ProjectAnalysisStoreApi = StoreApi<ProjectAnalysisStore>;

const validRevision = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

function requestMatchesFeature(
  snapshot: ProjectAnalysisSnapshot,
  feature: ProjectAnalysisFeature,
  request: ProjectAnalysisRequestIdentity,
): boolean {
  if (!isProjectAnalysisIdentityCurrent(snapshot, request)) return false;
  const slot = snapshot.features[feature];
  return slot.status === "running" && sameAnalysisRequest(slot.request, request);
}

function requestMatchesIndex(
  snapshot: ProjectAnalysisSnapshot,
  request: ProjectAnalysisRequestIdentity,
): boolean {
  if (!isProjectAnalysisIdentityCurrent(snapshot, request)) return false;
  return (
    snapshot.projectIndex.status === "running" &&
    sameAnalysisRequest(snapshot.projectIndex.request, request)
  );
}

function sameRequestLane(
  left: ProjectAnalysisRequestIdentity,
  right: ProjectAnalysisRequestIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.languageServiceGeneration ===
      right.languageServiceGeneration &&
    left.documentUri === right.documentUri &&
    left.documentVersion === right.documentVersion
  );
}

function diagnosticFeatureSlot(
  diagnosticsByUri: Record<string, ProjectDocumentDiagnostics>,
  request: ProjectAnalysisRequestIdentity,
): AnalysisSlot<NormalizedDiagnostic[]> {
  const entries = Object.values(diagnosticsByUri);
  const data = entries.flatMap((entry) => entry.data);
  if (entries.some((entry) => entry.status === "pending")) {
    return {
      status: "partial",
      data,
      request,
      reason:
        "Diagnostics are partial while the language server acknowledges current document revisions.",
      completedAt: Date.now(),
    };
  }
  return {
    status: "success",
    data,
    request,
    completedAt: Date.now(),
  };
}

const createState: StateCreator<ProjectAnalysisStore> = (set, get) => ({
  snapshot: createProjectAnalysisSnapshot(),

  activateProject: (identity) => {
    if (
      !validRevision(identity.projectRevision) ||
      !validRevision(identity.languageServiceGeneration)
    ) {
      throw new RangeError(
        "Project and language-service revisions must be non-negative integers",
      );
    }
    set({ snapshot: createProjectAnalysisSnapshot(identity) });
  },

  setProjectRevision: (revision) => {
    if (!validRevision(revision)) {
      throw new RangeError(
        "projectRevision must be a non-negative integer",
      );
    }
    const current = get().snapshot;
    if (current.identity.projectId === null) return false;
    if (current.identity.projectRevision === revision) return true;
    set({
      snapshot: {
        ...current,
        identity: { ...current.identity, projectRevision: revision },
        diagnosticsByUri: {},
        features: createFeaturePlaceholders(
          "Project content changed. Analysis has not run.",
        ),
        projectIndex: notRunAnalysisSlot(
          "Project content changed. The index is not current.",
        ),
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  setDocumentVersion: (uri, version) => {
    if (!uri || !validRevision(version)) {
      throw new RangeError(
        "Document URI is required and version must be non-negative",
      );
    }
    const current = get().snapshot;
    if (current.identity.projectId === null) return false;
    const prior = current.documents[uri];
    if (prior && version < prior.version) return false;
    if (prior?.version === version) return true;

    const features = { ...current.features };
    const diagnosticsByUri = { ...current.diagnosticsByUri };
    if (prior && prior.version !== version) {
      delete diagnosticsByUri[uri];
      features.diagnostics = notRunAnalysisSlot(
        "Document changed. Diagnostics are awaiting acknowledgement.",
      );
    }
    for (const [feature, slot] of Object.entries(features)) {
      if (
        "request" in slot &&
        slot.request.documentUri === uri &&
        slot.request.documentVersion !== version
      ) {
        features[feature as ProjectAnalysisFeature] =
          notRunAnalysisSlot("Document changed. Analysis has not run.");
      }
    }
    set({
      snapshot: {
        ...current,
        documents: {
          ...current.documents,
          [uri]: { uri, version, analysis: "language_service" },
        },
        diagnosticsByUri,
        features,
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  setLocalDocument: (uri, version, reason) => {
    if (!uri || !validRevision(version)) {
      throw new RangeError(
        "Document URI is required and version must be non-negative",
      );
    }
    const current = get().snapshot;
    if (current.identity.projectId === null) return false;
    const prior = current.documents[uri];
    if (prior && version < prior.version) return false;
    if (
      prior?.version === version &&
      prior.analysis === "local_only" &&
      prior.reason === reason
    ) {
      return true;
    }
    set({
      snapshot: {
        ...current,
        documents: {
          ...current.documents,
          [uri]: {
            uri,
            version,
            analysis: "local_only",
            status: "not_run",
            reason,
          },
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  removeDocument: (uri) => {
    const current = get().snapshot;
    if (!(uri in current.documents)) return;
    const documents = { ...current.documents };
    delete documents[uri];
    const diagnosticsByUri = { ...current.diagnosticsByUri };
    delete diagnosticsByUri[uri];
    const features = { ...current.features };
    for (const [feature, slot] of Object.entries(features)) {
      if ("request" in slot && slot.request.documentUri === uri) {
        features[feature as ProjectAnalysisFeature] =
          notRunAnalysisSlot("Document was closed");
      }
    }
    if (Object.keys(diagnosticsByUri).length === 0) {
      features.diagnostics = notRunAnalysisSlot("No diagnostics have run");
    } else {
      const request = Object.values(diagnosticsByUri).reduce(
        (latest, entry) =>
          entry.request.requestGeneration > latest.requestGeneration
            ? entry.request
            : latest,
        Object.values(diagnosticsByUri)[0].request,
      );
      features.diagnostics = diagnosticFeatureSlot(
        diagnosticsByUri,
        request,
      );
    }
    set({
      snapshot: {
        ...current,
        documents,
        diagnosticsByUri,
        features,
        updatedAt: Date.now(),
      },
    });
  },

  beginDocumentDiagnostics: (uri, diagnosticEpoch, request) => {
    const current = get().snapshot;
    if (
      !uri ||
      !validRevision(diagnosticEpoch) ||
      !isProjectAnalysisIdentityCurrent(current, request) ||
      request.documentUri !== uri
    ) {
      return false;
    }
    const prior = current.diagnosticsByUri[uri];
    if (
      prior &&
      (prior.diagnosticEpoch > diagnosticEpoch ||
        (prior.diagnosticEpoch === diagnosticEpoch &&
          prior.request.requestGeneration >= request.requestGeneration))
    ) {
      return false;
    }
    const diagnosticsByUri = {
      ...current.diagnosticsByUri,
      [uri]: {
        uri,
        diagnosticEpoch,
        status: "pending",
        data: prior?.data ?? [],
        request,
      } satisfies ProjectDocumentDiagnostics,
    };
    set({
      snapshot: {
        ...current,
        diagnosticsByUri,
        features: {
          ...current.features,
          diagnostics: diagnosticFeatureSlot(
            diagnosticsByUri,
            request,
          ),
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  resolveDocumentDiagnostics: (
    uri,
    diagnosticEpoch,
    request,
    data,
  ) => {
    const current = get().snapshot;
    if (!isProjectAnalysisIdentityCurrent(current, request)) return false;
    const prior = current.diagnosticsByUri[uri];
    if (
      prior?.status !== "pending" ||
      prior.diagnosticEpoch !== diagnosticEpoch ||
      !sameAnalysisRequest(prior.request, request)
    ) {
      return false;
    }
    const diagnosticsByUri = {
      ...current.diagnosticsByUri,
      [uri]: {
        ...prior,
        status: "acknowledged",
        data: [...data],
      } satisfies ProjectDocumentDiagnostics,
    };
    set({
      snapshot: {
        ...current,
        diagnosticsByUri,
        features: {
          ...current.features,
          diagnostics: diagnosticFeatureSlot(
            diagnosticsByUri,
            request,
          ),
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  clearDocumentDiagnostics: (uri) => {
    const current = get().snapshot;
    if (!(uri in current.diagnosticsByUri)) return;
    const diagnosticsByUri = { ...current.diagnosticsByUri };
    delete diagnosticsByUri[uri];
    const entries = Object.values(diagnosticsByUri);
    const diagnostics =
      entries.length === 0
        ? notRunAnalysisSlot("No diagnostics have run")
        : diagnosticFeatureSlot(
            diagnosticsByUri,
            entries.reduce(
              (latest, entry) =>
                entry.request.requestGeneration >
                latest.requestGeneration
                  ? entry.request
                  : latest,
              entries[0].request,
            ),
          );
    set({
      snapshot: {
        ...current,
        diagnosticsByUri,
        features: { ...current.features, diagnostics },
        updatedAt: Date.now(),
      },
    });
  },

  setLanguageService: (update) => {
    const current = get().snapshot;
    set({
      snapshot: {
        ...current,
        languageService: {
          ...current.languageService,
          ...update,
          capabilities:
            update.capabilities === undefined
              ? current.languageService.capabilities
              : update.capabilities
                ? { ...update.capabilities }
                : null,
        },
        updatedAt: Date.now(),
      },
    });
  },

  invalidateLanguageService: (generation) => {
    if (!validRevision(generation)) {
      throw new RangeError(
        "Language-service generation must be non-negative",
      );
    }
    const current = get().snapshot;
    set({
      snapshot: {
        ...current,
        identity: {
          ...current.identity,
          languageServiceGeneration: generation,
        },
        diagnosticsByUri: {},
        features: createFeaturePlaceholders(
          "Language service restarted. Analysis has not run.",
        ),
        updatedAt: Date.now(),
      },
    });
  },

  beginFeature: (feature, request) => {
    const current = get().snapshot;
    if (!isProjectAnalysisIdentityCurrent(current, request)) return false;
    const prior = current.features[feature];
    if (
      "request" in prior &&
      sameRequestLane(prior.request, request) &&
      prior.request.requestGeneration >= request.requestGeneration
    ) {
      return false;
    }
    const retained =
      prior.status === "success" || prior.status === "partial"
        ? prior.data
        : null;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: {
            status: "running",
            data: retained,
            request,
            startedAt: Date.now(),
          },
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  resolveFeature: (feature, request, data) => {
    const current = get().snapshot;
    if (!requestMatchesFeature(current, feature, request)) return false;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: {
            status: "success",
            data,
            request,
            completedAt: Date.now(),
          },
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  resolveFeaturePartial: (feature, request, data, reason) => {
    const current = get().snapshot;
    if (!requestMatchesFeature(current, feature, request)) return false;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: {
            status: "partial",
            data,
            request,
            reason,
            completedAt: Date.now(),
          },
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  failFeature: (feature, request, failure) => {
    const current = get().snapshot;
    if (!requestMatchesFeature(current, feature, request)) return false;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: {
            status: "error",
            data: null,
            request,
            failure,
            completedAt: Date.now(),
          },
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  markFeatureUnsupported: (feature, reason) => {
    const current = get().snapshot;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: { status: "unsupported", data: null, reason },
        },
        updatedAt: Date.now(),
      },
    });
  },

  markFeatureUnavailable: (feature, reason, retryable = true) => {
    const current = get().snapshot;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: {
            status: "unavailable",
            data: null,
            reason,
            retryable,
          },
        },
        updatedAt: Date.now(),
      },
    });
  },

  markFeatureNotRun: (feature, reason) => {
    const current = get().snapshot;
    set({
      snapshot: {
        ...current,
        features: {
          ...current.features,
          [feature]: notRunAnalysisSlot(reason),
        },
        updatedAt: Date.now(),
      },
    });
  },

  beginProjectIndex: (request) => {
    const current = get().snapshot;
    if (!isProjectAnalysisIdentityCurrent(current, request)) return false;
    if (
      "request" in current.projectIndex &&
      sameRequestLane(current.projectIndex.request, request) &&
      current.projectIndex.request.requestGeneration >=
        request.requestGeneration
    ) {
      return false;
    }
    set({
      snapshot: {
        ...current,
        projectIndex: {
          status: "running",
          data:
            current.projectIndex.status === "success" ||
            current.projectIndex.status === "partial"
              ? current.projectIndex.data
              : null,
          request,
          startedAt: Date.now(),
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  installProjectIndex: ({ request, index, partialReason }) => {
    const current = get().snapshot;
    if (!requestMatchesIndex(current, request)) return false;
    const data = normalizeProjectIndex(index);
    set({
      snapshot: {
        ...current,
        projectIndex: partialReason
          ? {
              status: "partial",
              data,
              request,
              reason: partialReason,
              completedAt: Date.now(),
            }
          : {
              status: "success",
              data,
              request,
              completedAt: Date.now(),
            },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  failProjectIndex: (request, failure) => {
    const current = get().snapshot;
    if (!requestMatchesIndex(current, request)) return false;
    set({
      snapshot: {
        ...current,
        projectIndex: {
          status: "error",
          data: null,
          request,
          failure,
          completedAt: Date.now(),
        },
        updatedAt: Date.now(),
      },
    });
    return true;
  },

  reset: () => set({ snapshot: createProjectAnalysisSnapshot() }),
});

export function createProjectAnalysisStore(): ProjectAnalysisStoreApi {
  return createStore<ProjectAnalysisStore>()(createState);
}

export const useProjectAnalysisStore =
  create<ProjectAnalysisStore>()(createState);

export function failProjectAnalysisFeature(
  store: ProjectAnalysisStoreApi,
  feature: ProjectAnalysisFeature,
  request: ProjectAnalysisRequestIdentity,
  error: unknown,
  retryable = true,
): boolean {
  return store
    .getState()
    .failFeature(
      feature,
      request,
      normalizeAnalysisFailure(error, retryable),
    );
}
