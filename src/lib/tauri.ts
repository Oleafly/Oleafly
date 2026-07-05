import { invoke } from "@tauri-apps/api/core";

export interface CompileError {
  line: number | null;
  file: string | null;
  message: string;
  kind: string;
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

/** Fetch the last-compiled PDF as raw bytes (ArrayBuffer over IPC, no base64). */
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
}

export interface ProjectInfo {
  id: string;
  name: string;
  main_doc: string;
  updated_at: number;
}

export const compileProject = (projectId: string, mainDoc: string, offline = false) =>
  invoke<CompileResult>("compile_project", { projectId, mainDoc, offline });

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

export const setMainDocCmd = (projectId: string, mainDoc: string) =>
  invoke<ProjectMeta>("set_main_doc", { projectId, mainDoc });

export const getProject = (projectId: string) =>
  invoke<ProjectMeta>("get_project", { projectId });

export const listProjects = () => invoke<ProjectInfo[]>("list_projects");

export const createProject = (name: string) =>
  invoke<string>("create_project", { name });

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export const listTemplates = () => invoke<TemplateInfo[]>("list_templates");

export const createProjectFromTemplate = (name: string, templateId: string) =>
  invoke<string>("create_project_from_template", { name, templateId });

export interface GitCommit {
  oid: string;
  short: string;
  time: number;
  message: string;
}

export const gitAutoCommit = (projectId: string, message: string) =>
  invoke<boolean>("git_auto_commit", { projectId, message });

export const gitLog = (projectId: string) =>
  invoke<GitCommit[]>("git_log", { projectId });

export const gitRestore = (projectId: string, oid: string) =>
  invoke<void>("git_restore", { projectId, oid });

export const exportPdf = (projectId: string, mainDoc: string, dest: string) =>
  invoke<void>("export_pdf", { projectId, mainDoc, dest });

export const exportDocument = (projectId: string, mainDoc: string, format: string, dest: string) =>
  invoke<void>("export_document", { projectId, mainDoc, format, dest });

export interface SearchHit {
  project_id: string;
  project_name: string;
  path: string;
  line: number;
  preview: string;
}

export const searchDocs = (query: string) =>
  invoke<SearchHit[]>("search_docs", { query });

/** Search only the given project (used by the AI assistant, which must not
 *  surface other projects' contents to the model). */
export const searchProject = (projectId: string, query: string) =>
  invoke<SearchHit[]>("search_project", { projectId, query });

export interface AppConfig {
  /** Always empty when read via `get_config` - the token never leaves the Rust
   *  core. Use `github_connected` for presence; set it via `ghSetToken`. */
  github_token: string;
  github_user: string;
  /** Whether a GitHub token is stored (derived; set by `get_config`). */
  github_connected: boolean;
  ai_api_key: string;
  ai_provider: string;
  ai_model: string;
  /** provider id -> API key (or host URL for Ollama). */
  ai_keys: Record<string, string>;
}

export const getConfig = () => invoke<AppConfig>("get_config");
export const setConfig = (config: AppConfig) =>
  invoke<void>("set_config", { config });

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
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
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
