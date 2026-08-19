import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type {
  AheadBehind,
  AppConfig,
  CompileResult,
  ComponentInfo,
  CopyFileResult,
  CreateFileResult,
  DocumentEngineDescriptor,
  EngineInfo,
  FigureCacheResult,
  FileConflictStrategy,
  FileEntry,
  FileMutationResult,
  GitCommit,
  GitFileChange,
  GitHubRepo,
  GitHubUser,
  GitPullResult,
  ImportPathsResult,
  McpConnectionInfo,
  McpStatus,
  PackInfo,
  Prerequisite,
  ProjectInfo,
  ProjectMeta,
  ProjectStateChanged,
  ProviderModel,
  RenameFileResult,
  SearchHit,
  SynctexHit,
  SynctexRect,
  TaggedCompileResult,
  TemplateInfo,
  TexDistribution,
  TexFlavor,
  TexSpec,
  TexStatus,
  TinytexInstallState,
  ValidatedCompileFingerprint,
} from "@oleafly/backend-port";
export type * from "@oleafly/backend-port";

export const reloadViews = () => invoke<void>("reload_views");

export const focusCurrentWindow = async () => {
  const window = getCurrentWindow();
  await window.setFocus();
};







export const getProjectEngine = (projectId: string) =>
  invoke<DocumentEngineDescriptor>("project_engine", { projectId });

export const readCompiledPdf = (projectId: string) =>
  invoke<ArrayBuffer>("read_compiled_pdf", { projectId });


/** Null means the persisted record is missing or stale: compile normally. */
export const validateCompileFingerprint = (projectId: string, mainDoc: string) =>
  invoke<ValidatedCompileFingerprint | null>("validate_compile_fingerprint", {
    projectId,
    mainDoc,
  });

export const compileTex = (
  projectId: string,
  mainDoc: string,
  source: string
) => invoke<CompileResult>("compile_tex", { projectId, mainDoc, source });






// Capture the local distro + tlmgr package versions into the project pin.
export const recordProjectTexSpec = (projectId: string) =>
  invoke<TexSpec | null>("record_project_tex_spec", { projectId });

// Import an Overleaf ZIP export (or a plain folder) as a new project; the
// main document is inferred when the archive carries no project.json.
export const importOverleafProjectCmd = (path: string, name?: string) =>
  invoke<string>("import_overleaf_project", { path, name: name ?? null });

// Compare this machine against the project pin (null when not applicable).
export const projectTexStatus = (projectId: string) =>
  invoke<TexStatus | null>("project_tex_status", { projectId });


export const compileProject = (
  projectId: string,
  mainDoc: string,
  offline = false,
  fast = false,
  haltOnError = false,
) =>
  invoke<CompileResult>("compile_project", {
    projectId,
    mainDoc,
    offline,
    fast,
    haltOnError,
  });

/// Ends the running main-document compile. Resolves to whether a compiler
/// process was actually terminated.
export const cancelCompile = () => invoke<boolean>("cancel_compile", {});

/// Empties the project's build directory so the next compile reuses nothing.
export const clearBuildDir = (projectId: string) =>
  invoke<void>("clear_build_dir", { projectId });

// Runs in a separate build dir from the main project compile.
export const compileIsolated = (projectId: string, source: string, offline = false) =>
  invoke<CompileResult>("compile_isolated", { projectId, source, offline });

export const readIsolatedPdf = (projectId: string) =>
  invoke<ArrayBuffer>("read_isolated_pdf", { projectId });

export const readProjectBytes = (projectId: string, relPath: string) =>
  invoke<ArrayBuffer>("read_project_bytes", { projectId, relPath });


export const projectMutationGeneration = (projectId: string) =>
  invoke<number>("project_mutation_generation", { projectId });

export const writeProjectBytes = (
  projectId: string,
  relPath: string,
  dataBase64: string,
  expectedGeneration?: number,
) =>
  invoke<FileMutationResult>("write_project_bytes", {
    projectId,
    relPath,
    dataBase64,
    expectedGeneration,
  });

