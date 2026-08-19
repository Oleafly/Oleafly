// The transport contract between any Oleafly frontend shell and its backend.
// Pure types: no Tauri, no HTTP, no runtime code. The desktop shell implements
// it over Tauri IPC — src/lib/backend-port-conformance.ts proves that at
// compile time, so drift between this contract and src/lib/tauri.ts fails
// `tsc` and `pnpm build`. A web shell implements the same surface over
// HTTP/WS. Grow the contract here first; the conformance check then demands
// the desktop implementation.

export interface CompileError {
    line: number | null;
    file: string | null;
    message: string;
    kind: string;
    explanation: string | null;
}
export interface CompileResult {
    ok: boolean;
    has_pdf: boolean;
    output_id: string | null;
    output_revision: number | null;
    log: string;
    errors: CompileError[];
    synctex_path: string | null;
    out_dir: string | null;
    compile_time_ms: number;
    stopped?: boolean;
}
export interface EngineCapabilities {
    produces_pdf: boolean;
    supports_synctex: boolean;
    supports_offline: boolean;
    supports_isolated_compile: boolean;
    formatting_profile: "latex" | "typst" | "markdown" | "none";
    source_preflight_profile: "latex" | "none";
    features: EngineFeature[];
    conversion_exports: Array<"docx" | "html" | "md" | "txt" | "pptx" | "epub">;
    template_kinds: Array<"document" | "image">;
    compiler_prerequisite: "pandoc" | "system_tex" | null;
}
export type EngineFeature = "citations" | "document_index";
export interface DocumentEngineDescriptor {
    id: DocumentEngineId;
    label: string;
    source_format: "latex" | "typst" | "markdown" | "unknown";
    main_document: string;
    source_extensions: string[];
    capabilities: EngineCapabilities;
    /** Pinned latexmk compiler; absent means auto-detect from the source. */
    tex_flavor?: TexFlavor;
    allow_shell_escape: boolean;
}
export type TexFlavor = "pdflatex" | "xelatex" | "lualatex";
export type DocumentEngineId = "latex" | "latexmk" | "typst" | "markdown" | "unknown";
export interface ValidatedCompileFingerprint {
    main_document: string;
    engine_id: string;
    output_id: string;
    output_revision: number;
    compiled_at_ms: number;
    /** Log of the fingerprinted compile; restores the logs pane on reopen. */
    log: string;
}
/** Null means the persisted record is missing or stale: compile normally. */
export interface FileEntry {
    path: string;
    is_dir: boolean;
}
export interface ProjectMeta {
    name: string;
    main_doc: string;
    engine: string;
    color?: string;
    kind?: string;
    tex?: TexSpec | null;
    allow_shell_escape: boolean;
}
export interface ProjectStateChanged {
    projectId: string;
    revision: number;
    reason: string;
    filesChanged: boolean;
    mutationGeneration: number | null;
    project: ProjectMeta;
    engine: DocumentEngineDescriptor;
}
export interface TexSpec {
    distribution: string;
    distribution_label: string;
    packages: Record<string, string>;
    recorded_at: number;
}
export interface TexStatus {
    pinned_label: string;
    local_label: string | null;
    distribution_differs: boolean;
    missing_packages: string[];
    can_install_missing: boolean;
}
export interface ProjectInfo {
    id: string;
    name: string;
    main_doc: string;
    engine?: string;
    kind: string;
    created_at: number;
    updated_at: number;
    color?: string;
    has_preview: boolean;
    exports: {
        date: number;
        filename: string;
        path: string;
        format: string;
    }[];
    forked_from: string | null;
}
export interface FileMutationResult {
    generation: number;
}
export type CreateFileResult = {
    status: "created";
    path: string;
    generation: number;
} | {
    status: "conflict";
    destination: string;
    suggested_destination: string;
    generation: number;
};
export type FileConflictStrategy = "error" | "keep_both" | "replace";
export type RenameFileResult = {
    status: "renamed";
    path: string;
    generation: number;
} | {
    status: "conflict";
    destination: string;
    suggested_destination: string;
    generation: number;
};
export interface CopyFileResult {
    path: string;
    generation: number;
}
export interface ImportPathsResult {
    paths: string[];
    generation: number;
}
export interface FigureCacheResult {
    hash: string;
    alreadyCached: boolean;
}
export interface TemplateLicense {
    spdx: string;
    author: string;
    url: string;
}
export interface TemplateRequires {
    packages: string[];
    fonts: string[];
    engine: string;
}
export type AtsProfile = "friendly" | "design-forward" | null;
export interface TemplateInfo {
    id: string;
    name: string;
    description: string;
    category: string;
    engine: string;
    document_engine: DocumentEngineId;
    ats_profile: AtsProfile;
    layout: string | null;
    pages: string | null;
    default_color: string | null;
    license: TemplateLicense | null;
    requires: TemplateRequires;
    has_preview: boolean;
    assets_ready: boolean;
    order: number;
    source: string;
}
export interface ComponentInfo {
    id: string;
    label: string;
    description: string;
    approx_bytes: number;
    license: TemplateLicense | null;
    installed: boolean;
    kind: string;
}
export interface Prerequisite {
    id: string;
    label: string;
    approx_bytes: number;
    installed: boolean;
}
export interface AssetProgress {
    component: string;
    label: string;
    file: string;
    index: number;
    total: number;
    received: number;
    file_total: number | null;
}
export interface PackInfo {
    id: string;
    label: string;
    description: string;
    category: string;
    approx_bytes: number;
    count: number;
    license_summary: string;
    installed: boolean;
}
export interface GitCommit {
    oid: string;
    short: string;
    time: number;
    message: string;
}
export interface EngineInfo {
    kind: "system" | "tinytex" | "none";
    lualatex: string | null;
    tlmgr: string | null;
    version: string | null;
    latexmk: string | null;
}
export interface TexDistribution {
    kind: "oleafly-tinytex" | "mactex" | "texlive" | "miktex" | "tinytex" | "other";
    label: string;
    bin_dir: string;
    latexmk: string | null;
    tlmgr: string | null;
}
export interface TaggedCompileResult {
    success: boolean;
    has_pdf: boolean;
    output_id: string | null;
    output_revision: number | null;
    log: string;
}
export interface TinytexInstallState {
    installing: boolean;
    partial_download_bytes: number;
}
export interface SearchHit {
    project_id: string;
    project_name: string;
    path: string;
    line: number;
    preview: string;
}
export interface StoredModel {
    id: string;
    name: string;
    enabled: boolean;
    source: "builtin" | "fetched" | "custom";
}
export interface CustomProvider {
    id: string;
    name: string;
    baseURL: string;
    keyOptional?: boolean;
}
export interface Persona {
    id: string;
    name: string;
    color: string;
    prompt: string;
}
export interface AppConfig {
    github_token: string;
    github_user: string;
    github_connected: boolean;
    ai_api_key: string;
    ai_provider: string;
    ai_model: string;
    ai_keys: Record<string, string>;
    ai_system_prompt: string;
    ai_pdf_capture: boolean;
    ai_provider_models: Record<string, StoredModel[]>;
    ai_custom_providers: CustomProvider[];
    ai_personas: Persona[];
    mcp_enabled: boolean;
    mcp_port: number;
    mcp_read_only: boolean;
    mcp_approval_policy: string;
}
export interface McpStatus {
    running: boolean;
    port: number | null;
    url: string | null;
    enabled: boolean;
}
export interface McpConnectionInfo {
    url: string;
    token: string;
}
export interface ProviderModel {
    id: string;
    name: string;
}
export interface GitHubUser {
    login: string;
    name: string | null;
    avatar_url: string;
    html_url: string;
}
export interface GitHubRepo {
    full_name: string;
    html_url: string;
    clone_url: string;
    private: boolean;
}
export interface GitHubRepoStats {
    stars: number;
    forks: number;
}
export interface AheadBehind {
    ahead: number;
    behind: number;
    has_upstream: boolean;
}
export interface GitPullResult {
    message: string;
    state: ProjectStateChanged;
}
export interface GitFileChange {
    path: string;
    status: string;
    staged: boolean;
}
export interface SynctexRect {
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface SynctexHit {
    file: string;
    line: number;
    column: number;
}

/**
 * The structured destination-collision failure surfaced by rename and
 * create. Implementations throw their own Error subclass carrying these
 * fields; consumers detect it through `isFileConflictError`.
 */
export interface FileConflictInfo {
  destination: string;
  suggestedDestination: string;
}

export interface BackendPort {
  reloadViews: () => Promise<void>;
  focusCurrentWindow: () => Promise<void>;
  getProjectEngine: (projectId: string) => Promise<DocumentEngineDescriptor>;
  readCompiledPdf: (projectId: string) => Promise<ArrayBuffer>;
  validateCompileFingerprint: (
    projectId: string,
    mainDoc: string,
  ) => Promise<ValidatedCompileFingerprint | null>;
  compileTex: (projectId: string, mainDoc: string, source: string) => Promise<CompileResult>;
  recordProjectTexSpec: (projectId: string) => Promise<TexSpec | null>;
  importOverleafProjectCmd: (path: string, name?: string) => Promise<string>;
  projectTexStatus: (projectId: string) => Promise<TexStatus | null>;
  compileProject: (projectId: string, mainDoc: string, offline?: boolean, fast?: boolean, haltOnError?: boolean) => Promise<CompileResult>;
  cancelCompile: () => Promise<boolean>;
  clearBuildDir: (projectId: string) => Promise<void>;
  compileIsolated: (projectId: string, source: string, offline?: boolean) => Promise<CompileResult>;
  readIsolatedPdf: (projectId: string) => Promise<ArrayBuffer>;
  readProjectBytes: (projectId: string, relPath: string) => Promise<ArrayBuffer>;
  projectMutationGeneration: (projectId: string) => Promise<number>;
  writeProjectBytes: (projectId: string, relPath: string, dataBase64: string, expectedGeneration?: number) => Promise<FileMutationResult>;
  writeBytesFile: (dest: string, dataBase64: string) => Promise<void>;
  loadProjectChats: (projectId: string) => Promise<string>;
  saveProjectChats: (projectId: string, json: string) => Promise<void>;
  listFiles: (projectId: string) => Promise<FileEntry[]>;
  readFileContent: (projectId: string, path: string) => Promise<string>;
  writeFileContent: (projectId: string, path: string, content: string, expectedGeneration?: number) => Promise<FileMutationResult>;
  createFile(projectId: string, path: string, isDir: boolean, conflictStrategy?: FileConflictStrategy, expectedGeneration?: number): Promise<{
    path: string;
    generation: number;
}>;
  deleteFile: (projectId: string, path: string, expectedGeneration?: number) => Promise<FileMutationResult>;
  isFileConflictError: (error: unknown) => error is Error & FileConflictInfo;
  renameFile(projectId: string, from: string, to: string, conflictStrategy?: FileConflictStrategy, expectedGeneration?: number): Promise<string>;
  copyFile: (projectId: string, from: string, to: string, expectedGeneration?: number) => Promise<CopyFileResult>;
  importPathsIntoProject: (projectId: string, destDir: string, sourcePaths: string[], expectedGeneration?: number) => Promise<ImportPathsResult>;
  saveFileBase64: (projectId: string, path: string, data: string, expectedGeneration?: number) => Promise<FileMutationResult>;
  readFileBase64: (projectId: string, path: string) => Promise<string>;
  createProjectFromDocx: (name: string, dataBase64: string) => Promise<string>;
  appendAppLog: (message: string) => Promise<void>;
  readAppLog: (maxBytes: number) => Promise<string>;
  setMainDocCmd: (projectId: string, mainDoc: string) => Promise<ProjectMeta>;
  setProjectEngineCmd: (projectId: string, engine: string, flavor?: TexFlavor | null) => Promise<ProjectMeta>;
  setProjectShellEscapeCmd: (projectId: string, allowShellEscape: boolean) => Promise<ProjectMeta>;
  renameProjectCmd: (projectId: string, name: string) => Promise<ProjectMeta>;
  openDevtools: () => Promise<void>;
  getProject: (projectId: string) => Promise<ProjectMeta>;
  listProjects: () => Promise<ProjectInfo[]>;
  createProject: (name: string) => Promise<string>;
  createProjectFromPdfConversion: (name: string, tex: string, figures: {
    name: string;
    dataBase64: string;
}[]) => Promise<string>;
  createTypstProject: (name: string) => Promise<string>;
  createMarkdownProject: (name: string) => Promise<string>;
  createImageProject: (name: string, source: string, color?: string) => Promise<string>;
  createDiagramProject: (name: string, source: string) => Promise<string>;
  getOrCreateScratchProject: () => Promise<string>;
  saveFigureToCache: (name: string, pngBase64: string, tikz: string) => Promise<FigureCacheResult>;
  saveCustomTemplate: (slug: string, manifestJson: string, files: {
    name: string;
    content: string;
    content_base64?: string;
}[]) => Promise<void>;
  deleteCustomTemplate: (slug: string) => Promise<void>;
  listTemplates: () => Promise<TemplateInfo[]>;
  templatePreview: (templateId: string) => Promise<string | null>;
  createProjectFromTemplate: (name: string, templateId: string, color?: string) => Promise<string>;
  setProjectColor: (projectId: string, color: string) => Promise<ProjectMeta>;
  listFontComponents: () => Promise<ComponentInfo[]>;
  installFontComponent: (id: string) => Promise<void>;
  removeFontComponent: (id: string) => Promise<void>;
  downloadAllFonts: () => Promise<void>;
  templatePrerequisites: (templateId: string) => Promise<Prerequisite[]>;
  ensureTemplateAssets: (templateId: string) => Promise<void>;
  listTemplatePacks: () => Promise<PackInfo[]>;
  refreshPackCatalog: () => Promise<void>;
  installTemplatePack: (id: string) => Promise<void>;
  removeTemplatePack: (id: string) => Promise<void>;
  readDeadlines: () => Promise<string>;
  refreshDeadlines: () => Promise<void>;
  gitAutoCommit: (projectId: string, message: string) => Promise<boolean>;
  gitAutoCommitUpdate: (projectId: string) => Promise<boolean>;
  gitLog: (projectId: string) => Promise<GitCommit[]>;
  gitReadVersionLabels: (projectId: string) => Promise<Record<string, string>>;
  gitSetVersionLabel: (projectId: string, oid: string, label: string) => Promise<void>;
  gitRestore: (projectId: string, oid: string, expectedGeneration: number) => Promise<ProjectStateChanged>;
  exportPdf: (projectId: string, dest: string) => Promise<void>;
  revealInDir: (path: string) => Promise<void>;
  exportDocument: (projectId: string, mainDoc: string, format: string, dest: string) => Promise<void>;
  hasPandoc: () => Promise<boolean>;
  downloadPandoc: () => Promise<string>;
  texDistributions: () => Promise<TexDistribution[]>;
  latexEngineInfo: () => Promise<EngineInfo>;
  hasTaggingEngine: () => Promise<boolean>;
  installTinytex: () => Promise<EngineInfo>;
  tinytexInstallState: () => Promise<TinytexInstallState>;
  confirmQuitDuringInstall: () => Promise<void>;
  confirmQuitFlush: (restart: boolean) => Promise<void>;
  cancelQuitFlush: () => Promise<void>;
  deleteTinytex: () => Promise<void>;
  tlmgrInstalled: () => Promise<string[]>;
  tlmgrInstall: (packages: string[]) => Promise<string>;
  tlmgrRemove: (packages: string[]) => Promise<string>;
  compileTagged: (projectId: string, mainDoc: string) => Promise<TaggedCompileResult>;
  fetchDoiBibtex: (doi: string) => Promise<string>;
  fetchArxiv: (id: string) => Promise<string>;
  literatureArxivLookup: (arxivId: string) => Promise<string>;
  crossrefSearch: (query: string) => Promise<string>;
  literatureSearch: (source: string, query: string, options?: {
    limit?: number;
    yearFrom?: number | null;
    yearTo?: number | null;
    openAccessOnly?: boolean;
}) => Promise<string>;
  getConnectorKey: (connectorId: string) => Promise<string | null>;
  setConnectorKey: (connectorId: string, value: string) => Promise<void>;
  searchDocs: (query: string) => Promise<SearchHit[]>;
  searchProject: (projectId: string, query: string) => Promise<SearchHit[]>;
  getConfig: () => Promise<AppConfig>;
  setConfig: (config: AppConfig) => Promise<void>;
  mcpStatus: () => Promise<McpStatus>;
  mcpSetEnabled: (enabled: boolean) => Promise<McpStatus>;
  mcpRestartServer: () => Promise<McpStatus>;
  mcpConnectionInfo: () => Promise<McpConnectionInfo>;
  mcpRegenerateToken: () => Promise<void>;
  mcpBeginRendererSession: () => Promise<number>;
  mcpRendererHeartbeat: (rendererSession: number) => Promise<void>;
  mcpEndRendererSession: (rendererSession: number) => Promise<void>;
  mcpRegisterTools: (tools: {
    name: string;
    description: string;
    inputSchema: unknown;
}[], rendererSession: number) => Promise<void>;
  readonly REDACTED_MARKER: "__stored__";
  redactedSecretMarker: () => Promise<string>;
  agentListModels: (args: {
    providerId: string;
    key?: string;
    baseURL?: string;
}) => Promise<ProviderModel[]>;
  mcpSetActiveProject: (projectId: string | null) => Promise<void>;
  mcpToolResult: (callId: number, result: unknown, rendererSession: number) => Promise<void>;
  ghCurrentUser: () => Promise<GitHubUser>;
  ghSetToken: (token: string) => Promise<GitHubUser>;
  ghClearToken: () => Promise<void>;
  ghListRepos: () => Promise<GitHubRepo[]>;
  ghCreateRepo: (name: string, isPrivate: boolean) => Promise<GitHubRepo>;
  ghPublicRepoStats: (fullName: string) => Promise<GitHubRepoStats>;
  gitSetRemote: (projectId: string, url: string) => Promise<void>;
  gitRemoveRemote: (projectId: string) => Promise<void>;
  gitGetRemote: (projectId: string) => Promise<string | null>;
  gitCurrentBranch: (projectId: string) => Promise<string>;
  gitAheadBehind: (projectId: string) => Promise<AheadBehind>;
  gitPush: (projectId: string) => Promise<string>;
  gitPull: (projectId: string, expectedGeneration: number) => Promise<GitPullResult>;
  gitStatus: (projectId: string) => Promise<GitFileChange[]>;
  gitDiff: (projectId: string, path?: string, staged?: boolean) => Promise<string>;
  gitDiscard: (projectId: string, path: string, expectedGeneration: number) => Promise<ProjectStateChanged>;
  gitHeadOid: (projectId: string) => Promise<string | null>;
  gitStage: (projectId: string, path: string) => Promise<void>;
  gitUnstage: (projectId: string, path: string) => Promise<void>;
  gitStageAll: (projectId: string) => Promise<void>;
  gitUnstageAll: (projectId: string) => Promise<void>;
  gitCommit: (projectId: string, message: string) => Promise<boolean>;
  gitShow: (projectId: string, rev: "HEAD" | "INDEX", path: string) => Promise<string>;
  downloadProjectZip: (projectId: string, dest: string) => Promise<void>;
  duplicateProject: (projectId: string, newName: string) => Promise<string>;
  clearBuildCache: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  libraryRoot: () => Promise<string>;
  appVersion: () => Promise<string>;
  base64ToUint8Array(b64: string): Uint8Array;
  uint8ToBase64(bytes: Uint8Array): string;
  synctexForward: (projectId: string, mainDoc: string, file: string, line: number) => Promise<SynctexRect | null>;
  synctexInverse: (projectId: string, mainDoc: string, page: number, x: number, y: number) => Promise<SynctexHit | null>;
  synctexMapLine: (compiledSource: string, currentSource: string, line: number, currentToCompiled: boolean) => Promise<number | null>;
}
