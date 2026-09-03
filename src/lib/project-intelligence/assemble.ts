import { summarizeBibliographyEntry } from "./bibliography-summary";
import {
  engineForPath,
  normalizeProjectPath,
  stableId,
} from "./source";
import {
  PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
  type BibliographyCatalog,
  type BibliographyDuplicate,
  type BibliographyEntryDetail,
  type FileAnalysis,
  type OutlineNode,
  type ProjectDefinition,
  type ProjectDiagnostic,
  type ProjectEdge,
  type ProjectFileState,
  type ProjectHierarchy,
  type ProjectHierarchyNode,
  type ProjectIntelligenceIdentity,
  type ProjectIntelligenceSnapshot,
  type ProjectIntelligenceStats,
  type ProjectRelatedLocation,
  type ProjectUse,
  type ResolutionStatus,
} from "./types";

export interface AssembleProjectIntelligenceInput {
  readonly identity: ProjectIntelligenceIdentity;
  readonly files: Readonly<Record<string, FileAnalysis>>;
  readonly knownFiles: readonly string[];
  readonly mainDocument?: string;
  readonly stats: ProjectIntelligenceStats;
}

export interface AssembledProjectIntelligence {
  readonly snapshot: ProjectIntelligenceSnapshot;
  readonly bibliographyDetails: readonly BibliographyEntryDetail[];
}

const TARGET_DEFINITION_KINDS: ReadonlySet<string> = new Set([
  "glossary",
  "label",
  "anchor",
  "bibentry",
  "macro",
  "environment",
]);

function definitionKey(
  definition: ProjectDefinition,
): string | null {
  if (definition.kind === "label" || definition.kind === "anchor") {
    if (
      definition.engine === "markdown" &&
      definition.kind === "anchor"
    ) {
      return `reference:${definition.location.file}:${definition.name}`;
    }
    return `reference:${definition.name}`;
  }
  if (definition.kind === "bibentry") {
    return `citation:${definition.name}`;
  }
  if (definition.kind === "macro") return `macro:${definition.name}`;
  if (definition.kind === "environment") {
    return `environment:${definition.name}`;
  }
  if (definition.kind === "glossary") {
    return `glossary:${definition.name}`;
  }
  return null;
}

function relatedDefinitions(
  definitions: readonly ProjectDefinition[],
  currentId?: string,
): ProjectRelatedLocation[] {
  return definitions
    .filter((definition) => definition.id !== currentId)
    .map((definition) => ({
      message: `${definition.kind} "${definition.name}" is defined here.`,
      location: definition.location,
    }));
}

function diagnosticForDefinitionDuplicate(
  definition: ProjectDefinition,
  candidates: readonly ProjectDefinition[],
): ProjectDiagnostic {
  const citation = definition.kind === "bibentry";
  return {
    id: stableId(
      "diag",
      definition.location.file,
      definition.location.range.from,
      citation ? "duplicate-citation-key" : "duplicate-definition",
      definition.name,
    ),
    source: "project-intelligence",
    severity: "error",
    code: citation
      ? "duplicate-citation-key"
      : "duplicate-definition",
    message: citation
      ? `Citation key "${definition.name}" is defined ${candidates.length} times.`
      : `${definition.kind} target "${definition.name}" is defined ${candidates.length} times.`,
    location: definition.location,
    related: relatedDefinitions(candidates, definition.id),
  };
}

function diagnosticForUse(
  use: ProjectUse,
  definitions: readonly ProjectDefinition[],
): ProjectDiagnostic {
  const duplicate = definitions.length > 1;
  const citation = use.kind === "citation";
  return {
    id: stableId(
      "diag",
      use.location.file,
      use.location.range.from,
      duplicate ? "duplicate-use-target" : "unresolved-use",
      use.kind,
      use.name,
    ),
    source: "project-intelligence",
    severity: "error",
    code: duplicate
      ? citation
        ? "duplicate-citation-key"
        : "duplicate-definition"
      : citation
        ? "unresolved-citation"
        : "unresolved-reference",
    message: duplicate
      ? `${citation ? "Citation" : "Reference"} "${use.name}" has ${definitions.length} possible definitions.`
      : `${citation ? "Citation" : "Reference"} "${use.name}" could not be resolved.`,
    location: use.location,
    related: relatedDefinitions(definitions),
  };
}