// Used for absolute paths from a save dialog.
export const writeBytesFile = (dest: string, dataBase64: string) =>
  invoke<void>("write_bytes_file", { dest, dataBase64 });

export const loadProjectChats = (projectId: string) =>
  invoke<string>("load_project_chats", { projectId });

// Atomic write on the Rust side.
export const saveProjectChats = (projectId: string, json: string) =>
  invoke<void>("save_project_chats", { projectId, json });

export const listFiles = (projectId: string) =>
  invoke<FileEntry[]>("list_files", { projectId });

export const readFileContent = (projectId: string, path: string) =>
  invoke<string>("read_file", { projectId, path });

export const writeFileContent = (
  projectId: string,
  path: string,
  content: string,
  expectedGeneration?: number,
) => invoke<FileMutationResult>("write_file", { projectId, path, content, expectedGeneration });

export async function createFile(
  projectId: string,
  path: string,
  isDir: boolean,
  conflictStrategy: FileConflictStrategy = "error",
  expectedGeneration?: number,
): Promise<{ path: string; generation: number }> {
  const result = await invoke<CreateFileResult>("create_file", {
    projectId,
    path,
    isDir,
    conflictStrategy,
    expectedGeneration,
  });
  if (result.status === "conflict") throw new FileConflictError(result);
  return { path: result.path, generation: result.generation };
}

export const deleteFile = (projectId: string, path: string, expectedGeneration?: number) =>
  invoke<FileMutationResult>("delete_file", { projectId, path, expectedGeneration });

export class FileConflictError extends Error {
  readonly destination: string;
  readonly suggestedDestination: string;

  constructor(result: Extract<RenameFileResult, { status: "conflict" }>) {
    super(`A file or folder already exists at ${result.destination}.`);
    this.name = "FileConflictError";
    this.destination = result.destination;
    this.suggestedDestination = result.suggested_destination;
  }
}

export const isFileConflictError = (error: unknown): error is FileConflictError =>
  error instanceof FileConflictError;

export async function renameFile(
  projectId: string,
  from: string,
  to: string,
  conflictStrategy: FileConflictStrategy = "error",
  expectedGeneration?: number,
): Promise<string> {
  const result = await invoke<RenameFileResult>("rename_file", {
    projectId,
    from,
    to,
    conflictStrategy,
    expectedGeneration,
  });
  if (result.status === "conflict") throw new FileConflictError(result);
  return result.path;
}


export const copyFile = (
  projectId: string,
  from: string,
  to: string,
  expectedGeneration?: number,
) => invoke<CopyFileResult>("copy_file", { projectId, from, to, expectedGeneration });


export const importPathsIntoProject = (
  projectId: string,
  destDir: string,
  sourcePaths: string[],
  expectedGeneration?: number,
) =>
  invoke<ImportPathsResult>("import_paths_into_project", {
    projectId,
    destDir,
    sourcePaths,
    expectedGeneration,
  });

export const saveFileBase64 = (
  projectId: string,
  path: string,
  data: string,
  expectedGeneration?: number,
) => invoke<FileMutationResult>("save_file_base64", { projectId, path, data, expectedGeneration });

export const readFileBase64 = (projectId: string, path: string) =>
  invoke<string>("read_file_base64", { projectId, path });

export const createProjectFromDocx = (name: string, dataBase64: string) =>
  invoke<string>("create_project_from_docx", { name, dataBase64 });

export const appendAppLog = (message: string) =>
  invoke<void>("append_app_log", { message });

export const readAppLog = (maxBytes: number) =>
  invoke<string>("read_app_log", { maxBytes });

export const setMainDocCmd = (projectId: string, mainDoc: string) =>
  invoke<ProjectMeta>("set_main_doc", { projectId, mainDoc });

