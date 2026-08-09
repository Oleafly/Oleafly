import { analyzeProjectFile } from "./analyze-file";
import {
  assembleProjectIntelligence,
  unreadableFileIntelligence,
} from "./assemble";
import {
  engineForPath,
  normalizeProjectPath,
  sourceHash,
} from "./source";
import {
  isProjectIntelligenceIdentity,
  isProjectIntelligenceWorkerRequest,
  PROJECT_INTELLIGENCE_LIMITS,
  type AnalyzeProjectIntelligenceRequest,
  type ProjectIntelligenceErrorResponse,
  type ProjectIntelligenceWorkerResponse,
} from "./worker-protocol";
import {
  PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
  type FileIntelligence,
  type ProjectIntelligenceSnapshot,
} from "./types";

interface CachedFile {
  readonly text: string | null;
  readonly hash: string;
  readonly characterCount: number;
  readonly sourceRevision: number;
  readonly analysis: FileIntelligence;
}

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: ProjectIntelligenceWorkerResponse): void;
  close(): void;
}

const workerScope = self as unknown as WorkerScope;
let activeProjectId: string | null = null;
let lastProjectRevision = -1;
let lastRequestGeneration = 0;
const cache = new Map<string, CachedFile>();

function errorResponse(
  request: AnalyzeProjectIntelligenceRequest,
  code: ProjectIntelligenceErrorResponse["error"]["code"],
  message: string,
  retryable: boolean,
): ProjectIntelligenceErrorResponse {
  return {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    type: "error",
    requestId: request.requestId,
    identity: request.identity,
    error: { code, message, retryable },
  };
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validatedPath(path: string): string | null {
  const normalized = normalizeProjectPath(path);
  return normalized === path ? normalized : null;
}

function validateAnalyzeRequest(
  request: AnalyzeProjectIntelligenceRequest,
): string | null {
  if (
    request.knownFiles.length >
    PROJECT_INTELLIGENCE_LIMITS.maxKnownFiles
  ) {
    return `Project has ${request.knownFiles.length} files. The safe worker limit is ${PROJECT_INTELLIGENCE_LIMITS.maxKnownFiles}.`;
  }
  if (
    request.upserts.length >
    PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles
  ) {
    return `Request has ${request.upserts.length} source files. The safe worker limit is ${PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles}.`;
  }
  const paths = [
    ...request.knownFiles,
    ...request.upserts.map((file) => file.file),
    ...request.removals,
    ...request.unreadable.map((file) => file.file),
  ];
  if (paths.some((path) => !validatedPath(path))) {
    return "Project-intelligence paths must be normalized project-relative paths.";
  }
  if (
    !unique(request.knownFiles) ||
    !unique(request.upserts.map((file) => file.file)) ||
    !unique(request.removals) ||
    !unique(request.unreadable.map((file) => file.file))
  ) {
    return "Project-intelligence file lists must not contain duplicates.";
  }
  const mutationPaths = [
    ...request.upserts.map((file) => file.file),
    ...request.removals,
    ...request.unreadable.map((file) => file.file),
  ];
  if (!unique(mutationPaths)) {
    return "A file cannot be updated, removed, and unreadable in the same request.";
  }
  for (const upsert of request.upserts) {
    if (!engineForPath(upsert.file)) {
      return `Unsupported source file in worker request: ${upsert.file}`;
    }
    if (
      upsert.text.length >
      PROJECT_INTELLIGENCE_LIMITS.maxFileCharacters
    ) {
      return `${upsert.file} has ${upsert.text.length} characters. The safe per-file worker limit is ${PROJECT_INTELLIGENCE_LIMITS.maxFileCharacters}.`;
    }
  }
  return null;
}

function resultItemCount(
  files: Readonly<Record<string, FileIntelligence>>,
): number {
  let count = 0;
  for (const file of Object.values(files)) {
    count +=
      file.outline.length +
      file.definitions.length +
      file.uses.length +
      file.edges.length +
      file.diagnostics.length +
      file.bibliographyEntries.length;
    for (const entry of file.bibliographyEntries) {
      count += entry.fields.length;
    }
  }
  return count;
}

function snapshotItemCount(
  snapshot: ProjectIntelligenceSnapshot,
): number {
  return (
    snapshot.definitions.length +
    snapshot.uses.length +
    snapshot.diagnostics.length +
    snapshot.hierarchy.nodes.length +
    snapshot.hierarchy.edges.length +
    snapshot.bibliography.entries.length +
    snapshot.bibliography.duplicates.length +
    Object.values(snapshot.outlines).reduce(
      (sum, outline) => sum + outline.length,
      0,
    ) +
    snapshot.bibliography.entries.reduce(
      (sum, entry) => sum + entry.fields.length,
      0,
    )
  );
}

function analyze(
  request: AnalyzeProjectIntelligenceRequest,
): ProjectIntelligenceWorkerResponse {
  const validationFailure = validateAnalyzeRequest(request);
  if (validationFailure) {
    return errorResponse(request, "invalid_request", validationFailure, false);
  }
  const projectChanged = activeProjectId !== request.identity.projectId;
  if (projectChanged || request.reset) {
    cache.clear();
    activeProjectId = request.identity.projectId;
    lastProjectRevision = -1;
    lastRequestGeneration = 0;
  }
  if (
    request.identity.projectRevision < lastProjectRevision ||
    request.identity.requestGeneration <= lastRequestGeneration
  ) {
    return errorResponse(
      request,
      "invalid_request",
      "Project and request revisions must advance monotonically.",
      false,
    );
  }

  const startedAt = performance.now();
  let parsedFileCount = 0;
  let reusedFileCount = 0;
  for (const file of request.removals) cache.delete(file);
  for (const unreadable of request.unreadable) {
    const analysis = unreadableFileIntelligence(
      unreadable.file,
      unreadable.sourceRevision,
      unreadable.message,
    );
    if (!analysis) continue;
    cache.set(unreadable.file, {
      text: null,
      hash: "",
      characterCount: 0,
      sourceRevision: unreadable.sourceRevision,
      analysis,
    });
  }
  for (const upsert of request.upserts) {
    const prior = cache.get(upsert.file);
    if (
      prior &&
      upsert.sourceRevision < prior.sourceRevision
    ) {
      return errorResponse(
        request,
        "invalid_request",
        `Source revision moved backwards for ${upsert.file}.`,
        false,
      );
    }
    if (
      prior &&
      upsert.sourceRevision === prior.sourceRevision &&
      prior.text !== upsert.text
    ) {
      return errorResponse(
        request,
        "invalid_request",
        `Source revision ${upsert.sourceRevision} was reused for changed content in ${upsert.file}.`,
        false,
      );
    }
    if (prior?.text === upsert.text) {
      reusedFileCount++;
      cache.set(upsert.file, {
        ...prior,
        sourceRevision: upsert.sourceRevision,
        analysis:
          prior.analysis.sourceRevision === upsert.sourceRevision
            ? prior.analysis
            : {
                ...prior.analysis,
                sourceRevision: upsert.sourceRevision,
              },
      });
      continue;
    }
    try {
      const analysis = analyzeProjectFile(
        upsert.file,
        upsert.text,
        upsert.sourceRevision,
      );
      parsedFileCount++;
      cache.set(upsert.file, {
        text: upsert.text,
        hash: sourceHash(upsert.text),
        characterCount: upsert.text.length,
        sourceRevision: upsert.sourceRevision,
        analysis,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The source parser failed.";
      const analysis = unreadableFileIntelligence(
        upsert.file,
        upsert.sourceRevision,
        `Analysis failed: ${message}`,
      );
      if (analysis) {
        cache.set(upsert.file, {
          text: upsert.text,
          hash: sourceHash(upsert.text),
          characterCount: upsert.text.length,
          sourceRevision: upsert.sourceRevision,
          analysis,
        });
      }
    }
  }

  const known = new Set(request.knownFiles);
  for (const file of [...cache.keys()]) {
    if (!known.has(file)) cache.delete(file);
  }
  for (const file of known) {
    if (!engineForPath(file) || cache.has(file)) continue;
    const analysis = unreadableFileIntelligence(
      file,
      0,
      "The source file has not been loaded for current project analysis.",
    );
    if (!analysis) continue;
    cache.set(file, {
      text: null,
      hash: "",
      characterCount: 0,
      sourceRevision: 0,
      analysis,
    });
  }
  const sourceFiles = [...cache.values()];
  const characterCount = sourceFiles.reduce(
    (sum, file) => sum + file.characterCount,
    0,
  );
  if (
    sourceFiles.length > PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles ||
    characterCount >
      PROJECT_INTELLIGENCE_LIMITS.maxProjectCharacters
  ) {
    return errorResponse(
      request,
      "input_limit",
      `Project analysis requires ${sourceFiles.length} source files and ${characterCount} characters. Safe limits are ${PROJECT_INTELLIGENCE_LIMITS.maxSourceFiles} files and ${PROJECT_INTELLIGENCE_LIMITS.maxProjectCharacters} characters.`,
      false,
    );
  }
  const files = Object.fromEntries(
    [...cache]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, value]) => [file, value.analysis]),
  );
  const itemCount = resultItemCount(files);
  if (itemCount > PROJECT_INTELLIGENCE_LIMITS.maxResultItems) {
    return errorResponse(
      request,
      "result_limit",
      `Project analysis produced ${itemCount} records. The safe result limit is ${PROJECT_INTELLIGENCE_LIMITS.maxResultItems}.`,
      false,
    );
  }
  const snapshot = assembleProjectIntelligence({
    identity: request.identity,
    files,
    knownFiles: request.knownFiles,
    ...(request.mainDocument
      ? { mainDocument: request.mainDocument }
      : {}),
    stats: {
      fileCount: sourceFiles.length,
      characterCount,
      parsedFileCount,
      reusedFileCount:
        reusedFileCount +
        Math.max(
          0,
          sourceFiles.length -
            parsedFileCount -
            reusedFileCount -
            request.unreadable.length,
        ),
      durationMs: performance.now() - startedAt,
    },
  });
  const outputItemCount = snapshotItemCount(snapshot);
  if (
    outputItemCount >
    PROJECT_INTELLIGENCE_LIMITS.maxResultItems
  ) {
    return errorResponse(
      request,
      "result_limit",
      `Project analysis produced ${outputItemCount} output records. The safe result limit is ${PROJECT_INTELLIGENCE_LIMITS.maxResultItems}.`,
      false,
    );
  }
  lastProjectRevision = request.identity.projectRevision;
  lastRequestGeneration = request.identity.requestGeneration;
  return {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    type: "result",
    requestId: request.requestId,
    identity: request.identity,
    snapshot,
  };
}

workerScope.addEventListener("message", (event) => {
  if (!isProjectIntelligenceWorkerRequest(event.data)) {
    const shell = event.data;
    if (
      typeof shell === "object" &&
      shell !== null &&
      "requestId" in shell &&
      Number.isSafeInteger(shell.requestId) &&
      (shell.requestId as number) > 0 &&
      "identity" in shell &&
      isProjectIntelligenceIdentity(shell.identity)
    ) {
      workerScope.postMessage({
        protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
        type: "error",
        requestId: shell.requestId as number,
        identity: shell.identity,
        error: {
          code: "invalid_request",
          message: "Malformed project-intelligence worker request.",
          retryable: false,
        },
      });
    }
    return;
  }
  if (event.data.type === "dispose") {
    cache.clear();
    workerScope.close();
    return;
  }
  try {
    workerScope.postMessage(analyze(event.data));
  } catch {
    workerScope.postMessage(
      errorResponse(
        event.data,
        "analysis_failed",
        "Project intelligence failed inside the worker.",
        true,
      ),
    );
  }
});
