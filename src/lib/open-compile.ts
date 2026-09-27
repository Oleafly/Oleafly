import type { MainDecision } from "@/lib/tauri";

export function shouldCompileOnOpen(
  projectId: string | null,
  hasFiles: boolean,
  engineLoaded: boolean,
  alreadyCompiledProjectId: string | null,
  _viewMode: string,
  compileStatus: string,
  projectHydrated = true,
  hasValidCurrentArtifact = false,
) {
  return (
    !!projectId &&
    hasFiles &&
    engineLoaded &&
    projectHydrated &&
    !hasValidCurrentArtifact &&
    compileStatus !== "compiling" &&
    alreadyCompiledProjectId !== projectId
  );
}

export function resetOpenCompileMarker<T>(
  projectId: string | null,
  marker: T | null,
): T | null {
  return projectId === null ? null : marker;
}

export const OPEN_COMPILE_RETRY_LIMIT = 1;

export interface OpenCompileRequest {
  projectId: string;
  mainDocument: string;
  projectRevision: number;
}

export interface OpenCompileObservation {
  projectId: string | null;
  mainDocument: string;
  loading: boolean;
  analysisProjectId: string | null;
  analysisProjectRevision: number;
  attempt: OpenCompileRequest | null;
  hasCurrentArtifact: boolean;
}

export interface OpenCompileRetries {
  projectId: string;
  used: number;
}

export interface OpenCompileSettlement {
  compiled: boolean;
  retries: OpenCompileRetries | null;
}

export function settleOpenCompile(
  request: OpenCompileRequest,
  observed: OpenCompileObservation,
  retries: OpenCompileRetries | null,
): OpenCompileSettlement {
  const sameOpen =
    observed.projectId === request.projectId &&
    observed.mainDocument === request.mainDocument &&
    !observed.loading &&
    observed.analysisProjectId === request.projectId;
  const attempt =
    sameOpen &&
    observed.attempt?.projectId === request.projectId &&
    observed.attempt.mainDocument === request.mainDocument
      ? observed.attempt
      : null;
  const revisionHeld =
    sameOpen && observed.analysisProjectRevision === request.projectRevision;
  if (
    revisionHeld &&
    (attempt?.projectRevision === request.projectRevision ||
      observed.hasCurrentArtifact)
  ) {
    return { compiled: true, retries: null };
  }
  const startedSinceRequest =
    attempt !== null &&
    attempt.projectRevision >= request.projectRevision &&
    attempt.projectRevision <= observed.analysisProjectRevision;
  if (!startedSinceRequest) return { compiled: false, retries };
  const used = retries?.projectId === request.projectId ? retries.used : 0;
  if (used >= OPEN_COMPILE_RETRY_LIMIT) return { compiled: true, retries: null };
  return {
    compiled: false,
    retries: { projectId: request.projectId, used: used + 1 },
  };
}

export function openCompileHydrated(
  projectLoading: boolean,
  projectId: string | null,
  analysisProjectId: string | null,
  analysisProjectRevision: number,
) {
  return (
    !projectLoading &&
    !!projectId &&
    analysisProjectId === projectId &&
    analysisProjectRevision > 0
  );
}

export function automaticCompileAllowed(decision: MainDecision): boolean {
  return decision === "auto";
}

export function agentCompileAllowed(decision: MainDecision): boolean {
  return decision !== "no_main";
}