// Pin a project's compile engine ("xetex" for bundled Tectonic, "latexmk" for
// a system TeX toolchain) in its project.json. On latexmk, `flavor` pins the
// compiler (pdflatex / xelatex / lualatex); null keeps auto-detection.
export const setProjectEngineCmd = (
  projectId: string,
  engine: string,
  flavor: TexFlavor | null = null,
) => invoke<ProjectMeta>("set_project_engine", { projectId, engine, flavor });

export const setProjectShellEscapeCmd = (
  projectId: string,
  allowShellEscape: boolean,
) =>
  invoke<ProjectMeta>("set_project_shell_escape", {
    projectId,
    allowShellEscape,
  });

export const renameProjectCmd = (projectId: string, name: string) =>
  invoke<ProjectMeta>("rename_project", { projectId, name });

// No-op in release builds; only opens devtools in dev.
export const openDevtools = () => invoke<void>("open_devtools");

export const getProject = (projectId: string) =>
  invoke<ProjectMeta>("get_project", { projectId });

export const listProjects = () => invoke<ProjectInfo[]>("list_projects");

export const createProject = (name: string) =>
  invoke<string>("create_project", { name });

export const createProjectFromPdfConversion = (
  name: string,
  tex: string,
  figures: { name: string; dataBase64: string }[],
) =>
  invoke<string>("create_project_from_pdf_conversion", { name, tex, figures });

export const createTypstProject = (name: string) =>
  invoke<string>("create_typst_project", { name });

export const createMarkdownProject = (name: string) =>
  invoke<string>("create_markdown_project", { name });

export const createImageProject = (name: string, source: string, color?: string) =>
  invoke<string>("create_image_project", { name, source, color });

export const createDiagramProject = (name: string, source: string) =>
  invoke<string>("create_diagram_project", { name, source });

export const getOrCreateScratchProject = () =>
  invoke<string>("get_or_create_scratch_project");


export const saveFigureToCache = async (
  name: string,
  pngBase64: string,
  tikz: string,
): Promise<FigureCacheResult> => {
  const result = await invoke<{ hash: string; already_cached: boolean }>(
    "save_figure_to_cache",
    { name, pngBase64, tikz },
  );
  return { hash: result.hash, alreadyCached: result.already_cached };
};





export const saveCustomTemplate = (
  slug: string,
  manifestJson: string,
  files: { name: string; content: string; content_base64?: string }[]
) => invoke<void>("save_custom_template", { slug, manifestJson, files });

export const deleteCustomTemplate = (slug: string) =>
  invoke<void>("delete_custom_template", { slug });

export const listTemplates = () => invoke<TemplateInfo[]>("list_templates");

export const templatePreview = (templateId: string) =>
  invoke<string | null>("template_preview", { templateId });

export const createProjectFromTemplate = (
  name: string,
  templateId: string,
  color?: string,
) => invoke<string>("create_project_from_template", { name, templateId, color });

export const setProjectColor = (projectId: string, color: string) =>
  invoke<ProjectMeta>("set_project_color", { projectId, color });

// --- Downloadable assets (font packs) ---




export const listFontComponents = () => invoke<ComponentInfo[]>("list_font_components");

export const installFontComponent = (id: string) =>
  invoke<void>("install_font_component", { id });

export const removeFontComponent = (id: string) =>
  invoke<void>("remove_font_component", { id });

export const downloadAllFonts = () => invoke<void>("download_all_fonts");

export const templatePrerequisites = (templateId: string) =>
  invoke<Prerequisite[]>("template_prerequisites", { templateId });

export const ensureTemplateAssets = (templateId: string) =>
  invoke<void>("ensure_template_assets", { templateId });


export const listTemplatePacks = () => invoke<PackInfo[]>("list_template_packs");

export const refreshPackCatalog = () => invoke<void>("refresh_pack_catalog");

export const installTemplatePack = (id: string) =>
  invoke<void>("install_template_pack", { id });

export const removeTemplatePack = (id: string) =>
  invoke<void>("remove_template_pack", { id });

