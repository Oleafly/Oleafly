import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const reloadViews = () => invoke<void>("reload_views");

export const focusCurrentWindow = async () => {
  const window = getCurrentWindow();
  await window.setFocus();
};

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
  log: string;
  errors: CompileError[];
  synctex_path: string | null;
  out_dir: string | null;
  compile_time_ms: number;
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
  compiler_prerequisite: "pandoc" | null;
}
export type EngineFeature = "citations" | "document_index";

export interface DocumentEngineDescriptor {
  id: DocumentEngineId;
  label: string;
  source_format: "latex" | "typst" | "markdown" | "unknown";
  main_document: string;
  source_extensions: string[];
  capabilities: EngineCapabilities;
}

export type DocumentEngineId = "latex" | "typst" | "markdown" | "unknown";

export const getProjectEngine = (projectId: string) =>
  invoke<DocumentEngineDescriptor>("project_engine", { projectId });

export const readCompiledPdf = (projectId: string) =>
  invoke<ArrayBuffer>("read_compiled_pdf", { projectId });

export const compileTex = (
  projectId: string,
  mainDoc: string,
  source: string
) => invoke<CompileResult>("compile_tex", { projectId, mainDoc, source });

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
}

export const compileProject = (projectId: string, mainDoc: string, offline = false) =>
  invoke<CompileResult>("compile_project", { projectId, mainDoc, offline });

// Runs in a separate build dir from the main project compile.
export const compileIsolated = (projectId: string, source: string, offline = false) =>
  invoke<CompileResult>("compile_isolated", { projectId, source, offline });

export const readIsolatedPdf = (projectId: string) =>
  invoke<ArrayBuffer>("read_isolated_pdf", { projectId });

export const readProjectBytes = (projectId: string, relPath: string) =>
  invoke<ArrayBuffer>("read_project_bytes", { projectId, relPath });

export const writeProjectBytes = (projectId: string, relPath: string, dataBase64: string) =>
  invoke<void>("write_project_bytes", { projectId, relPath, dataBase64 });

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
  content: string
) => invoke<void>("write_file", { projectId, path, content });

export const createFile = (projectId: string, path: string, isDir: boolean) =>
  invoke<void>("create_file", { projectId, path, isDir });

export const deleteFile = (projectId: string, path: string) =>
  invoke<void>("delete_file", { projectId, path });

export const renameFile = (projectId: string, from: string, to: string) =>
  invoke<void>("rename_file", { projectId, from, to });

export const copyFile = (projectId: string, from: string, to: string) =>
  invoke<void>("copy_file", { projectId, from, to });

export const saveFileBase64 = (projectId: string, path: string, data: string) =>
  invoke<void>("save_file_base64", { projectId, path, data });

export const readFileBase64 = (projectId: string, path: string) =>
  invoke<string>("read_file_base64", { projectId, path });

export const appendAppLog = (message: string) =>
  invoke<void>("append_app_log", { message });

export const readAppLog = (maxBytes: number) =>
  invoke<string>("read_app_log", { maxBytes });

export const setMainDocCmd = (projectId: string, mainDoc: string) =>
  invoke<ProjectMeta>("set_main_doc", { projectId, mainDoc });

export const renameProjectCmd = (projectId: string, name: string) =>
  invoke<ProjectMeta>("rename_project", { projectId, name });

// No-op in release builds; only opens devtools in dev.
export const openDevtools = () => invoke<void>("open_devtools");

export const getProject = (projectId: string) =>
  invoke<ProjectMeta>("get_project", { projectId });

export const listProjects = () => invoke<ProjectInfo[]>("list_projects");

export const createProject = (name: string) =>
  invoke<string>("create_project", { name });

export const createTypstProject = (name: string) =>
  invoke<string>("create_typst_project", { name });

export const createMarkdownProject = (name: string) =>
  invoke<string>("create_markdown_project", { name });

export const createImageProject = (name: string, source: string, color?: string) =>
  invoke<string>("create_image_project", { name, source, color });

export interface TemplateLicense {
  spdx: string;
  author: string;
  url: string;
}

export interface TemplateRequires {
  packages: string[];
  fonts: string[];
  engine: string; // "tectonic" | "luatex"
}

export type AtsProfile = "friendly" | "design-forward" | null;

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  engine: string; // "xetex" | "luatex"
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
}

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

// Emitted on the "asset-progress" event while a font pack downloads.
export interface AssetProgress {
  component: string;
  label: string;
  file: string;
  index: number;
  total: number;
  received: number;
  file_total: number | null;
}

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

export interface GitCommit {
  oid: string;
  short: string;
  time: number;
  message: string;
}

export const gitAutoCommit = (projectId: string, message: string) =>
  invoke<boolean>("git_auto_commit", { projectId, message });