function diagnosticForEdge(edge: ProjectEdge): ProjectDiagnostic {
  const duplicate = edge.resolution === "duplicate";
  return {
    id: stableId(
      "diag",
      edge.fromFile,
      edge.location.range.from,
      "unresolved-target",
      edge.rawTarget,
    ),
    source: "project-intelligence",
    severity: "error",
    code: "unresolved-target",
    message: duplicate
      ? `${edge.kind} target "${edge.rawTarget}" matches ${edge.candidateFiles.length} project files.`
      : `${edge.kind} target "${edge.rawTarget}" could not be resolved.`,
    location: edge.location,
    related: duplicate
      ? edge.candidateFiles.map((file) => ({
          message: `Possible target: ${file}`,
          location: {
            file,
            range: {
              from: 0,
              to: 0,
              startLine: 1,
              startColumn: 0,
              endLine: 1,
              endColumn: 0,
            },
          },
        }))
      : [],
  };
}

function candidateTargetFiles(
  edge: ProjectEdge,
  known: ReadonlySet<string>,
  knownByLower: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  if (!edge.targetFile) return [];
  const candidates = new Set<string>();
  const normalized = normalizeProjectPath(edge.targetFile);
  if (!normalized) return [];
  if (known.has(normalized)) candidates.add(normalized);
  for (const candidate of knownByLower.get(normalized.toLowerCase()) ?? []) {
    candidates.add(candidate);
  }

  const hasExtension = /\.[a-z0-9]+$/i.test(normalized);
  if (!hasExtension) {
    const extensions =
      edge.kind === "bibliography"
        ? [".bib"]
        : edge.kind === "include" || edge.kind === "import"
          ? [".tex", ".ltx", ".latex", ".typ", ".md", ".markdown"]
          : [
              ".png",
              ".jpg",
              ".jpeg",
              ".svg",
              ".pdf",
              ".webp",
              ".eps",
            ];
    for (const extension of extensions) {
      const withExtension = `${normalized}${extension}`;
      if (known.has(withExtension)) candidates.add(withExtension);
      for (
        const candidate of
        knownByLower.get(withExtension.toLowerCase()) ?? []
      ) {
        candidates.add(candidate);
      }
    }
  }
  return [...candidates].sort((a, b) => Number(a > b) - Number(a < b));
}

function resolveEdge(
  edge: ProjectEdge,
  known: ReadonlySet<string>,
  knownByLower: ReadonlyMap<string, readonly string[]>,
): ProjectEdge {
  if (edge.resolution === "external" || !edge.targetFile) return edge;
  const candidates = candidateTargetFiles(edge, known, knownByLower);
  const resolution: ResolutionStatus =
    candidates.length === 0
      ? "unresolved"
      : candidates.length === 1
        ? "resolved"
        : "duplicate";
  return {
    ...edge,
    targetFile: candidates.length === 1 ? candidates[0] : edge.targetFile,
    resolution,
    candidateFiles: candidates,
  };
}

function definitionCandidatesForUse(
  use: ProjectUse,
  byKey: ReadonlyMap<string, readonly ProjectDefinition[]>,
): readonly ProjectDefinition[] {
  if (use.kind === "reference") {
    let candidates =
      use.engine === "markdown"
        ? byKey.get(
            `reference:${use.location.file}:${use.name}`,
          ) ?? []
        : byKey.get(`reference:${use.name}`) ?? [];
    if (use.target?.includes("#")) {
      const [file, anchor] = use.target.split("#", 2);
      candidates =
        byKey.get(
          `reference:${file}:${anchor || use.name}`,
        ) ??
        (byKey.get(`reference:${anchor || use.name}`) ?? []).filter(
          (definition) => definition.location.file === file,
        );
    }
    if (use.syntax === "typst-at") {
      const citations = byKey.get(`citation:${use.name}`) ?? [];
      if (candidates.length === 0) return citations;
      if (citations.length > 0) return [...candidates, ...citations];
    }
    return candidates;
  }
  if (use.kind === "citation") {
    return byKey.get(`citation:${use.name}`) ?? [];
  }
  if (use.kind === "macro") {
    const candidates = byKey.get(`macro:${use.name}`) ?? [];
    return use.syntax === "candidate"
      ? candidates.filter(
          (definition) =>
            definition.location.file !== use.location.file ||
            definition.location.range.from !==
              use.location.range.from ||
            definition.location.range.to !== use.location.range.to,
        )
      : candidates;
  }
  if (use.kind === "environment") {
    return byKey.get(`environment:${use.name}`) ?? [];
  }
  if (use.kind === "glossary") {
    return byKey.get(`glossary:${use.name}`) ?? [];
  }
  return [];
}