export const readDeadlines = () => invoke<string>("read_deadlines");

export const refreshDeadlines = () => invoke<void>("refresh_deadlines");


export const gitAutoCommit = (projectId: string, message: string) =>
  invoke<boolean>("git_auto_commit", { projectId, message });

export const gitAutoCommitUpdate = (projectId: string) =>
  invoke<boolean>("git_auto_commit_update", { projectId });

export const gitLog = (projectId: string) =>
  invoke<GitCommit[]>("git_log", { projectId });

export const gitReadVersionLabels = (projectId: string) =>
  invoke<Record<string, string>>("git_read_version_labels", { projectId });

export const gitSetVersionLabel = (projectId: string, oid: string, label: string) =>
  invoke<void>("git_set_version_label", { projectId, oid, label });

export const gitRestore = (projectId: string, oid: string, expectedGeneration: number) =>
  invoke<ProjectStateChanged>("git_restore", { projectId, oid, expectedGeneration });

export const exportPdf = (projectId: string, dest: string) =>
  invoke<void>("export_pdf", { projectId, dest });

export const revealInDir = (path: string) =>
  invoke<void>("reveal_in_dir", { path });

export const exportDocument = (projectId: string, mainDoc: string, format: string, dest: string) =>
  invoke<void>("export_document", { projectId, mainDoc, format, dest });

export const hasPandoc = () => invoke<boolean>("has_pandoc");

// Emits `pandoc-download-progress` events while downloading.
export const downloadPandoc = () => invoke<string>("download_pandoc");

// --- Optional LuaLaTeX engine (tagged / accessible export) ---



export const texDistributions = () => invoke<TexDistribution[]>("tex_distributions");



export const latexEngineInfo = () => invoke<EngineInfo>("latex_engine_info");
export const hasTaggingEngine = () => invoke<boolean>("has_tagging_engine");
// Emits phased `tinytex-install-progress` events (download/extract/packages);
// a failed download keeps its partial file so a retry resumes.
export const installTinytex = () => invoke<EngineInfo>("install_tinytex");
export const tinytexInstallState = () =>
  invoke<TinytexInstallState>("tinytex_install_state");
// The user confirmed quitting mid-install; the app exits immediately.
export const confirmQuitDuringInstall = () =>
  invoke<void>("confirm_quit_during_install");
// The quit flush finished (or was overridden): let the quit/restart through.
export const confirmQuitFlush = (restart: boolean) =>
  invoke<void>("confirm_quit_flush", { restart });
// The user chose to stay after a blocked quit; the next quit flushes again.
export const cancelQuitFlush = () => invoke<void>("cancel_quit_flush");
export const deleteTinytex = () => invoke<void>("delete_tinytex");
export const tlmgrInstalled = () => invoke<string[]>("tlmgr_installed");
export const tlmgrInstall = (packages: string[]) => invoke<string>("tlmgr_install", { packages });
export const tlmgrRemove = (packages: string[]) => invoke<string>("tlmgr_remove", { packages });
export const compileTagged = (projectId: string, mainDoc: string) =>
  invoke<TaggedCompileResult>("compile_tagged", { projectId, mainDoc });

// --- Citation lookup (auto-citation) ---

export const fetchDoiBibtex = (doi: string) => invoke<string>("fetch_doi_bibtex", { doi });
export const fetchArxiv = (id: string) => invoke<string>("fetch_arxiv", { id });
export const literatureArxivLookup = (arxivId: string) =>
  invoke<string>("literature_arxiv_lookup", { arxivId });
export const crossrefSearch = (query: string) => invoke<string>("crossref_search", { query });
export const literatureSearch = (
  source: string,
  query: string,
  options: {
    limit?: number;
    yearFrom?: number | null;
    yearTo?: number | null;
    openAccessOnly?: boolean;
  } = {},
) =>
  invoke<string>("literature_search", {
    source,
    query,
    limit: options.limit ?? 12,
    yearFrom: options.yearFrom ?? null,
    yearTo: options.yearTo ?? null,
    openAccessOnly: options.openAccessOnly ?? false,
  });
