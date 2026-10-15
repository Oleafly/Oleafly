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
export const PROTOCOL_VERSION = 6;
/** Feature areas the shell requires from its backend. Keep sorted. */
export const BACKEND_CAPABILITIES = [
    "agent-server",
    "agent-stream",
    "chats",
    "checkpoints",
    "collab",
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
    pending_open?: PendingOpenRequest[];
}
export type OpenRequestSource = "launch" | "forwarded" | "os" | "picker" | "test";
export interface PendingOpenRequest {
    token: string;
    display_name: string;
    source: OpenRequestSource;
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
    column?: number | null;
    end_column?: number | null;
    hints?: string[];
    source_line?: string | null;
    code?: string | null;
}
export type LogSeverity = "error" | "warning" | "info" | "typesetting";
export type LogCategory =
    | "error"
    | "undefined-reference"
    | "undefined-citation"
    | "package-warning"
    | "overfull-box"
    | "underfull-box"
    | "missing-character"
    | "info"
    | "bibtex"
    | "biber";
export interface LogDiagnostic {
    readonly severity: LogSeverity;
    readonly message: string;
    readonly file: string | null;
    readonly line: number | null;
    readonly category: LogCategory;
    readonly errorContext?: string;
}
export type CheckpointSkipReason = "storage_unavailable" | "incomplete_capture";
export type CheckpointPublicationOutcome =
    | { status: "unchanged" }
    | { status: "failed" }
    | { status: "published"; snapshot_root: string; created: boolean }
    | { status: "paused"; files: number; bytes: number }

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
    diagnostics?: LogDiagnostic[];
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
    source_preflight_profile: "latex" | "typst" | "none";
    features: EngineFeature[];
    conversion_exports: Array<"docx" | "html" | "md" | "txt" | "pptx" | "epub" | "typst" | "tex">;
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
    typst_version?: string | null;
    typst_resolved?: TypstResolved | null;
    typst_missing?: string | null;
    typst_vendor_packages?: boolean;
    typst_options?: TypstOptionsDescriptor | null;
}
export interface TypstOptionsDescriptor {
    system_fonts: boolean;
    reproducible: boolean;
    variants: string[];
    font_dirs: string[];
    flags: string[];
    output_formats: string[];
    pdf_standards: string[];
}
export type TypstSource = "bundled" | "downloaded" | "system";
export interface TypstResolved {
    version: string;
    source: TypstSource;
}
export interface TypstSpec {
    version?: string | null;
    vendor_packages?: boolean;
    font_paths?: string[];
    system_fonts?: boolean;
    reproducible?: boolean;
    inputs?: Record<string, string>;
    variants?: Record<string, { inputs?: Record<string, string> }>;
}
export type TexFlavor = "pdflatex" | "xelatex" | "lualatex" | "uplatex" | "platex";
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
export interface ProjectSourcesKnownHash {
    path: string;
    hash: string;
}
export interface ProjectSourcesRequest {
    paths: string[];
    known: ProjectSourcesKnownHash[];
}
export interface ProjectSourceFile {
    path: string;
    hash: string;
    text: string;
}
export interface ProjectSourcesUnreadable {
    path: string;
    message: string;
}
export interface ProjectSourcesResult {
    files: ProjectSourceFile[];
    unchanged: string[];
    unreadable: ProjectSourcesUnreadable[];
    oversized?: string[];
    placeholders?: string[];
    truncated: boolean;
}
export interface DocumentStatsCounts {
    words: number;
    wordsInText: number;
    wordsInHeaders: number;
    wordsOutsideText: number;
    headers: number;
    figures: number;
    mathInline: number;
    mathDisplayed: number;
    characters: number;
    lines: number;
}
export interface DocumentStatsRequest {
    mainDocument: string;
    overrides: Record<string, string>;
}
export interface DocumentStatsFile {
    path: string;
    stats: DocumentStatsCounts;
}
export interface DocumentStatsResult {
    root: string;
    fileCount: number;
    unreadable: string[];
    stats: DocumentStatsCounts;
    files: DocumentStatsFile[];
}
export interface RagRetrieveOverride {
    path: string;
    text: string;
}
export interface RagRetrieveRequest {
    query: string;
    topK?: number;
    overrides: RagRetrieveOverride[];
}
export interface RagChunk {
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    score: number;
}
/** Null means the persisted record is missing or stale: compile normally. */
export interface FileEntry {
    path: string;
    is_dir: boolean;
    unreadable?: boolean;
    placeholder?: boolean;
    read_only?: boolean;
    partial?: boolean;
}
export interface FileTreeListing {
    entries: FileEntry[];
    truncated: boolean;
}
export type CheckpointCaptureMode = "engine_dependencies" | (string & {});
export interface CheckpointPolicy {
    mode: CheckpointCaptureMode;
    [futureField: string]: unknown;
}
export interface ProjectExportRecord {
    date: number;
    filename: string;
    path: string;
}
export interface ProjectMeta {
    name: string;
    main_doc: string;
    engine: string;
    color?: string;
    kind?: string;
    tex?: TexSpec | null;
    tex_flavor?: TexFlavor | null;
    typst?: TypstSpec | null;
    dictionary_locale?: string | null;
    exports?: ProjectExportRecord[];
    hidden?: boolean;
    forked_from?: string | null;
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
    label: string | null;
}
export interface CheckpointCaptureNotice {
    readonly paused: {
        files: number;
        bytes: number;
        file_limit: number;
        byte_limit: number;
    } | null;
    readonly skipped: {
        links: number;
        unsupported_names: number;
        large: number;
        cloud: number;
        other: number;
    };
}
export interface CheckpointStoreStats {
    checkpoint_count: number;
    stored_pack_bytes: number;
    logical_bytes: number;
    reclaimable_bytes: number;
    capture?: CheckpointCaptureNotice;
}
export interface CheckpointIntegrity {
    checked_checkpoints: number;
    checked_files: number;
    checked_chunk_references: number;
    checked_packs: number;
}
export interface CheckpointFileSummary {
    path: string;
    bytes: number;
    content_hash: string;
    stored: boolean;
    folder_settings?: boolean;
}
export interface CheckpointStoreTableCounts {
    checkpoints: number;
    manifests: number;
    packs: number;
    chunks: number;
    manifest_chunks: number;
}
export interface CheckpointStorePack {
    file_name: string;
    bytes: number;
    chunk_count: number;
}
export interface CheckpointStoreInspection {
    store_path: string | null;
    catalog_path: string | null;
    catalog_bytes: number;
    format_version: number;
    lineage: string | null;
    table_counts: CheckpointStoreTableCounts;
    packs: CheckpointStorePack[];
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
export type ProjectAvailability = "unknown" | "ok" | "missing" | "offline" | "replaced" | "permission_denied";
export type ProjectLocationInfo =
    | { kind: "library" }
    | { kind: "linked"; display_path: string; availability: ProjectAvailability };
export type ManifestHome = "library" | "folder" | "device" | "device_foreign";
export type MainDecision = "auto" | "ask" | "no_main";
export interface ProjectAvailabilityReport {
    project_id: string;
    availability: ProjectAvailability;
    modified_at_ms?: number;
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
    location?: ProjectLocationInfo;
    last_opened_at?: number;
    shared?: ProjectSharing | null;
    imported_from?: string | null;
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
    linked_folders_bytes: number;
    linked_folder_count: number;
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
    families?: string[];
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
export type DictionaryState =
    | "bundled"
    | "installed"
    | "available"
    | "downloading";
export interface DictionaryLicense {
    id: string;
    url: string;
}
export interface DictionaryInfo {
    id: string;
    language: string;
    region: string | null;
    license: DictionaryLicense;
    bytes: number;
    state: DictionaryState;
}
export interface DictionaryBytes {
    aff: Uint8Array;
    dic: Uint8Array;
}
export type PackGroup = "curated" | "community" | "typst" | "university";
export interface PackInfo {
    id: string;
    label: string;
    description: string;
    category: string;
    group: PackGroup;
    approx_bytes: number;
    count: number;
    license_summary: string;
    covers: string[];
    installed: boolean;
    installed_count: number;
    version: 1 | 2;
}
export interface PackTemplateLicense {
    spdx: string | null;
    label: string;
}
export interface PackTemplateCredit {
    url: string;
    author: string | null;
}
export interface PackTemplateInfo {
    id: string;
    name: string;
    description: string;
    category: string;
    engine: string;
    license: PackTemplateLicense;
    credit: PackTemplateCredit | null;
    thumb_url: string | null;
    preview_url: string | null;
    kind: string | null;
    languages: string[];
    country: string | null;
    institution: string | null;
    bytes: number;
    file_count: number;
    installed: boolean;
}
export interface PackIndexInfo {
    pack_id: string;
    version: 1 | 2;
    templates: PackTemplateInfo[];
}
export interface GitCommit {
    oid: string;
    short: string;
    time: number;
    message: string;
    author: string;
    parents: string[];
    refs: string[];
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
export interface ZoteroAccount {
    userId: string;
    username: string;
}
export interface ZoteroLibraryExport {
    bibtex: string;
    count: number;
    total: number;
}
export type ZoteroKeySource = "bbt" | "native" | "extra" | "generated";
export type ZoteroLocalState = "unknown" | "notRunning" | "apiDisabled" | "unsupported" | "ready";
export type ZoteroWebState = "notConnected" | "ready" | "keyRejected" | "unreachable" | "rateLimited" | "offline";
export interface ZoteroLocalProbe {
    state: ZoteroLocalState;
    zoteroVersion?: string;
    bbtVersion?: string;
    installed?: boolean;
}
export interface ZoteroLibraryInfo {
    id: string;
    name: string;
    kind: "user" | "group";
    itemCount: number;
    enabled: boolean;
}
export interface ZoteroLibraryStatus {
    local: ZoteroLocalProbe;
    web: ZoteroWebState;
    libraries: ZoteroLibraryInfo[];
    itemCount: number;
    source?: "local" | "web";
    lastSync?: number;
    syncing: boolean;
    progress?: { done: number; total: number };
    error?: string;
    generation: number;
    bbtSeen: boolean;
    retryAt?: number;
    loaded: boolean;
}
export interface ZoteroHit {
    library: string;
    itemKey: string;
    citationKey: string;
    keySource: ZoteroKeySource;
    title: string;
    authors: string[];
    authorCount: number;
    year?: string;
    doi?: string;
    itemType: string;
    dateModified: string;
    score: number;
    aliases?: string[];
}
export interface ZoteroSearchReply {
    generation: number;
    total: number;
    hits: ZoteroHit[];
}
export interface ZoteroKeysReply {
    generation: number;
    keys: string[];
}
export interface ZoteroItemRef {
    library: string;
    itemKey: string;
}
export type ZoteroExportStyle = "biblatex" | "bibtex";
export interface ZoteroExportedEntry {
    library: string;
    itemKey: string;
    citationKey: string;
    keySource: ZoteroKeySource;
    entry: string;
    origin: "betterBibtex" | "zotero" | "cache";
    dateModified: string;
    version: number;
    doi?: string;
}
export interface ZoteroConnectionReport {
    local: ZoteroLocalProbe;
    web: ZoteroWebState;
    source?: "local" | "web";
    libraries: { id: string; name: string; kind: "user" | "group"; itemCount?: number }[];
    error?: string;
}
export interface ZoteroProjectLink {
    library: string;
    itemKey: string;
    dateModified: string;
    version: number;
    hash: string;
    bib: string;
}
export type ModelTrust = "verified" | "untested" | "blocked";
export type ModelStatus = "active" | "deprecated" | "alpha" | "beta";
export interface ModelCost {
    input?: number;
    output?: number;
    cacheRead?: number;
}
export interface ModelMetadata {
    name: string;
    contextWindow?: number;
    outputLimit?: number;
    inputModalities: string[];
    outputModalities: string[];
    toolCall: boolean;
    reasoning: boolean;
    attachment: boolean;
    structuredOutput: boolean;
    status: ModelStatus;
    releaseDate?: string;
    lastUpdated?: string;
    cost?: ModelCost;
}
export interface StoredModel {
    id: string;
    name: string;
    enabled: boolean;
    source: "builtin" | "fetched" | "custom";
    trust?: ModelTrust;
    blockedReason?: string;
    metadata?: ModelMetadata;
}
export interface ModelProbe {
    verdict: "verified" | "blocked";
    reason: string;
    probedAt: number;
}
export interface ModelMetadataStatus {
    source: "cdn" | "bundled" | "cache";
    generatedAt: string;
    refreshedAt: number | null;
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
    ai_model_probes?: Record<string, ModelProbe>;
    ai_model_lists_refreshed_at?: Record<string, number>;
    checkpoints_enabled: boolean;
    checkpoint_notifications: boolean;
    git_auto_init: boolean;
    mcp_enabled: boolean;
    mcp_port: number;
    mcp_read_only: boolean;
    mcp_approval_policy: string;
    mcp_servers: McpServerConfig[];
    skills_share_with_agents?: boolean;
    ui_locale?: string;
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
    trust: ModelTrust;
    blockedReason?: string;
    metadata?: ModelMetadata;
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
export interface DiscordCommunityStats {
    online: number;
}
export interface AheadBehind {
    ahead: number;
    behind: number;
    has_upstream: boolean;
}
export interface GitPullResult {
    message: string;
    outcome: "pulled" | "conflicts";
    conflicts: GitConflict[];
    state: ProjectStateChanged;
}
export interface GitPublishPrepared {
    committed: boolean;
    /** The branch has a commit to push. */
    hasCommit: boolean;
    /** Project-relative paths not staged because they look like secrets. */
    leftOut: string[];
}
export interface GitPublishPreflight {
    /** Secret-looking paths already in the branch history, which a push uploads. */
    trackedSecretFiles: string[];
}
export interface GitFileChange {
    path: string;
    status: string;
    staged: boolean;
    conflict: boolean;
}
export interface GitConflict {
    path: string;
    status: string;
}
export interface GitWorkspaceSnapshot {
    initialized: boolean;
    branch: string | null;
    remote: string | null;
    aheadBehind: AheadBehind;
    operation: "idle" | "merge";
    changes: GitFileChange[];
    conflicts: GitConflict[];
    branches: string[];
    commits: GitCommit[];
    /** False when no usable `git` program is installed. */
    gitAvailable?: boolean;
}
export interface GitWorktreeOperationResult {
    message: string;
    outcome: string;
    conflicts: GitConflict[];
    projectState: ProjectStateChanged;
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

// "unknown" is a role from a later server: no rights at all.
export type CollabServerRole = "admin" | "maintainer" | "member" | "guest" | "unknown";
export type CollabProviderKind = "github" | "oidc" | "email_link" | "unknown";
export interface CollabProvider {
    id: string;
    kind: CollabProviderKind;
    label: string;
}
export type CollabEncryptionSupport = "none" | "allowed" | "required" | "unknown";
export interface CollabCapabilities {
    server_id: string;
    name: string;
    icon_url: string | null;
    version: string;
    protocol: { min: number; max: number };
    needs_setup: boolean;
    providers: CollabProvider[];
    features: {
        email: boolean;
        guests: boolean;
        link_sharing: boolean;
        access_logs: boolean;
        comments: boolean;
        encryption: CollabEncryptionSupport;
    };
    limits: {
        max_project_mb: number;
        max_file_mb: number;
        max_members_per_project: number;
    };
}
export interface CollabAccount {
    account_id: string;
    display_name: string;
    avatar_url: string | null;
    server_role: CollabServerRole;
    emails: string[];
    logins: string[];
}
export interface CollabServer {
    server_id: string;
    url: string;
    name: string;
    icon_url: string | null;
    account: CollabAccount | null;
    added_at: number;
    signed_in: boolean;
}
export interface CollabDevice {
    device_id: string;
    name: string;
    platform: string;
    created_at: number;
    last_seen_at: number | null;
    current: boolean;
}
export type CollabMemberStatus = "active" | "suspended" | "removed";
export interface CollabMember {
    account: CollabAccount;
    status: CollabMemberStatus;
    created_at: number;
    // Shared projects this person owns. Older servers leave it out.
    owned_projects?: number;
}
export interface CollabMemberPatch {
    role?: CollabServerRole | null;
    status?: CollabMemberStatus | null;
}
export type CollabAllowlistMatcher =
    | { kind: "email"; email: string }
    | { kind: "provider_login"; provider: string; login: string };
export interface CollabAllowlistEntry {
    id: string;
    matcher: CollabAllowlistMatcher;
    role: CollabServerRole;
    created_at: number;
    bound_account: string | null;
}
export interface CollabNewAllowlistEntry {
    matcher: CollabAllowlistMatcher;
    role: CollabServerRole;
}
export interface CollabDomainRule {
    id: string;
    domain: string;
    role: CollabServerRole;
    created_at: number;
}
export interface CollabNewDomainRule {
    domain: string;
    role: CollabServerRole;
}
export interface CollabRuntimeSettings {
    guests_enabled: boolean;
    guest_approval_required: boolean;
    directory_visible: boolean;
    directory_shows_email: boolean;
    link_sharing_allowed: boolean;
    access_logs_allowed: boolean;
    email_notifications: boolean;
    comments_allowed: boolean;
}
export type CollabRuntimeSettingsPatch = {
    [K in keyof CollabRuntimeSettings]?: boolean | null;
};
export type CollabSecurityEventKind =
    | "setup_completed"
    | "sign_in"
    | "sign_in_refused"
    | "device_added"
    | "device_signed_out"
    | "refresh_reuse_detected"
    | "member_added"
    | "member_removed"
    | "member_suspended"
    | "member_reactivated"
    | "role_changed"
    | "allowlist_added"
    | "allowlist_removed"
    | "domain_rule_added"
    | "domain_rule_removed"
    | "settings_changed"
    | "unknown";
export interface CollabSecurityEvent {
    id: number;
    at: number;
    actor: string | null;
    kind: CollabSecurityEventKind;
    target: string | null;
    ip: string | null;
    detail: unknown;
}
export interface CollabPage<T> {
    items: T[];
    next_cursor: string | null;
}
export type CollabCheckId =
    | "reachable"
    | "https"
    | "protocol"
    | "websocket"
    | "sign_in_providers"
    | "email"
    | "clock";
export type CollabCheckStatus = "pass" | "fail" | "info" | "skipped";
export interface CollabConnectionCheck {
    id: CollabCheckId;
    status: CollabCheckStatus;
    detail: string | null;
}
export type CollabErrorCode =
    | "unreachable"
    | "not_https"
    | "client_too_old"
    | "server_too_old"
    | "not_admitted"
    | "sign_in_cancelled"
    | "sign_in_timed_out"
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "conflict"
    | "rate_limited"
    | "setup_code_invalid"
    | "server"
    | "internal"
    | "server_changed"
    | "duplicate_server"
    | "device_in_use"
    | "server_unknown"
    | "too_large"
    | "invalid"
    | "invalid_domain"
    | "invalid_email"
    | "invalid_login"
    | "guests_off"
    | "link_sharing_off"
    | "access_log_off"
    | "last_admin"
    | "duplicate_entry"
    | "already_member"
    | "project_not_shared"
    | "project_full"
    | "not_a_link"
    | "signed_out"
    | "server_removed"
    | "share_in_progress"
    | "cancelled"
    | "turned_off"
    | "cloud_synced"
    | "owner_away";
export interface CollabCommandError {
    code: CollabErrorCode;
    message: string;
}
export interface CollabServerChanged {
    serverId: string;
}
// "unknown" is a role from a later server: read-only, like a viewer.
export type CollabProjectRole = "owner" | "editor" | "viewer" | "unknown";
export type CollabProjectStatus = "pending" | "active" | "archived" | "unknown";
export interface CollabPerson {
    account_id: string;
    display_name: string;
    avatar_url: string | null;
    email: string | null;
    login: string | null;
}
export interface CollabProjectSummary {
    project_id: string;
    title: string;
    owner: CollabPerson;
    role: CollabProjectRole;
    status: CollabProjectStatus;
    created_at: number;
    link_sharing: boolean;
    link_role: CollabProjectRole;
    head_seq: number;
}
export interface CollabProjectMember {
    person: CollabPerson;
    role: CollabProjectRole;
    granted_at: number;
}
export interface CollabShareInfo {
    project_id: string;
    server_id: string;
    server_name: string;
    server_url: string;
    shared_project_id: string;
    role: CollabProjectRole;
    link: string;
    account_id: string | null;
}
export interface CollabSharedWithMe {
    server_id: string;
    server_name: string;
    project: CollabProjectSummary;
    local_project_id: string | null;
}
export interface CollabShareProgress {
    projectId: string;
    done: number;
    total: number;
}
// Downloading a shared project: `total` files to fetch, `done` fetched so far.
export interface CollabJoinProgress {
    serverId: string;
    sharedProjectId: string;
    done: number;
    total: number;
}
export type CollabLiveEndReason =
    | "removed"
    | "archived"
    | "signed_out"
    | "stopped"
    | "client_too_old"
    | "server_too_old"
    | "server_changed";
export type CollabLiveState =
    | { state: "connecting" }
    | { state: "online" }
    | { state: "offline"; retry_in_ms: number }
    | { state: "ended"; reason: CollabLiveEndReason | CollabSessionEnd };
export interface CollabLiveStatus {
    projectId: string;
    status: CollabLiveState;
    pending: number;
}
export interface CollabLiveMerged {
    projectId: string;
    files: { path: string; changes: number }[];
    authors: { accountId: string; files: { path: string; changes: number }[] }[];
    review: { before: string; after: string };
}
export interface CollabLiveNewDevice {
    projectId: string;
    accountId: string;
    deviceId: string;
}
export interface CollabMergeReviewFile {
    path: string;
    before: string | null;
    after: string | null;
}
export interface CollabShareCheck {
    server_name: string;
    file_count: number;
    total_bytes: number;
    excluded: string[];
    too_large: string[];
    renamed: string[];
    max_file_mb: number;
    cloud_synced: boolean;
}
export interface CollabLiveRole {
    projectId: string;
    role: CollabProjectRole;
}
export interface CollabPresence {
    projectId: string;
    deviceId: string;
    accountId: string;
    path: string | null;
    cursor: number | null;
    anchor: number | null;
}
export interface CollabPresenceLeft {
    projectId: string;
    deviceId: string;
}
export interface CollabLiveInfo {
    role: CollabProjectRole;
    account_id: string;
    device_id: string;
}
export type CollabTextOperation = (number | string)[];
export type CollabDocMessage =
    | { kind: "ack"; rev: number; length: number }
    | { kind: "remote"; rev: number; op: CollabTextOperation; length: number }
    | { kind: "reset"; rev: number; text: string };
export interface CollabDocOpened {
    file_id: string;
    rev: number;
    text: string;
    // Identifies the channel this open registered. Closing passes it back so
    // a late close can't shut a channel the same file opened since.
    session: number;
}
export interface ProjectSharing {
    server_name: string;
    role: CollabProjectRole;
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
  usageSummary: (projectId: string) => Promise<UsageTotals>;
  budgetGet: (projectId: string) => Promise<number | null>;
  budgetSet: (projectId: string, budgetUsd: number | null) => Promise<void>;
  reloadViews: () => Promise<void>;
  focusCurrentWindow: () => Promise<void>;
  getProjectEngine: (projectId: string) => Promise<DocumentEngineDescriptor>;
  readCompiledPdf: (projectId: string) => Promise<ArrayBuffer>;
  readBuildArtifact: (projectId: string, name: string) => Promise<string | null>;
  validateCompileFingerprint: (
    projectId: string,
    mainDoc: string,
  ) => Promise<ValidatedCompileFingerprint | null>;
  compileTex: (projectId: string, mainDoc: string, source: string) => Promise<CompileResult>;
  recordProjectTexSpec: (projectId: string) => Promise<TexSpec | null>;
  importOverleafProjectCmd: (path: string, name?: string) => Promise<string>;
  projectTexStatus: (projectId: string) => Promise<TexStatus | null>;
  compileProject: (projectId: string, mainDoc: string, offline?: boolean, fast?: boolean, haltOnError?: boolean, typstVariant?: string | null) => Promise<CompileResult>;
  checkpointList: (projectId: string) => Promise<CheckpointSummary[]>;
  checkpointSetLabel: (projectId: string, snapshotRoot: string, label: string) => Promise<CheckpointSummary>;
  checkpointFiles: (projectId: string, snapshotRoot: string) => Promise<CheckpointFileSummary[]>;
  checkpointInspect: (projectId: string) => Promise<CheckpointStoreInspection>;
  checkpointRevealStore: (projectId: string) => Promise<void>;
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
  listFileTree: (projectId: string) => Promise<FileTreeListing>;
  existingProjectFiles: (projectId: string, paths: string[]) => Promise<string[]>;
  watchProjectFolder: (projectId: string) => Promise<number | null>;
  unwatchProjectFolder: (projectId: string, token: number) => Promise<boolean>;
  readFileContent: (projectId: string, path: string) => Promise<string>;
  readProjectSourcesBatch: (projectId: string, request: ProjectSourcesRequest) => Promise<ProjectSourcesResult>;
  documentStats: (projectId: string, request: DocumentStatsRequest) => Promise<DocumentStatsResult>;
  ragRetrieve: (projectId: string, request: RagRetrieveRequest) => Promise<RagChunk[]>;
  writeFileContent: (projectId: string, path: string, content: string, expectedGeneration?: number) => Promise<FileMutationResult>;
  createFile(projectId: string, path: string, isDir: boolean, conflictStrategy?: FileConflictStrategy, expectedGeneration?: number): Promise<{
    path: string;
    generation: number;
}>;
  deleteFile: (projectId: string, path: string, expectedGeneration?: number, permanent?: boolean) => Promise<FileMutationResult>;
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
  projectManifestHome: (projectId: string) => Promise<ManifestHome>;
  saveProjectSettingsToFolder: (projectId: string) => Promise<ProjectMeta>;
  listProjects: () => Promise<ProjectInfo[]>;
  probeProjectAvailability: (projectIds: string[]) => Promise<ProjectAvailabilityReport[]>;
  createProject: (name: string) => Promise<string>;
  createProjectFromPdfConversion: (name: string, tex: string, figures: {
    name: string;
    dataBase64: string;
}[]) => Promise<string>;
  createTypstProject: (name: string) => Promise<string>;
  createMarkdownProject: (name: string) => Promise<string>;
  createImageProject: (name: string, source: string, color?: string) => Promise<string>;
  createDiagramProject: (name: string, source: string, language?: "tikz" | "typst" | "mermaid") => Promise<string>;
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
  listDictionaries: () => Promise<DictionaryInfo[]>;
  installDictionary: (id: string) => Promise<void>;
  removeDictionary: (id: string) => Promise<void>;
  readDictionary: (id: string) => Promise<DictionaryBytes>;
  setProjectDictionaryLocaleCmd: (
    projectId: string,
    locale: string | null,
  ) => Promise<ProjectMeta>;
  resetProjectDictionaryLocaleOnDeviceCmd: (projectId: string) => Promise<ProjectMeta>;
  templatePrerequisites: (templateId: string) => Promise<Prerequisite[]>;
  ensureTemplateAssets: (templateId: string) => Promise<void>;
  listTemplatePacks: () => Promise<PackInfo[]>;
  refreshPackCatalog: (force?: boolean) => Promise<boolean>;
  packIndex: (packId: string, force?: boolean) => Promise<PackIndexInfo>;
  installTemplatePack: (id: string) => Promise<void>;
  installPackTemplate: (packId: string, templateId: string) => Promise<void>;
  removeTemplatePack: (id: string) => Promise<void>;
  readDeadlines: () => Promise<string>;
  refreshDeadlines: () => Promise<void>;
  gitIsInitialized: (projectId: string) => Promise<boolean>;
  gitInitialize: (projectId: string) => Promise<string>;
  gitPreparePublish: (
    projectId: string,
    message: string,
    options?: { allowTrackedSecrets?: string[] },
  ) => Promise<GitPublishPrepared>;
  gitPublishPreflight: (projectId: string) => Promise<GitPublishPreflight>;
  gitLog: (projectId: string) => Promise<GitCommit[]>;
  gitRestore: (projectId: string, oid: string, expectedGeneration: number) => Promise<ProjectStateChanged>;
  exportPdf: (projectId: string, dest: string) => Promise<void>;
  revealInDir: (path: string) => Promise<void>;
  revealProject: (projectId: string, path?: string | null) => Promise<void>;
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
  zoteroVerify: (userId: string, apiKey: string) => Promise<ZoteroAccount>;
  zoteroLibraryBibtex: () => Promise<ZoteroLibraryExport>;
  zoteroLibraryStatus: () => Promise<ZoteroLibraryStatus>;
  zoteroLibrarySync: (offline: boolean, force: boolean) => Promise<ZoteroLibraryStatus>;
  zoteroLibraryTest: (offline: boolean) => Promise<ZoteroConnectionReport>;
  zoteroLibrarySearch: (query: string, limit: number) => Promise<ZoteroSearchReply>;
  zoteroLibraryLookup: (keys: string[]) => Promise<(ZoteroHit | null)[]>;
  zoteroLibraryKeys: () => Promise<ZoteroKeysReply>;
  zoteroLibraryItems: (refs: ZoteroItemRef[]) => Promise<(ZoteroHit | null)[]>;
  zoteroLibraryExport: (
    refs: ZoteroItemRef[],
    style: ZoteroExportStyle,
    offline: boolean,
  ) => Promise<ZoteroExportedEntry[]>;
  zoteroLibrarySetEnabled: (libraryId: string, enabled: boolean) => Promise<ZoteroLibraryStatus>;
  zoteroWebAccount: () => Promise<ZoteroAccount | null>;
  zoteroWebConnect: (userId: string, apiKey: string) => Promise<ZoteroAccount>;
  zoteroWebDisconnect: () => Promise<void>;
  zoteroProjectLinks: (projectId: string) => Promise<Record<string, ZoteroProjectLink>>;
  zoteroUpdateProjectLinks: (
    projectId: string,
    changes: Record<string, ZoteroProjectLink | null>,
  ) => Promise<Record<string, ZoteroProjectLink>>;
  searchDocs: (query: string) => Promise<SearchHit[]>;
  searchProject: (projectId: string, query: string) => Promise<SearchHit[]>;
  getConfig: () => Promise<AppConfig>;
  setConfig: (config: AppConfig) => Promise<void>;
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
  discordCommunityStats: () => Promise<DiscordCommunityStats>;
  collabServersList: () => Promise<CollabServer[]>;
  collabServerProbe: (url: string) => Promise<CollabCapabilities>;
  collabServerSignIn: (url: string, providerId: string, setupCode?: string) => Promise<CollabServer>;
  collabServerSignInCancel: () => Promise<void>;
  collabServerSignOut: (serverId: string, keepLocalCopy?: boolean) => Promise<CollabSignOut>;
  collabServerRemove: (serverId: string, keepLocalCopy?: boolean) => Promise<CollabSignOut>;
  collabServerDevices: (serverId: string) => Promise<CollabDevice[]>;
  collabServerSignOutDevice: (serverId: string, deviceId: string) => Promise<void>;
  collabServerTest: (url: string) => Promise<CollabConnectionCheck[]>;
  collabServerRefresh: (serverId: string) => Promise<CollabServer>;
  collabAdminMembers: (serverId: string) => Promise<CollabMember[]>;
  collabAdminMemberDevices: (serverId: string, accountId: string) => Promise<CollabDevice[]>;
  collabAdminPatchMember: (serverId: string, accountId: string, patch: CollabMemberPatch) => Promise<CollabMember>;
  collabAdminRemoveMember: (serverId: string, accountId: string) => Promise<void>;
  collabAdminSignOutDevice: (serverId: string, deviceId: string) => Promise<void>;
  collabAdminAllowlist: (serverId: string) => Promise<CollabAllowlistEntry[]>;
  collabAdminAddAllowlist: (serverId: string, entry: CollabNewAllowlistEntry) => Promise<CollabAllowlistEntry>;
  collabAdminRemoveAllowlist: (serverId: string, entryId: string) => Promise<void>;
  collabAdminDomainRules: (serverId: string) => Promise<CollabDomainRule[]>;
  collabAdminAddDomainRule: (serverId: string, rule: CollabNewDomainRule) => Promise<CollabDomainRule>;
  collabAdminRemoveDomainRule: (serverId: string, ruleId: string) => Promise<void>;
  collabAdminSettings: (serverId: string) => Promise<CollabRuntimeSettings>;
  collabAdminPatchSettings: (serverId: string, patch: CollabRuntimeSettingsPatch) => Promise<CollabRuntimeSettings>;
  collabAdminSecurityLog: (serverId: string, cursor?: string) => Promise<CollabPage<CollabSecurityEvent>>;
  collabShareInfo: (projectId: string) => Promise<CollabShareInfo | null>;
  collabShareCheck: (projectId: string, serverId: string) => Promise<CollabShareCheck>;
  collabShareProject: (projectId: string, serverId: string) => Promise<CollabShareInfo>;
  collabProjectSummary: (projectId: string) => Promise<CollabProjectSummary>;
  collabMembersList: (projectId: string) => Promise<CollabProjectMember[]>;
  collabMemberSet: (projectId: string, accountId: string, role: CollabProjectRole) => Promise<CollabProjectMember>;
  collabMemberRemove: (projectId: string, accountId: string) => Promise<void>;
  collabPeopleSearch: (projectId: string, query: string) => Promise<CollabPerson[]>;
  collabLinkSharingSet: (projectId: string, enabled: boolean, role: CollabProjectRole) => Promise<CollabProjectSummary>;
  collabStopSharing: (projectId: string) => Promise<void>;
  collabLeaveProject: (projectId: string) => Promise<void>;
  collabSharedWithMe: () => Promise<CollabSharedWithMe[]>;
  collabJoinProject: (serverId: string, sharedProjectId: string) => Promise<string>;
  collabJoinCancel: (serverId: string, sharedProjectId: string) => Promise<void>;
  collabOpenLink: (link: string) => Promise<string>;
  collabPendingLinks: () => Promise<string[]>;
  collabLiveStart: (projectId: string) => Promise<CollabLiveInfo>;
  collabLiveStop: (projectId: string) => Promise<void>;
  collabLiveFlush: (projectId: string) => Promise<void>;
  collabDocOpen: (projectId: string, path: string, onMessage: (message: CollabDocMessage) => void) => Promise<CollabDocOpened | null>;
  collabDocChange: (projectId: string, fileId: string, rev: number, op: CollabTextOperation) => Promise<void>;
  collabDocClose: (projectId: string, fileId: string, session: number) => Promise<void>;
  collabPresenceSet: (projectId: string, path: string | null, cursor: number | null, anchor: number | null) => Promise<void>;
  collabPresenceLeave: (projectId: string) => Promise<void>;
  collabMergeReview: (projectId: string, before: string, after: string) => Promise<CollabMergeReviewFile[]>;
  collabWriteText: (projectId: string, path: string, base: string | null, text: string) => Promise<CollabWriteOutcome>;
  gitSetRemote: (projectId: string, url: string, options?: { replace?: boolean }) => Promise<void>;
  gitRemoveRemote: (projectId: string) => Promise<void>;
  gitGetRemote: (projectId: string) => Promise<string | null>;
  gitRemoteCredentialsNeedCleanup: (projectId: string) => Promise<boolean>;
  gitCleanRemoteCredentials: (projectId: string) => Promise<boolean>;
  gitCurrentBranch: (projectId: string) => Promise<string>;
  gitAheadBehind: (projectId: string) => Promise<AheadBehind>;
  gitPush: (projectId: string) => Promise<string>;
  gitPull: (projectId: string, expectedGeneration: number) => Promise<GitPullResult>;
  gitStatus: (projectId: string) => Promise<GitFileChange[]>;
  gitWorkspaceSnapshot: (projectId: string) => Promise<GitWorkspaceSnapshot>;
  gitDiff: (projectId: string, path?: string, staged?: boolean) => Promise<string>;
  gitDiscard: (projectId: string, path: string, expectedGeneration: number) => Promise<ProjectStateChanged>;
  gitDiscardPaths: (projectId: string, paths: string[], expectedGeneration: number) => Promise<ProjectStateChanged>;
  gitHeadOid: (projectId: string) => Promise<string | null>;
  gitStage: (projectId: string, path: string) => Promise<void>;
  gitUnstage: (projectId: string, path: string) => Promise<void>;
  gitStageAll: (projectId: string) => Promise<void>;
  gitUnstageAll: (projectId: string) => Promise<void>;
  gitStagePaths: (projectId: string, paths: string[]) => Promise<void>;
  gitUnstagePaths: (projectId: string, paths: string[]) => Promise<void>;
  gitCommit: (projectId: string, message: string) => Promise<boolean>;
  gitCommitAmend: (projectId: string, message: string) => Promise<boolean>;
  gitFetch: (projectId: string) => Promise<string>;
  gitCreateBranch: (projectId: string, branch: string) => Promise<string>;
  gitCheckoutBranch: (projectId: string, branch: string, expectedGeneration: number) => Promise<ProjectStateChanged>;
  gitStashPush: (projectId: string, expectedGeneration: number) => Promise<GitWorktreeOperationResult>;
  gitStashPop: (projectId: string, expectedGeneration: number) => Promise<GitWorktreeOperationResult>;
  gitResolveConflict: (projectId: string, path: string, resolution: "current" | "incoming" | "mark", expectedGeneration: number) => Promise<ProjectStateChanged>;
  gitContinueMerge: (projectId: string, expectedGeneration: number) => Promise<GitWorktreeOperationResult>;
  gitAbortMerge: (projectId: string, expectedGeneration: number) => Promise<GitWorktreeOperationResult>;
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
  collabTrashList: (projectId: string) => Promise<CollabTrashEntry[]>;
  collabTrashRestore: (projectId: string, id: string) => Promise<void>;
  collabTreeClashes: (projectId: string) => Promise<CollabTreeClash[]>;
  collabLiveRemovedList: (projectId: string) => Promise<CollabLiveRemovedFile[]>;
  collabLiveRemovedDismiss: (projectId: string, id: string) => Promise<void>;
  collabUploadList: (projectId: string) => Promise<CollabUploadFile[]>;
  collabUploadRetry: (projectId: string) => Promise<void>;
  collabUploadDismiss: (projectId: string, path: string) => Promise<void>;
}

export interface CollabTrashEntry {
  id: string;
  name: string;
  kind: "dir" | "text" | "blob";
  folder: string | null;
  deletedBy: string | null;
  deletedAt: number | null;
}
export interface CollabTreeClash {
  path: string;
  name: string;
  other: string;
}
export interface CollabLiveRenamed {
  projectId: string;
  accountId: string | null;
  before: string;
  ours: string;
  theirs: string;
}
// A change the app couldn't import, even on its own, so it was skipped and
// syncing went on. `deviceId` names the device that made it when known.
export interface CollabChangeSkipped {
  projectId: string;
  seq: number;
  deviceId: string | null;
}
// Why a file of a live project couldn't be written to this computer.
export type CollabUnwrittenReason = "locked" | "read_only" | "no_space" | "not_downloaded" | "other";
// Files that still couldn't be written after a second try. An empty list
// means every file is written again.
export interface CollabLiveUnwritten {
  projectId: string;
  files: { path: string; reason: CollabUnwrittenReason }[];
}
export type CollabSettingNotice =
  | { kind: "mainDocument"; path: string }
  | { kind: "compiler"; engine: string; flavor: string | null }
  | { kind: "spellingLanguage"; locale: string | null }
  | { kind: "typstVersion"; version: string | null }
  | { kind: "typstOptions" };
export interface CollabLiveSettings {
  projectId: string;
  accountId: string | null;
  changes: CollabSettingNotice[];
}
export interface CollabUnsentProject {
  project_id: string;
  name: string;
  changes: number;
}
// `handled` is false when the shared document didn't take the write.
// `reason` says why when it was refused rather than not shared: "read_only"
// when this person can only view the project.
export interface CollabWriteOutcome {
  handled: boolean;
  reason?: string;
}
export interface CollabDetachedProject {
  project_id: string;
  name: string;
}
export interface CollabSignOut {
  signed_out: boolean;
  unsent: CollabUnsentProject[];
  // Projects that stopped syncing because their server was removed. They stay
  // on this computer as ordinary projects. Always empty after a sign-out.
  detached: CollabDetachedProject[];
}
export interface CollabLiveRemovedFile {
  path: string;
  id: string;
  kind: "dir" | "text" | "blob";
  by: string | null;
  yours: boolean;
}
export interface CollabLiveRemoved {
  projectId: string;
  files: CollabLiveRemovedFile[];
  restored: string[];
}
export type CollabUploadState = "waiting" | "failed" | "too_large";
export interface CollabUploadFile {
  path: string;
  state: CollabUploadState;
  size: number;
  limit: number | null;
}
export interface CollabLiveUploads {
  projectId: string;
  files: CollabUploadFile[];
}
export interface CollabLiveKeptFile {
  id: string;
  path: string;
  copy: string;
  kind: "replaced" | "added" | "beside";
  by: string | null;
}
export interface CollabLiveKept {
  projectId: string;
  files: CollabLiveKeptFile[];
}
export interface CollabLocalCopyOffer {
  copyId: string;
  name: string;
  files: string[];
}

export type CollabHealthStatus = "ok" | "warning" | "unknown";
export type CollabHealthIssue =
    | "no_sign_in_provider"
    | "storage_not_writable"
    | "sign_in_failing"
    | "sign_in_emails_paused"
    | "unknown";
// A sign-in option that keeps failing: its provider id, when it started and
// the provider's own message.
export interface CollabSignInProblem {
    provider: string;
    at: number;
    reason: string;
}
export type CollabFilesLocation = "disk" | "s3" | "unknown";
export interface CollabServerCounts {
    people: number;
    suspended_people: number;
    devices: number;
    projects: number;
    archived_projects: number;
    pending_projects: number;
    open_rooms: number;
    people_online: number;
    // Guest invitations an admin or maintainer still has to approve.
    pending_guest_approvals: number;
}
export interface CollabStorageUsage {
    database_bytes: number;
    snapshot_bytes: number;
    file_bytes: number;
    files_location: CollabFilesLocation;
}
export interface CollabAdminOverview {
    server_name: string;
    version: string;
    protocol: { min: number; max: number };
    started_at: number;
    now: number;
    health: { status: CollabHealthStatus; issues: CollabHealthIssue[] };
    counts: CollabServerCounts;
    storage: CollabStorageUsage | null;
    email_configured: boolean;
    providers: CollabProvider[];
    settings: CollabRuntimeSettings;
    limits: CollabCapabilities["limits"];
    archive_days: number;
    sign_in_problems?: CollabSignInProblem[];
}
export type CollabAdminProjectSort = "title" | "owner" | "members" | "size" | "activity" | "created";
export type CollabSortOrder = "asc" | "desc";
export interface CollabAdminProjectsQuery {
    q?: string | null;
    status?: CollabProjectStatus | null;
    sort?: CollabAdminProjectSort | null;
    order?: CollabSortOrder | null;
    cursor?: string | null;
    limit?: number | null;
}
export interface CollabAdminProject {
    project_id: string;
    title: string;
    owner: CollabPerson;
    status: CollabProjectStatus;
    member_count: number;
    size_bytes: number | null;
    created_at: number;
    last_activity_at: number;
    archived_at: number | null;
}
export interface CollabAdminProjectsPage {
    items: CollabAdminProject[];
    next_cursor: string | null;
    total: number;
}
export interface BackendPort {
  collabAdminOverview: (serverId: string) => Promise<CollabAdminOverview>;
  collabAdminProjects: (serverId: string, query: CollabAdminProjectsQuery) => Promise<CollabAdminProjectsPage>;
  collabAdminArchiveProject: (serverId: string, projectId: string) => Promise<CollabAdminProject>;
  collabAdminUnarchiveProject: (serverId: string, projectId: string) => Promise<CollabAdminProject>;
}

export interface CollabEmailFailure {
    at: number;
    message: string;
}
export interface CollabEmailStatus {
    configured: boolean;
    from: string | null;
    notifications: boolean;
    last_failure: CollabEmailFailure | null;
}
export interface CollabEmailTestResult {
    sent_to: string[];
    delivered: boolean;
    error: string | null;
}
export interface CollabEmailPreferences {
    shared_with_you: boolean;
    mentions?: boolean | null;
    mail_configured: boolean;
    notifications: boolean;
}
export interface CollabEmailPreferencesPatch {
    shared_with_you?: boolean | null;
    mentions?: boolean | null;
}
export interface BackendPort {
  collabAdminEmailStatus: (serverId: string) => Promise<CollabEmailStatus>;
  collabAdminEmailTest: (serverId: string) => Promise<CollabEmailTestResult>;
  collabEmailPreferences: (serverId: string) => Promise<CollabEmailPreferences>;
  collabSetEmailPreferences: (serverId: string, patch: CollabEmailPreferencesPatch) => Promise<CollabEmailPreferences>;
}
export type CollabSyncDecision = "send" | "keep_local";
export interface CollabSyncPaused {
    projectId: string;
    changed: number;
    total: number;
    reason: "mass_change" | "root_unavailable";
}
export interface CollabSyncResumed {
    projectId: string;
}
export interface BackendPort {
  collabSyncDecide: (projectId: string, decision: CollabSyncDecision) => Promise<void>;
}

export interface CollabProjectSummary {
    comments_enabled?: boolean;
}
export interface CollabCommentRange {
    from: number;
    to: number;
}
export interface CollabCommentAnchor {
    quote: string;
    range: CollabCommentRange | null;
}
export interface CollabCommentResolution {
    by: string;
    at: number;
}
export interface CollabCommentMessage {
    id: string;
    author: string;
    at: number;
    body: string;
    editedAt: number | null;
    deleted: boolean;
    mentions: string[];
}
export interface CollabCommentThread {
    id: string;
    fileId: string;
    anchor: CollabCommentAnchor;
    createdBy: string;
    createdAt: number;
    resolved: CollabCommentResolution | null;
    messages: CollabCommentMessage[];
}
export interface CollabCommentMember {
    accountId: string;
    displayName: string;
    login?: string | null;
}
export interface CollabCommentsStatus {
    serverAllowed: boolean;
    projectEnabled: boolean;
    canComment: boolean;
}
export interface CollabCommentsStatusChanged {
    projectId: string;
    status: CollabCommentsStatus;
}
export interface CollabCommentNotSent {
    fileId: string;
    path: string | null;
    threadId: string;
    quote: string;
    body: string;
}
export interface CollabCommentsNotSent {
    projectId: string;
    comments: CollabCommentNotSent[];
}
export interface CollabCommentMentioned {
    fileId: string;
    path: string | null;
    threadId: string;
    messageId: string;
    author: string;
}
export interface CollabCommentsChanged {
    projectId: string;
    fileIds: string[];
    paths: string[];
    mentioned: CollabCommentMentioned[];
}
export interface BackendPort {
  collabCommentsStatus: (projectId: string) => Promise<CollabCommentsStatus>;
  collabCommentsSetEnabled: (projectId: string, enabled: boolean) => Promise<CollabProjectSummary>;
  collabCommentReply: (projectId: string, fileId: string, threadId: string, body: string, members: CollabCommentMember[]) => Promise<CollabCommentMessage>;
  collabCommentEdit: (projectId: string, fileId: string, threadId: string, messageId: string, body: string, members: CollabCommentMember[]) => Promise<CollabCommentMessage>;
  collabCommentDelete: (projectId: string, fileId: string, threadId: string, messageId: string) => Promise<void>;
  collabCommentResolve: (projectId: string, fileId: string, threadId: string) => Promise<CollabCommentThread>;
  collabCommentReopen: (projectId: string, fileId: string, threadId: string) => Promise<CollabCommentThread>;
  collabCommentThreadDelete: (projectId: string, fileId: string, threadId: string) => Promise<void>;
}

export interface CollabProjectSummary {
    access_log?: boolean;
}
export type CollabAccessKind = "opened" | "joined" | "downloaded" | "unknown";
export type CollabJoinedVia = "link" | "share" | "unknown";
export interface CollabAccessEntry {
    id: number;
    kind: CollabAccessKind;
    via: CollabJoinedVia | null;
    person: CollabPerson;
    device_name: string;
    at: number;
    last_at: number;
    times: number;
}
export type CollabAccessLogPage = CollabPage<CollabAccessEntry>;
export interface CollabAccessLogStatus {
    serverAllowed: boolean;
    enabled: boolean;
}
export interface BackendPort {
  collabAccessLogStatus: (projectId: string) => Promise<CollabAccessLogStatus>;
  collabAccessLogSetEnabled: (projectId: string, enabled: boolean) => Promise<CollabProjectSummary>;
  collabAccessLogPage: (projectId: string, cursor: string | null) => Promise<CollabAccessLogPage>;
}

export interface CollabPerson {
    guest?: boolean;
}
export type CollabGuestInvitationStatus =
    | "awaiting_approval"
    | "invited"
    | "accepted"
    | "declined"
    | "revoked"
    | "expired"
    | "unknown";
export interface CollabGuestInvitation {
    id: string;
    project_id: string;
    project_title: string;
    email: string;
    role: CollabProjectRole;
    status: CollabGuestInvitationStatus;
    invited_by: CollabPerson;
    created_at: number;
    expires_at: number;
}
export interface CollabProjectGuestInvitations {
    guests_enabled: boolean;
    approval_required: boolean;
    sends_email: boolean;
    add_link: string;
    invitations: CollabGuestInvitation[];
}
export interface CollabGuestInviteResult {
    invitation: CollabGuestInvitation;
    emailed: boolean;
    add_link: string;
}
export interface BackendPort {
  collabGuestInvitations: (projectId: string) => Promise<CollabProjectGuestInvitations>;
  collabGuestInvite: (projectId: string, email: string, role: CollabProjectRole) => Promise<CollabGuestInviteResult>;
  collabGuestInvitationRevoke: (projectId: string, invitationId: string) => Promise<void>;
  collabAdminGuestInvitations: (serverId: string) => Promise<CollabGuestInvitation[]>;
  collabAdminGuestApprove: (serverId: string, invitationId: string) => Promise<CollabGuestInvitation>;
  collabAdminGuestDecline: (serverId: string, invitationId: string) => Promise<CollabGuestInvitation>;
  collabAdminGuestRevoke: (serverId: string, invitationId: string) => Promise<void>;
}

export interface CollabSignInCode {
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresAt: number;
}
export interface CollabRuntimeSettings {
    email_link_sign_in?: boolean;
}
export interface BackendPort {
  collabServerCodeSignIn: (
    url: string,
    setupCode: string | undefined,
    onCode: (code: CollabSignInCode) => void,
  ) => Promise<CollabServer>;
}

export interface CollabCommentMessage {
    verified: boolean;
}
export interface CollabCommentThread {
    verified: boolean;
}
export interface CollabCommentResolution {
    verified: boolean;
}
export interface CollabCommentsChanged {
    local: boolean;
}
export interface CollabCommentThreadList {
    rev: number | null;
    threads: CollabCommentThread[];
}
export interface CollabCommentCount {
    path: string;
    open: number;
    resolved: number;
}
export type CollabCommentErrorCode =
    | "comment_not_live"
    | "comment_not_yours"
    | "comment_off_server"
    | "comment_off_project"
    | "comment_viewer"
    | "comment_someone_replied"
    | "comment_message_deleted"
    | "comment_selection_changed"
    | "comment_too_long"
    | "comment_empty";
export interface CollabCommentError {
    code: CollabCommentErrorCode;
    message: string;
}
export interface BackendPort {
  collabCommentThreadList: (projectId: string, path: string) => Promise<CollabCommentThreadList>;
  collabCommentCounts: (projectId: string) => Promise<CollabCommentCount[]>;
  collabCommentFilePath: (projectId: string, fileId: string) => Promise<string | null>;
  collabCommentCreate: (projectId: string, path: string, from: number, to: number, rev: number | null, body: string, members: CollabCommentMember[]) => Promise<CollabCommentThread>;
}

export type CollabSecurityLogKind =
    | CollabSecurityEventKind
    | "project_shared"
    | "project_access_granted"
    | "project_access_changed"
    | "project_access_removed"
    | "project_archived"
    | "project_unarchived"
    | "project_settings_changed"
    | "guest_invited"
    | "guest_invitation_approved"
    | "guest_invitation_declined"
    | "guest_invitation_revoked"
    | "guest_admission_ended"
    | "project_rejoin_refused";
export interface CollabSecurityEvent {
    project_title?: string | null;
}

export interface BackendPort {
  collabLinkPreview: (serverId: string, sharedProjectId: string) => Promise<CollabProjectSummary>;
}

export type CollabSessionEnd = "account_suspended" | "access_ended";
// `server_removed` never arrives in a status event: the app shows it when a
// live start is refused because the project's server is no longer listed.
export type CollabLiveEndedReason = CollabLiveEndReason | CollabSessionEnd | "server_removed";
export type CollabLiveSyncState =
    | Exclude<CollabLiveState, { state: "ended" }>
    | { state: "ended"; reason: CollabLiveEndedReason };
export interface CollabServer {
    ended?: CollabSessionEnd | null;
}
export interface CollabSecurityEvent {
    device_name?: string | null;
}
export type CollabMemberChangeKind = "added" | "removed" | "role_changed" | "unknown";
export interface CollabLiveMembers {
    projectId: string;
    accountId: string;
    by: string;
    kind: CollabMemberChangeKind;
}
