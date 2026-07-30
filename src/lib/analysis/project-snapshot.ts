import type { ProjectIndex, Sym } from "@/lib/index/types";
import type {
  Diagnostic,
  Position,
  Range,
} from "@/lib/language-service";

export const PROJECT_ANALYSIS_FEATURES = [
  "completion",
  "hover",
  "definition",
  "references",
  "documentSymbols",
  "workspaceSymbols",
  "diagnostics",
  "semanticTokens",
] as const;

export type ProjectAnalysisFeature =
  (typeof PROJECT_ANALYSIS_FEATURES)[number];

export type ProjectAnalysisStatus =
  | "unsupported"
  | "unavailable"
  | "not_run"
  | "running"
  | "error"
  | "partial"
  | "success";

export type LanguageServiceReadiness =
  | "not_run"
  | "starting"
  | "syncing"
  | "ready"
  | "restarting"
  | "installing"
  | "setup_required"
  | "local_only"
  | "unsupported"
  | "unavailable"
  | "stopped";

export interface ProjectAnalysisIdentity {
  projectId: string | null;
  projectRevision: number;
  languageServiceGeneration: number;
}

export interface ProjectAnalysisRequestIdentity
  extends ProjectAnalysisIdentity {
  requestGeneration: number;
  documentUri?: string;
  documentVersion?: number;
}

export interface AnalysisFailure {
  name: string;
  message: string;
  code?: string | number;
  retryable: boolean;
}

export interface UnsupportedAnalysisSlot {
  status: "unsupported";
  data: null;
  reason: string;
}

export interface UnavailableAnalysisSlot {
  status: "unavailable";
  data: null;
  reason: string;
  retryable: boolean;
}

export interface NotRunAnalysisSlot {
  status: "not_run";
  data: null;
  reason?: string;
}

export interface RunningAnalysisSlot<T> {
  status: "running";
  data: T | null;
  request: ProjectAnalysisRequestIdentity;
  startedAt: number;
}

export interface ErrorAnalysisSlot {
  status: "error";
  data: null;
  request: ProjectAnalysisRequestIdentity;
  failure: AnalysisFailure;
  completedAt: number;
}

export interface PartialAnalysisSlot<T> {
  status: "partial";
  data: T;
  request: ProjectAnalysisRequestIdentity;
  reason: string;
  completedAt: number;
}

export interface SuccessAnalysisSlot<T> {
  status: "success";
  data: T;
  request: ProjectAnalysisRequestIdentity;
  completedAt: number;
}

export type AnalysisSlot<T = unknown> =
  | UnsupportedAnalysisSlot
  | UnavailableAnalysisSlot
  | NotRunAnalysisSlot
  | RunningAnalysisSlot<T>
  | ErrorAnalysisSlot
  | PartialAnalysisSlot<T>
  | SuccessAnalysisSlot<T>;

export type ProjectAnalysisFeatureSlots = Record<
  ProjectAnalysisFeature,
  AnalysisSlot
>;

export interface ProjectAnalysisDocument {
  uri: string;
  version: number;
  analysis: "language_service" | "local_only";
  status?: "not_run";
  reason?: string;
}

export interface ProjectLanguageServiceSnapshot {
  kind: "texlab" | "tinymist" | null;
  readiness: LanguageServiceReadiness;
  capabilities: Record<ProjectAnalysisFeature, boolean> | null;
  failure: AnalysisFailure | null;
  reason?: string;
  restartAttempt: number;
}

export interface ProjectDocumentDiagnostics {
  uri: string;
  diagnosticEpoch: number;
  status: "pending" | "acknowledged";
  data: NormalizedDiagnostic[];
  request: ProjectAnalysisRequestIdentity;
}

export interface NormalizedProjectSymbol {
  id: string;
  source: "project-index";
  role: "definition" | "use";
  kind: Sym["kind"];
  name: string;
  uri: string;
  line: number;
  range: { from: number; to: number };
  selectionRange: { from: number; to: number };
  level?: number;
  target?: string;
}

export interface NormalizedProjectIndex {
  definitions: NormalizedProjectSymbol[];
  uses: NormalizedProjectSymbol[];
}

export type NormalizedDiagnosticSeverity =
  | "error"
  | "warning"
  | "information"
  | "hint";

export interface NormalizedDiagnostic {
  id: string;
  uri: string;
  range: Range;
  severity: NormalizedDiagnosticSeverity;
  message: string;
  source: string;
  code?: string | number;
  documentVersion?: number;
  projectRevision: number;
}

export interface ProjectAnalysisSnapshot {
  identity: ProjectAnalysisIdentity;
  documents: Record<string, ProjectAnalysisDocument>;
  languageService: ProjectLanguageServiceSnapshot;
  diagnosticsByUri: Record<string, ProjectDocumentDiagnostics>;
  features: ProjectAnalysisFeatureSlots;
  projectIndex: AnalysisSlot<NormalizedProjectIndex>;
  updatedAt: number;
}

export const notRunAnalysisSlot = (
  reason?: string,
): NotRunAnalysisSlot => ({
  status: "not_run",
  data: null,
  ...(reason ? { reason } : {}),
});

