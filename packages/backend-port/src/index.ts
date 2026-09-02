// The transport contract between any Oleafly frontend shell and its backend.
// Pure types: no Tauri, no HTTP, no runtime code. The desktop shell implements
// it over Tauri IPC — src/lib/backend-port-conformance.ts proves that at
// compile time, so drift between this contract and src/lib/tauri.ts fails
// `tsc` and `pnpm build`. A web shell implements the same surface over
// HTTP/WS. Grow the contract here first; the conformance check then demands
// the desktop implementation.

/**
 * Version of this contract. Bump on any breaking change to the command
 * surface. The desktop backend reports its own version through
 * `backendProtocolInfo`; a mismatch means the shell and backend were built
 * against different contracts and the shell must degrade gracefully.
 * src-tauri/src/protocol.rs mirrors both constants; the vitest conformance
 * test (src/lib/backend-port-protocol.test.ts) fails on drift.
 */
export const PROTOCOL_VERSION = 3;
/** Feature areas the shell requires from its backend. Keep sorted. */
export const BACKEND_CAPABILITIES = [
    "agent-server",
    "agent-stream",
    "chats",
    "checkpoints",
    "compile",
    "git",
    "initial-state",
    "mcp",
    "search",
    "synctex",
    "templates",
] as const;
export type BackendCapability = (typeof BACKEND_CAPABILITIES)[number];
export interface BackendProtocolInfo {
    protocol_version: number;
    capabilities: string[];
}
/** Agent-server handshake reply (protocol v2). Mirrors
 * src-tauri/src/agent_server/protocol.rs. */
export interface AgentServerInfo {
    app_server_protocol_version: number;
    native_host_protocol_version: number;
    schema_version: number;
    server_version: string;
}
export interface AgentClientInfo {
    name: string;
    version: string;
}
export interface AgentClientCapabilities {
    optOutNotificationMethods: string[];
}
/** Decision on a server-initiated request (approval / user input /
 * elicitation). Legacy wire spellings are accepted by the backend. */
export type AgentRequestDecision =
    | "accept"
    | "acceptForSession"
    | "acceptWithExecpolicyAmendment"
    | "decline";
/** One-round-trip startup snapshot the backend pre-computes; fields are
 * best-effort and never block first paint. */
export interface InitialState {
    config: AppConfig | null;
    projects: ProjectInfo[];
}
/** Persisted per-project tool-approval decision (~/.oleafly/approvals.toml). */
export type ToolDecision = "allow" | "deny";
export interface ChatSearchHit {
    project_id: string;
    chat_id: string;
    title: string;
    snippet: string;
}
export interface UsageTotals {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
}
export interface CompileError {
    line: number | null;
    file: string | null;
    message: string;
    kind: string;
    explanation: string | null;
}
export type CheckpointSkipReason =
    | "invalid_policy"
    | "dependency_evidence_unavailable"
    | "untracked_external_commands"
    | "external_dependency"
    | "ignored_required_dependency"
    | "insufficient_space";