export const getConnectorKey = (connectorId: string) =>
  invoke<string | null>("get_connector_key", { connectorId });
export const setConnectorKey = (connectorId: string, value: string) =>
  invoke<void>("set_connector_key", { connectorId, value });


export const searchDocs = (query: string) =>
  invoke<SearchHit[]>("search_docs", { query });

// Used by the AI assistant, which must not surface other projects' contents
// to the model.
export const searchProject = (projectId: string, query: string) =>
  invoke<SearchHit[]>("search_project", { projectId, query });



export const getConfig = () => invoke<AppConfig>("get_config");
export const setConfig = (config: AppConfig) =>
  invoke<void>("set_config", { config });

// --- MCP server (token only via mcp_connection_info while running) ---



export const mcpStatus = () => invoke<McpStatus>("mcp_status");
export const mcpSetEnabled = (enabled: boolean) =>
  invoke<McpStatus>("mcp_set_enabled", { enabled });
export const mcpRestartServer = () => invoke<McpStatus>("mcp_restart_server");
export const mcpConnectionInfo = () => invoke<McpConnectionInfo>("mcp_connection_info");
export const mcpRegenerateToken = () => invoke<void>("mcp_regenerate_token");
let activeMcpRendererSession: number | null = null;
let mcpRendererBeginSequence = 0;
export const mcpBeginRendererSession = async () => {
  const beginSequence = ++mcpRendererBeginSequence;
  const rendererSession = await invoke<number>("mcp_begin_renderer_session");
  if (!Number.isSafeInteger(rendererSession) || rendererSession <= 0) {
    throw new Error("The MCP backend returned an invalid renderer session");
  }
  if (beginSequence === mcpRendererBeginSequence) {
    activeMcpRendererSession = rendererSession;
  }
  return rendererSession;
};
export const mcpRendererHeartbeat = (rendererSession: number) =>
  invoke<void>("mcp_renderer_heartbeat", { rendererSession });
export const mcpEndRendererSession = async (rendererSession: number) => {
  await invoke<void>("mcp_end_renderer_session", { rendererSession });
  if (activeMcpRendererSession === rendererSession) {
    activeMcpRendererSession = null;
  }
};
export const mcpRegisterTools = (
  tools: { name: string; description: string; inputSchema: unknown }[],
  rendererSession: number,
) => invoke<void>("mcp_register_tools", { tools, rendererSession });
export const REDACTED_MARKER = "__stored__";
export const redactedSecretMarker = () => invoke<string>("redacted_secret_marker");


export const agentListModels = (args: {
  providerId: string;
  key?: string;
  baseURL?: string;
}) =>
  invoke<ProviderModel[]>("agent_list_models", {
    providerId: args.providerId,
    key: args.key ?? null,
    baseUrl: args.baseURL ?? null,
  });

export const mcpSetActiveProject = (projectId: string | null) => {
  if (activeMcpRendererSession === null) {
    return Promise.reject(new Error("The MCP renderer session is not ready"));
  }
  return invoke<void>("mcp_set_active_project", {
    projectId,
    rendererSession: activeMcpRendererSession,
  });
};
export const mcpToolResult = (
  callId: number,
  result: unknown,
  rendererSession: number,
) => invoke<void>("mcp_tool_result", { callId, result, rendererSession });

// --- GitHub (token stays in the Rust core; these never take/return it) ---



export const ghCurrentUser = () => invoke<GitHubUser>("gh_current_user");
export const ghSetToken = (token: string) =>
  invoke<GitHubUser>("gh_set_token", { token });
export const ghClearToken = () => invoke<void>("gh_clear_token");
export const ghListRepos = () => invoke<GitHubRepo[]>("gh_list_repos");
export const ghCreateRepo = (name: string, isPrivate: boolean) =>
  invoke<GitHubRepo>("gh_create_repo", { name, private: isPrivate });