export function createFeaturePlaceholders(
  reason?: string,
): ProjectAnalysisFeatureSlots {
  return Object.fromEntries(
    PROJECT_ANALYSIS_FEATURES.map((feature) => [
      feature,
      notRunAnalysisSlot(reason),
    ]),
  ) as ProjectAnalysisFeatureSlots;
}

export function createProjectAnalysisSnapshot(
  identity: ProjectAnalysisIdentity = {
    projectId: null,
    projectRevision: 0,
    languageServiceGeneration: 0,
  },
  now = Date.now(),
): ProjectAnalysisSnapshot {
  const reason = identity.projectId ? undefined : "No project is active";
  return {
    identity: { ...identity },
    documents: {},
    languageService: {
      kind: null,
      readiness: "not_run",
      capabilities: null,
      failure: null,
      ...(reason ? { reason } : {}),
      restartAttempt: 0,
    },
    diagnosticsByUri: {},
    features: createFeaturePlaceholders(reason),
    projectIndex: notRunAnalysisSlot(reason),
    updatedAt: now,
  };
}

function symbolId(symbol: Sym, role: "definition" | "use"): string {
  return [
    "project-index",
    role,
    symbol.kind,
    symbol.file,
    symbol.nameFrom,
    symbol.nameTo,
    symbol.name,
  ].join(":");
}

function normalizeSymbol(
  symbol: Sym,
  role: "definition" | "use",
): NormalizedProjectSymbol {
  return {
    id: symbolId(symbol, role),
    source: "project-index",
    role,
    kind: symbol.kind,
    name: symbol.name,
    uri: symbol.file,
    line: symbol.line,
    range: { from: symbol.from, to: symbol.to },
    selectionRange: {
      from: symbol.nameFrom,
      to: symbol.nameTo,
    },
    ...(symbol.level === undefined ? {} : { level: symbol.level }),
    ...(symbol.target === undefined ? {} : { target: symbol.target }),
  };
}

/**
 * Converts the current regex index into immutable data. Consumers never need
 * its closure-based navigation methods, which keeps the future LSP index and
 * the existing ProjectIndex behind one serializable seam.
 */
export function normalizeProjectIndex(
  index: ProjectIndex,
): NormalizedProjectIndex {
  return {
    definitions: index.defs.map((symbol) =>
      normalizeSymbol(symbol, "definition"),
    ),
    uses: index.uses.map((symbol) => normalizeSymbol(symbol, "use")),
  };
}

const severityNames: Record<
  NonNullable<Diagnostic["severity"]>,
  NormalizedDiagnosticSeverity
> = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint",
};

function positionKey(position: Position): string {
  return `${position.line}:${position.character}`;
}

export function normalizeDiagnostics(
  uri: string,
  diagnostics: readonly Diagnostic[],
  identity: Pick<
    ProjectAnalysisRequestIdentity,
    "projectRevision" | "documentVersion"
  >,
): NormalizedDiagnostic[] {
  return diagnostics.map((diagnostic, index) => ({
    id: [
      uri,
      positionKey(diagnostic.range.start),
      positionKey(diagnostic.range.end),
      diagnostic.source ?? "language-service",
      String(diagnostic.code ?? ""),
      index,
    ].join(":"),
    uri,
    range: {
      start: { ...diagnostic.range.start },
      end: { ...diagnostic.range.end },
    },
    severity: diagnostic.severity
      ? severityNames[diagnostic.severity]
      : "error",
    message: diagnostic.message,
    source: diagnostic.source ?? "language-service",
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    ...(identity.documentVersion === undefined
      ? {}
      : { documentVersion: identity.documentVersion }),
    projectRevision: identity.projectRevision,
  }));
}

export function normalizeAnalysisFailure(
  error: unknown,
  retryable = true,
): AnalysisFailure {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: string | number };
    return {
      name: error.name,
      message: error.message,
      ...(withCode.code === undefined ? {} : { code: withCode.code }),
      retryable,
    };
  }
  return {
    name: "Error",
    message: String(error),
    retryable,
  };
}

export function isProjectAnalysisIdentityCurrent(
  snapshot: ProjectAnalysisSnapshot,
  request: ProjectAnalysisRequestIdentity,
): boolean {
  if (
    snapshot.identity.projectId !== request.projectId ||
    snapshot.identity.projectRevision !== request.projectRevision ||
    snapshot.identity.languageServiceGeneration !==
      request.languageServiceGeneration
  ) {
    return false;
  }
  if (request.documentUri !== undefined) {
    const document = snapshot.documents[request.documentUri];
    return (
      document !== undefined &&
      document.version === request.documentVersion
    );
  }
  return true;
}

export function sameAnalysisRequest(
  left: ProjectAnalysisRequestIdentity,
  right: ProjectAnalysisRequestIdentity,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.languageServiceGeneration ===
      right.languageServiceGeneration &&
    left.requestGeneration === right.requestGeneration &&
    left.documentUri === right.documentUri &&
    left.documentVersion === right.documentVersion
  );
}