export const gitAutoCommitUpdate = (projectId: string) =>
  invoke<boolean>("git_auto_commit_update", { projectId });

export const gitLog = (projectId: string) =>
  invoke<GitCommit[]>("git_log", { projectId });

export const gitRestore = (projectId: string, oid: string) =>
  invoke<void>("git_restore", { projectId, oid });

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

export interface EngineInfo {
  kind: "system" | "tinytex" | "none";
  lualatex: string | null;
  tlmgr: string | null;
  version: string | null;
}

export interface TaggedCompileResult {
  success: boolean;
  has_pdf: boolean;
  log: string;
}

export const latexEngineInfo = () => invoke<EngineInfo>("latex_engine_info");
export const hasTaggingEngine = () => invoke<boolean>("has_tagging_engine");
// Emits `tinytex-download-progress` events while downloading.
export const installTinytex = () => invoke<EngineInfo>("install_tinytex");
export const deleteTinytex = () => invoke<void>("delete_tinytex");
export const tlmgrInstalled = () => invoke<string[]>("tlmgr_installed");
export const tlmgrInstall = (packages: string[]) => invoke<string>("tlmgr_install", { packages });
export const tlmgrRemove = (packages: string[]) => invoke<string>("tlmgr_remove", { packages });
export const compileTagged = (projectId: string, mainDoc: string) =>
  invoke<TaggedCompileResult>("compile_tagged", { projectId, mainDoc });

// --- Citation lookup (auto-citation) ---

export const fetchDoiBibtex = (doi: string) => invoke<string>("fetch_doi_bibtex", { doi });
export const fetchArxiv = (id: string) => invoke<string>("fetch_arxiv", { id });
export const crossrefSearch = (query: string) => invoke<string>("crossref_search", { query });

export interface SearchHit {
  project_id: string;
  project_name: string;
  path: string;
  line: number;
  preview: string;
}

export const searchDocs = (query: string) =>
  invoke<SearchHit[]>("search_docs", { query });

// Used by the AI assistant, which must not surface other projects' contents
// to the model.
export const searchProject = (projectId: string, query: string) =>
  invoke<SearchHit[]>("search_project", { projectId, query });

export interface AppConfig {
  // Always empty when read via `get_config` - the token never leaves the
  // Rust core. Use `github_connected` for presence; set it via `ghSetToken`.
  github_token: string;
  github_user: string;
  github_connected: boolean;
  ai_api_key: string;
  ai_provider: string;
  ai_model: string;
  // provider id -> API key (or host URL for Ollama).
  ai_keys: Record<string, string>;
  // User-authored extra instructions, sandboxed into the AI system prompt.
  ai_system_prompt: string;
  ai_pdf_capture: boolean;
  mcp_enabled: boolean;
  mcp_port: number;
  mcp_read_only: boolean;
  // "ask" (confirm every change), "auto_writes" (auto-approve edits, still
  // confirm deletes), or "trust" (never prompt in Oleafly; rely on the MCP
  // client's own approval, deletes included).
  mcp_approval_policy: string;
}

export const getConfig = () => invoke<AppConfig>("get_config");
export const setConfig = (config: AppConfig) =>
  invoke<void>("set_config", { config });

// --- MCP server (token only via mcp_connection_info while running) ---

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

export const mcpStatus = () => invoke<McpStatus>("mcp_status");
export const mcpSetEnabled = (enabled: boolean) =>
  invoke<McpStatus>("mcp_set_enabled", { enabled });
export const mcpRestartServer = () => invoke<McpStatus>("mcp_restart_server");
export const mcpConnectionInfo = () => invoke<McpConnectionInfo>("mcp_connection_info");
export const mcpRegenerateToken = () => invoke<void>("mcp_regenerate_token");
export const mcpRegisterTools = (
  tools: { name: string; description: string; inputSchema: unknown }[],
) => invoke<void>("mcp_register_tools", { tools });
export const mcpToolResult = (callId: number, result: unknown) =>
  invoke<void>("mcp_tool_result", { callId, result });

// --- GitHub (token stays in the Rust core; these never take/return it) ---

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

export interface AheadBehind {
  ahead: number;
  behind: number;
  has_upstream: boolean;
}

export const gitAheadBehind = (projectId: string) =>
  invoke<AheadBehind>("git_ahead_behind", { projectId });

export const gitPush = (projectId: string) =>
  invoke<string>("git_push", { projectId });
export const gitPull = (projectId: string) =>
  invoke<string>("git_pull", { projectId });

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
}

export const gitStatus = (projectId: string) =>
  invoke<GitFileChange[]>("git_status", { projectId });

export const gitDiff = (projectId: string, path?: string, staged = false) =>
  invoke<string>("git_diff", { projectId, path: path ?? null, staged });

export const gitDiscard = (projectId: string, path: string) =>
  invoke<void>("git_discard", { projectId, path });

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