export const gitSetRemote = (projectId: string, url: string) =>
  invoke<void>("git_set_remote", { projectId, url });
export const gitRemoveRemote = (projectId: string) =>
  invoke<void>("git_remove_remote", { projectId });
export const gitGetRemote = (projectId: string) =>
  invoke<string | null>("git_get_remote", { projectId });
export const gitCurrentBranch = (projectId: string) =>
  invoke<string>("git_current_branch", { projectId });


export const gitAheadBehind = (projectId: string) =>
  invoke<AheadBehind>("git_ahead_behind", { projectId });

export const gitPush = (projectId: string) =>
  invoke<string>("git_push", { projectId });
export const gitPull = (projectId: string, expectedGeneration: number) =>
  invoke<GitPullResult>("git_pull", { projectId, expectedGeneration });


export const gitStatus = (projectId: string) =>
  invoke<GitFileChange[]>("git_status", { projectId });

export const gitDiff = (projectId: string, path?: string, staged = false) =>
  invoke<string>("git_diff", { projectId, path: path ?? null, staged });

export const gitDiscard = (projectId: string, path: string, expectedGeneration: number) =>
  invoke<ProjectStateChanged>("git_discard", { projectId, path, expectedGeneration });

export const gitHeadOid = (projectId: string) =>
  invoke<string | null>("git_head_oid", { projectId });

export const gitStage = (projectId: string, path: string) =>
  invoke<void>("git_stage", { projectId, path });

export const gitUnstage = (projectId: string, path: string) =>
  invoke<void>("git_unstage", { projectId, path });

export const gitStageAll = (projectId: string) =>
  invoke<void>("git_stage_all", { projectId });

export const gitUnstageAll = (projectId: string) =>
  invoke<void>("git_unstage_all", { projectId });

// Commits the staged index only. Returns false when nothing is staged.
export const gitCommit = (projectId: string, message: string) =>
  invoke<boolean>("git_commit", { projectId, message });

// rev = "HEAD" (last commit) or "INDEX" (staged).
export const gitShow = (projectId: string, rev: "HEAD" | "INDEX", path: string) =>
  invoke<string>("git_show", { projectId, rev, path });

export const downloadProjectZip = (projectId: string, dest: string) =>
  invoke<void>("download_project_zip", { projectId, dest });

export const duplicateProject = (projectId: string, newName: string) =>
  invoke<string>("duplicate_project", { projectId, newName });

export const clearBuildCache = (projectId: string) =>
  invoke<void>("clear_build_cache", { projectId });

export const deleteProject = (projectId: string) =>
  invoke<void>("delete_project", { projectId });

export const libraryRoot = () => invoke<string>("library_root");
export const appVersion = () => invoke<string>("app_version");

export function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  // Build the binary string in chunks: a per-byte string concat freezes the UI
  // on multi-MB buffers (large PDFs). fromCharCode.apply over 32KB subarrays is
  // well under the argument-count limit and avoids the O(n^2) concat.
  const CHUNK = 0x8000;
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(s);
}



export const synctexForward = (
  projectId: string,
  mainDoc: string,
  file: string,
  line: number
) =>
  invoke<SynctexRect | null>("synctex_forward", {
    projectId,
    mainDoc,
    file,
    line,
  });

export const synctexInverse = (
  projectId: string,
  mainDoc: string,
  page: number,
  x: number,
  y: number
) =>
  invoke<SynctexHit | null>("synctex_inverse", {
    projectId,
    mainDoc,
    page,
    x,
    y,
  });

export const synctexMapLine = (
  compiledSource: string,
  currentSource: string,
  line: number,
  currentToCompiled: boolean,
) =>
  invoke<number | null>("synctex_map_line", {
    compiledSource,
    currentSource,
    line,
    currentToCompiled,
  });
