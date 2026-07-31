export const PROJECT_INTELLIGENCE_PROTOCOL_VERSION = 1 as const;

export type ProjectIntelligenceEngine =
  | "latex"
  | "markdown"
  | "typst"
  | "bibtex";

export type ProjectIntelligenceStatus =
  | "unsupported"
  | "unavailable"
  | "not_run"
  | "running"
  | "error"
  | "partial"
  | "success";

export interface ProjectIntelligenceIdentity {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly requestGeneration: number;
}

/**
 * Offsets are UTF-16 offsets, matching CodeMirror and JavaScript strings.
 * Lines are one-based for display/navigation; columns are zero-based.
 */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface SourceLocation {
  readonly file: string;
  readonly range: SourceRange;
}

export type ProjectDefinitionKind =
  | "file"
  | "section"
  | "label"
  | "anchor"
  | "macro"
  | "environment"
  | "glossary"
  | "bibentry";

export type ProjectUseKind =
  | "reference"
  | "citation"
  | "include"
  | "import"
  | "link"
  | "asset"
  | "bibliography"
  | "macro"
  | "environment"
  | "glossary";

export type ResolutionStatus =
  | "resolved"
  | "unresolved"
  | "duplicate"
  | "external";

export interface LatexDefinitionArguments {
  readonly syntax: "classic" | "xparse" | "tex-def";
  readonly requiredCount: number;
  readonly optionalCount: number;
  readonly optionalDefault?: string;
  readonly xparseSpecification?: string;
  /** CodeMirror snippet appended after the command/environment name. */
  readonly completionSnippet: string;
}

export interface ProjectDefinition {
  readonly id: string;
  readonly source: "local" | "texlab" | "tinymist";
  readonly engine: ProjectIntelligenceEngine;
  readonly kind: ProjectDefinitionKind;
  readonly name: string;
  readonly location: SourceLocation;
  readonly detail?: string;
  readonly level?: number;
  readonly latexArguments?: LatexDefinitionArguments;
}

export interface ProjectUse {
  readonly id: string;
  readonly source: "local" | "texlab" | "tinymist";
  readonly engine: ProjectIntelligenceEngine;
  readonly kind: ProjectUseKind;
  readonly name: string;
  readonly location: SourceLocation;
  readonly target?: string;
  readonly syntax?: "typst-at" | "explicit" | "candidate";
  readonly resolution: ResolutionStatus;
  readonly definitionIds: readonly string[];
}

export interface OutlineNode {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly kind:
    | "file"
    | "section"
    | "label"
    | "anchor"
    | "macro"
    | "environment"
    | "glossary"
    | "bibentry";
  readonly level: number;
  readonly parentId: string | null;
  readonly range: SourceRange;
  readonly definitionId?: string;
}

export interface ProjectHierarchyNode {
  readonly id: string;
  readonly file: string;
  readonly title: string;
  readonly engine: ProjectIntelligenceEngine;
  readonly range: SourceRange;
  readonly status: "available" | "partial" | "unreadable";
}

export interface ProjectEdge {
  readonly id: string;
  readonly kind: "include" | "import" | "link" | "asset" | "bibliography";
  readonly fromFile: string;
  readonly location: SourceLocation;
  readonly rawTarget: string;
  readonly targetFile: string | null;
  readonly resolution: ResolutionStatus;
  readonly candidateFiles: readonly string[];
}

export interface ProjectHierarchy {
  /** Project-relative file paths, ordered with the configured main file first. */
  readonly roots: readonly string[];
  readonly nodes: readonly ProjectHierarchyNode[];
  readonly edges: readonly ProjectEdge[];
}

export interface ProjectRelatedLocation {
  readonly message: string;
  readonly location: SourceLocation;
}

export interface ProjectDiagnostic {
  readonly id: string;
  readonly source: "project-intelligence";
  readonly severity: "error" | "warning" | "information";
  readonly code:
    | "duplicate-definition"
    | "duplicate-citation-key"
    | "unresolved-reference"
    | "unresolved-citation"
    | "unresolved-target"
    | "malformed-source"
    | "malformed-bibtex"
    | "bibtex-validation"
    | "unreadable-file"
    | "analysis-limit";
  readonly message: string;
  readonly location: SourceLocation;
  readonly related: readonly ProjectRelatedLocation[];
}