export type CheckpointPublicationOutcome =
    | { status: "not_attempted" }
    | { status: "scheduled" }
    | { status: "published"; snapshot_root: string; created: boolean }

    | {
        status: "published_durability_uncertain";
        snapshot_root: string;
        created: boolean;
    }
    | {
        status: "skipped";
        reason: CheckpointSkipReason;
        message: string;
        suggestion: string;
    };
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
    /** Optional for compatibility with older desktop backends. */
    checkpoint_publication?: CheckpointPublicationOutcome;
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
export type CheckpointCaptureMode = "engine_dependencies" | (string & {});
export interface CheckpointPolicy {
    mode: CheckpointCaptureMode;
    always_include: string[];
    ignored: string[];
    [futureField: string]: unknown;
}
export interface ProjectMeta {
    name: string;
    main_doc: string;
    engine: string;
    color?: string;
    kind?: string;
    tex?: TexSpec | null;
    allow_shell_escape: boolean;
    checkpoints: CheckpointPolicy;
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
export interface CheckpointSummary {
    snapshot_root: string;
    completed_at_unix_ms: number;
    engine: string;
    toolchain_identity: string;
    main_document: string;
    output_hash: string;
    file_count: number;
    logical_bytes: number;
}
export interface CheckpointStoreStats {
    checkpoint_count: number;
    stored_pack_bytes: number;
    logical_bytes: number;
    reclaimable_bytes: number;
}
export interface CheckpointIntegrity {
    checked_checkpoints: number;
    checked_files: number;
    checked_chunk_references: number;
    checked_packs: number;
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
    recovery_pending: boolean;
}
export interface LibraryStorageSummary {
    total_bytes: number;
    projects_bytes: number;
    source_bytes: number;
    image_bytes: number;
    pdf_bytes: number;
    git_bytes: number;
    build_bytes: number;
    recycle_bin_bytes: number;
    app_data_bytes: number;
    project_count: number;
    recycled_project_count: number;
    file_count: number;
    directory_count: number;
    image_count: number;
    pdf_count: number;
    unreadable_entries: number;
}
export interface RecycledProjectInfo {
    id: string;
    project_id: string;
    name: string;
    deleted_at: number;
    size_bytes: number;
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
    ai_starter_personas_seeded: boolean;
    checkpoint_defaults: CheckpointPolicy;
    mcp_enabled: boolean;
    mcp_port: number;
    mcp_read_only: boolean;
    mcp_approval_policy: string;
    mcp_servers: McpServerConfig[];
}
export type McpServerConfig = {
    name: string;
    enabled: boolean;
    transport: "stdio";
    command: string;
    args: string[];
    env: Record<string, string>;
} | {
    name: string;
    enabled: boolean;
    transport: "remote";
    url: string;
    headers: Record<string, string>;
};
export interface McpServerTool {
    name: string;
    description?: string | null;
}
export type McpServerValidationStatus = "connected" | "error" | "disabled" | "checking";
export interface McpServerValidation {
    name: string;
    status: McpServerValidationStatus;
    tool_count: number;
    tools: McpServerTool[];
    error: string | null;
}
export interface McpManagedServer {
    config: McpServerConfig;
    validation: McpServerValidation;
}
export interface McpAgentTool {
    name: string;
    tool_handle: string;
    description: string | null;
    input_schema: unknown;
}
export interface McpAgentServer {
    name: string;
    tools: McpAgentTool[];
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
  backendProtocolInfo: () => Promise<BackendProtocolInfo>;
  initialState: () => Promise<InitialState>;
  approvalsList: (projectId: string) => Promise<Record<string, ToolDecision>>;
  approvalsSet: (projectId: string, tool: string, decision: ToolDecision | null) => Promise<void>;
  chatsSearch: (query: string) => Promise<ChatSearchHit[]>;
  usageRecord: (projectId: string, chatId: string, provider: string, model: string, inputTokens: number, outputTokens: number, costUsd: number) => Promise<void>;
  usageSummary: (projectId: string) => Promise<UsageTotals>;
  budgetGet: (projectId: string) => Promise<number | null>;
  budgetSet: (projectId: string, budgetUsd: number | null) => Promise<void>;
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
  checkpointList: (projectId: string) => Promise<CheckpointSummary[]>;
  checkpointStats: (projectId: string) => Promise<CheckpointStoreStats>;
  checkpointRestore: (projectId: string, snapshotRoot: string, expectedGeneration: number) => Promise<ProjectStateChanged>;
  checkpointDelete: (projectId: string, snapshotRoot: string) => Promise<void>;
  checkpointKeepLatest: (projectId: string) => Promise<void>;
  checkpointReset: (projectId: string) => Promise<void>;
  checkpointVerify: (projectId: string) => Promise<CheckpointIntegrity>;
  checkpointExport: (projectId: string, dest: string, password: string) => Promise<void>;
  checkpointImport: (projectId: string, source: string, password: string) => Promise<void>;
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
  /** Same data as readAppLog, streamed in acknowledged chunks so a large log
   * cannot jank the webview with one giant IPC return. */
  readAppLogChunked: (maxBytes: number) => Promise<string>;
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
  gitIsInitialized: (projectId: string) => Promise<boolean>;
  gitInitialize: (projectId: string) => Promise<string>;
  gitPreparePublish: (projectId: string, message: string) => Promise<boolean>;
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
  setCheckpointPolicy: (projectId: string, policy: CheckpointPolicy) => Promise<ProjectMeta>;
  setCheckpointDefaults: (policy: CheckpointPolicy) => Promise<void>;
  seedStarterPersonas: (starters: Persona[]) => Promise<AppConfig>;
  mcpStatus: () => Promise<McpStatus>;
  mcpSetEnabled: (enabled: boolean) => Promise<McpStatus>;
  mcpRestartServer: () => Promise<McpStatus>;
  mcpConnectionInfo: () => Promise<McpConnectionInfo>;
  mcpRegenerateToken: () => Promise<void>;
  mcpServersList: () => Promise<McpManagedServer[]>;
  mcpServerAdd: (server: McpServerConfig) => Promise<McpManagedServer>;
  mcpServerUpdate: (originalName: string, server: McpServerConfig) => Promise<McpManagedServer>;
  mcpServerRemove: (name: string) => Promise<void>;
  mcpServerSetEnabled: (name: string, enabled: boolean) => Promise<McpManagedServer>;
  mcpServerValidate: (name: string) => Promise<McpServerValidation>;
  mcpAgentToolsList: () => Promise<McpAgentServer[]>;
  mcpAgentToolAuthorize: (
    projectId: string,
    server: string,
    toolHandle: string,
    argumentsValue: Record<string, unknown>,
    runId: string,
  ) => Promise<string>;
  mcpAgentToolCall: (
    projectId: string,
    server: string,
    toolHandle: string,
    argumentsValue: Record<string, unknown>,
    runId: string,
    approvalToken: string,
  ) => Promise<unknown>;
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
  /** Agent-server capability handshake; call once at shell startup. */
  agentServerInitialize: (
    clientInfo: AgentClientInfo,
    capabilities: AgentClientCapabilities,
  ) => Promise<AgentServerInfo>;
  /** Answer a server-initiated request the shell received. */
  agentServerResolveRequest: (
    requestId: string,
    decision: AgentRequestDecision,
    payload?: unknown,
  ) => Promise<void>;
  /** Drop a server-initiated request without a decision. */
  agentServerAbandonRequest: (requestId: string) => Promise<void>;
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
  gitRemoteCredentialsNeedCleanup: (projectId: string) => Promise<boolean>;
  gitCleanRemoteCredentials: (projectId: string) => Promise<boolean>;
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
  recycleProject: (projectId: string) => Promise<void>;
  listRecycledProjects: () => Promise<RecycledProjectInfo[]>;
  restoreRecycledProject: (recycleId: string) => Promise<string>;
  permanentlyDeleteRecycledProject: (recycleId: string) => Promise<void>;
  libraryRoot: () => Promise<string>;
  appVersion: () => Promise<string>;
  base64ToUint8Array(b64: string): Uint8Array;
  uint8ToBase64(bytes: Uint8Array): string;
  synctexForward: (projectId: string, mainDoc: string, file: string, line: number) => Promise<SynctexRect | null>;
  synctexInverse: (projectId: string, mainDoc: string, page: number, x: number, y: number) => Promise<SynctexHit | null>;
  synctexMapLine: (compiledSource: string, currentSource: string, line: number, currentToCompiled: boolean) => Promise<number | null>;
}