function resolvedUse(
  original: ProjectUse,
  byKey: ReadonlyMap<string, readonly ProjectDefinition[]>,
  edge?: ProjectEdge,
): ProjectUse | null {
  if (
    original.kind === "include" ||
    original.kind === "import" ||
    original.kind === "link" ||
    original.kind === "asset" ||
    original.kind === "bibliography"
  ) {
    return {
      ...original,
      target: edge?.targetFile ?? original.target,
      resolution: edge?.resolution ?? "unresolved",
      definitionIds: [],
    };
  }
  const candidates = definitionCandidatesForUse(original, byKey);
  if (
    (original.kind === "macro" ||
      original.kind === "environment" ||
      original.kind === "glossary") &&
    candidates.length === 0
  ) {
    // The local index intentionally knows only project definitions. Package,
    // class, and language built-ins remain the language server's domain.
    // Glossary keys may also live in external resources the index never sees.
    return null;
  }
  let kind = original.kind;
  if (
    original.syntax === "typst-at" &&
    candidates.length > 0 &&
    candidates.every(
      (definition) => definition.kind === "bibentry",
    )
  ) {
    kind = "citation";
  }
  return {
    ...original,
    kind,
    resolution:
      candidates.length === 0
        ? "unresolved"
        : candidates.length === 1
          ? "resolved"
          : "duplicate",
    definitionIds: candidates.map((definition) => definition.id),
  };
}

function withBibliographyDuplicateMetadata(
  entries: readonly BibliographyEntryDetail[],
): {
  entries: BibliographyEntryDetail[];
  duplicates: BibliographyDuplicate[];
} {
  const byKey = new Map<string, BibliographyEntryDetail[]>();
  for (const entry of entries) {
    const values = byKey.get(entry.key) ?? [];
    values.push(entry);
    byKey.set(entry.key, values);
  }
  const normalized: BibliographyEntryDetail[] = [];
  const duplicates: BibliographyDuplicate[] = [];
  for (const [key, values] of [...byKey].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const ordered = [...values].sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.keyRange.from - right.keyRange.from,
    );
    if (ordered.length > 1) {
      duplicates.push({
        key,
        entryIds: ordered.map((entry) => entry.id),
        locations: ordered.map((entry) => ({
          file: entry.file,
          range: entry.keyRange,
        })),
      });
    }
    normalized.push(
      ...ordered.map((entry, index) => ({
        ...entry,
        duplicate: ordered.length > 1,
        duplicateIndex: index,
        duplicateCount: ordered.length,
      })),
    );
  }
  return { entries: normalized, duplicates };
}

function fileStateOf(file: FileAnalysis): ProjectFileState {
  return {
    file: file.file,
    engine: file.engine,
    sourceRevision: file.sourceRevision,
    contentHash: file.contentHash,
    status: file.status,
    ...(file.statusReason === undefined
      ? {}
      : { statusReason: file.statusReason }),
    ...(file.packageRefs ? { packageRefs: file.packageRefs } : {}),
  };
}