export interface BibliographyField {
  readonly name: string;
  readonly value: string;
  readonly range: SourceRange;
  readonly valueRange: SourceRange;
  readonly valueStyle: "braced" | "quoted" | "bare";
  readonly complete: boolean;
}

export interface BibliographyEntry {
  readonly id: string;
  readonly key: string;
  readonly type: string;
  readonly file: string;
  readonly range: SourceRange;
  readonly keyRange: SourceRange;
  readonly typeRange: SourceRange;
  readonly fields: readonly BibliographyField[];
  readonly complete: boolean;
  readonly duplicate: boolean;
  readonly duplicateIndex: number;
  readonly duplicateCount: number;
}

export interface BibliographyDuplicate {
  readonly key: string;
  readonly entryIds: readonly string[];
  readonly locations: readonly SourceLocation[];
}

export interface BibliographyCatalog {
  readonly entries: readonly BibliographyEntry[];
  readonly duplicates: readonly BibliographyDuplicate[];
  readonly declarationUseIds: readonly string[];
}

export interface PackageReference {
  readonly name: string;
  readonly kind: "package" | "class";
  readonly location: SourceLocation;
}

export interface FileIntelligence {
  readonly file: string;
  readonly engine: ProjectIntelligenceEngine;
  readonly sourceRevision: number;
  readonly contentHash: string;
  readonly status: "success" | "partial" | "error";
  readonly statusReason?: string;
  readonly outline: readonly OutlineNode[];
  readonly definitions: readonly ProjectDefinition[];
  readonly uses: readonly ProjectUse[];
  readonly edges: readonly ProjectEdge[];
  readonly diagnostics: readonly ProjectDiagnostic[];
  readonly bibliographyEntries: readonly BibliographyEntry[];
  readonly packageRefs?: readonly PackageReference[];
}

export interface ProjectIntelligenceStats {
  readonly fileCount: number;
  readonly characterCount: number;
  readonly parsedFileCount: number;
  readonly reusedFileCount: number;
  readonly durationMs: number;
}

export interface ProjectIntelligenceSnapshot {
  readonly protocolVersion: typeof PROJECT_INTELLIGENCE_PROTOCOL_VERSION;
  readonly identity: ProjectIntelligenceIdentity;
  readonly status: "partial" | "success";
  readonly reason?: string;
  readonly files: Readonly<Record<string, FileIntelligence>>;
  readonly definitions: readonly ProjectDefinition[];
  readonly uses: readonly ProjectUse[];
  readonly diagnostics: readonly ProjectDiagnostic[];
  readonly outlines: Readonly<Record<string, readonly OutlineNode[]>>;
  readonly hierarchy: ProjectHierarchy;
  readonly bibliography: BibliographyCatalog;
  readonly stats: ProjectIntelligenceStats;
  readonly detectedPackages: readonly string[];
  readonly documentClasses: readonly string[];
}

export interface ProjectIntelligenceFailure {
  readonly name: string;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * A running state may retain the last accepted snapshot for continuity. When
 * it does, `stale` is true and the retained snapshot must not be presented as
 * current-revision analysis.
 */
export interface ProjectIntelligenceState {
  readonly status: ProjectIntelligenceStatus;
  readonly identity: ProjectIntelligenceIdentity | null;
  readonly data: ProjectIntelligenceSnapshot | null;
  readonly stale: boolean;
  /**
   * True only while an active-file text edit is awaiting its authoritative
   * worker result. Filesystem/main-document invalidations keep this false so
   * editor fallbacks cannot resolve against an obsolete project graph.
   */
  readonly currentFileFallbackAllowed?: boolean;
  readonly reason?: string;
  readonly failure?: ProjectIntelligenceFailure;
}

export interface CitationCompletion {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly type: string;
  readonly author?: string;
  readonly title?: string;
  readonly year?: string;
  readonly location: SourceLocation;
  readonly duplicate: boolean;
  readonly duplicateIndex: number;
  readonly duplicateCount: number;
}

export interface ExternalProjectIntelligence {
  readonly identity: ProjectIntelligenceIdentity;
  readonly definitions: readonly ProjectDefinition[];
  readonly uses: readonly ProjectUse[];
}