function hierarchyFor(
  files: Readonly<Record<string, FileAnalysis>>,
  edges: readonly ProjectEdge[],
  mainDocument?: string,
): ProjectHierarchy {
  const nodes: ProjectHierarchyNode[] = Object.values(files)
    .map((file) => {
      const firstRange =
        file.outline[0]?.range ??
        file.definitions[0]?.location.range ?? {
          from: 0,
          to: 0,
          startLine: 1,
          startColumn: 0,
          endLine: 1,
          endColumn: 0,
        };
      return {
        id: stableId("file", file.file),
        file: file.file,
        title: file.file.split("/").at(-1) ?? file.file,
        engine: file.engine,
        range: firstRange,
        status:
          file.status === "success"
            ? "available"
            : file.status === "partial"
              ? "partial"
              : "unreadable",
      } satisfies ProjectHierarchyNode;
    })
    .sort((left, right) => left.file.localeCompare(right.file));
  const nodeFiles = new Set(nodes.map((node) => node.file));
  // Any resolved edge, not just include/import: the structure view renders
  // every edge's target inline, so a bibliography or asset target is already
  // on screen and must not also be a root.
  const incoming = new Set(
    edges
      .filter(
        (edge) =>
          edge.resolution === "resolved" &&
          edge.targetFile &&
          nodeFiles.has(edge.targetFile),
      )
      .map((edge) => edge.targetFile as string),
  );
  const roots = nodes
    .filter(
      (node) =>
        node.file === mainDocument || !incoming.has(node.file),
    )
    .sort((left, right) => {
      if (left.file === mainDocument) return -1;
      if (right.file === mainDocument) return 1;
      return left.file.localeCompare(right.file);
    })
    .map((node) => node.file);
  return { roots, nodes, edges };
}

export function assembleProjectIntelligenceResult(
  input: AssembleProjectIntelligenceInput,
): AssembledProjectIntelligence {
  const orderedFiles = Object.fromEntries(
    Object.entries(input.files).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  const definitions: ProjectDefinition[] = Object.values(orderedFiles)
    .flatMap((file) => file.definitions)
    .sort(
      (left, right) =>
        left.location.file.localeCompare(right.location.file) ||
        left.location.range.from - right.location.range.from ||
        left.id.localeCompare(right.id),
    );
  const byKey = new Map<string, ProjectDefinition[]>();
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  for (const definition of definitions) {
    const key = definitionKey(definition);
    if (!key) continue;
    const values = byKey.get(key) ?? [];
    values.push(definition);
    byKey.set(key, values);
  }

  const known = new Set(
    input.knownFiles
      .map((file) => normalizeProjectPath(file))
      .filter((file): file is string => file !== null),
  );
  const knownByLower = new Map<string, string[]>();
  for (const file of [...known].sort((a, b) => Number(a > b) - Number(a < b))) {
    const lower = file.toLowerCase();
    knownByLower.set(lower, [...(knownByLower.get(lower) ?? []), file]);
  }
  const edges = Object.values(orderedFiles)
    .flatMap((file) => file.edges)
    .map((edge) => resolveEdge(edge, known, knownByLower))
    .sort(
      (left, right) =>
        left.fromFile.localeCompare(right.fromFile) ||
        left.location.range.from - right.location.range.from ||
        left.id.localeCompare(right.id),
    );
  const edgeByLocation = new Map(
    edges.map((edge) => [
      `${edge.fromFile}:${edge.location.range.from}:${edge.kind}`,
      edge,
    ]),
  );

  const uses: ProjectUse[] = [];
  for (const original of Object.values(orderedFiles).flatMap(
    (file) => file.uses,
  )) {
    const edge = edgeByLocation.get(
      `${original.location.file}:${original.location.range.from}:${original.kind}`,
    );
    const resolved = resolvedUse(original, byKey, edge);
    if (resolved) uses.push(resolved);
  }
  uses.sort(
    (left, right) =>
      left.location.file.localeCompare(right.location.file) ||
      left.location.range.from - right.location.range.from ||
      left.id.localeCompare(right.id),
  );

  const diagnostics: ProjectDiagnostic[] = Object.values(orderedFiles)
    .flatMap((file) => file.diagnostics);
  for (const candidates of byKey.values()) {
    if (
      candidates.length < 2 ||
      !candidates.every((definition) =>
        TARGET_DEFINITION_KINDS.has(definition.kind),
      )
    ) {
      continue;
    }
    // Multiple macro definitions commonly represent an intentional
    // new/renew chain. TexLab owns semantic validity for those commands.
    if (candidates.every((definition) => definition.kind === "macro")) {
      continue;
    }
    diagnostics.push(
      ...candidates.map((definition) =>
        diagnosticForDefinitionDuplicate(definition, candidates),
      ),
    );
  }
  for (const use of uses) {
    if (
      use.kind !== "reference" &&
      use.kind !== "citation"
    ) {
      continue;
    }
    if (use.resolution === "resolved") continue;
    diagnostics.push(
      diagnosticForUse(
        use,
        use.definitionIds
          .map((id) => definitionsById.get(id))
          .filter(
            (definition): definition is ProjectDefinition =>
              definition !== undefined,
          ),
      ),
    );
  }
  for (const edge of edges) {
    if (
      edge.resolution === "unresolved" ||
      edge.resolution === "duplicate"
    ) {
      diagnostics.push(diagnosticForEdge(edge));
    }
  }
  diagnostics.sort(
    (left, right) =>
      left.location.file.localeCompare(right.location.file) ||
      left.location.range.from - right.location.range.from ||
      left.code.localeCompare(right.code) ||
      left.id.localeCompare(right.id),
  );

  const rawEntries = Object.values(orderedFiles).flatMap(
    (file) => file.bibliographyEntries,
  );
  const bibliographyMetadata =
    withBibliographyDuplicateMetadata(rawEntries);
  const bibliography: BibliographyCatalog = {
    entries: bibliographyMetadata.entries.map(summarizeBibliographyEntry),
    duplicates: bibliographyMetadata.duplicates,
    declarationUseIds: uses
      .filter((use) => use.kind === "bibliography")
      .map((use) => use.id),
  };
  const fileStates: Record<string, ProjectFileState> = {};
  const outlines: Record<string, readonly OutlineNode[]> = {};
  for (const file of Object.values(orderedFiles)) {
    fileStates[file.file] = fileStateOf(file);
    outlines[file.file] = [...file.outline].sort(
      (left, right) =>
        left.range.from - right.range.from ||
        left.id.localeCompare(right.id),
    );
  }
  const partialFiles = Object.values(orderedFiles).filter(
    (file) => file.status !== "success",
  );
  const status = partialFiles.length > 0 ? "partial" : "success";
  const hierarchy = hierarchyFor(
    orderedFiles,
    edges,
    input.mainDocument,
  );
  const detectedPackages = [
    ...new Set(
      Object.values(orderedFiles).flatMap((file) =>
        (file.packageRefs ?? [])
          .filter((ref) => ref.kind === "package")
          .map((ref) => ref.name),
      ),
    ),
  ].sort((a, b) => Number(a > b) - Number(a < b));
  const documentClasses = [
    ...new Set(
      Object.values(orderedFiles).flatMap((file) =>
        (file.packageRefs ?? [])
          .filter((ref) => ref.kind === "class")
          .map((ref) => ref.name),
      ),
    ),
  ].sort((a, b) => Number(a > b) - Number(a < b));

  const snapshot: ProjectIntelligenceSnapshot = {
    protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
    identity: { ...input.identity },
    status,
    ...(status === "partial"
      ? {
          reason: `${partialFiles.length} file${partialFiles.length === 1 ? "" : "s"} produced recoverable partial analysis.`,
        }
      : {}),
    fileStates,
    definitions,
    uses,
    diagnostics,
    outlines,
    hierarchy,
    bibliography,
    stats: { ...input.stats },
    detectedPackages,
    documentClasses,
  };
  return {
    snapshot,
    bibliographyDetails: bibliographyMetadata.entries,
  };
}

export function assembleProjectIntelligence(
  input: AssembleProjectIntelligenceInput,
): ProjectIntelligenceSnapshot {
  return assembleProjectIntelligenceResult(input).snapshot;
}

export function unreadableFileIntelligence(
  file: string,
  sourceRevision: number,
  message = "The file could not be read.",
): FileAnalysis | null {
  const engine = engineForPath(file);
  if (!engine) return null;
  const range = {
    from: 0,
    to: 0,
    startLine: 1,
    startColumn: 0,
    endLine: 1,
    endColumn: 0,
  };
  return {
    file,
    engine,
    sourceRevision,
    contentHash: "",
    status: "error",
    statusReason: message,
    outline: [],
    definitions: [],
    uses: [],
    edges: [],
    diagnostics: [
      {
        id: stableId("diag", file, 0, "unreadable-file"),
        source: "project-intelligence",
        severity: "error",
        code: "unreadable-file",
        message,
        location: { file, range },
        related: [],
      },
    ],
    bibliographyEntries: [],
  };
}
