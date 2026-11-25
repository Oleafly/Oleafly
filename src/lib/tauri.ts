import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { receiveChunkedText } from "@/lib/chunked-ipc";
import { createEmitter } from "@/lib/emitter";
import { errorStartsWith } from "@/lib/error-prefix";
import type { FolderDetection, OpenedFolder } from "@/lib/folder-detection";
import type { SearchMode } from "@/lib/search-modes";

import type {
  AheadBehind,
  AppConfig,
  AssetProgress,
  BackendProtocolInfo,
  CheckpointFileSummary,
  PdfSyncStatus,
  CheckpointIntegrity,
  CheckpointPublicationOutcome,
  CheckpointStoreInspection,
  CheckpointStoreStats,
  CheckpointSummary,
  CompileResult,
  ComponentInfo,
  CopyFileResult,
  CreateFileResult,
  DictionaryBytes,
  DictionaryInfo,
  DiscordCommunityStats,
  DocumentEngineDescriptor,
  DocumentStatsRequest,
  DocumentStatsResult,
  EngineInfo,
  EngineRescan,
  FigureCacheResult,
  FileConflictStrategy,
  FileEntry,
  FileTreeListing,
  FileMutationResult,
  GitCommit,
  GitWorktreeOperationResult,
  GitFileChange,
  GitWorkspaceSnapshot,
  ForgeAccount,
  ForgeAccountCheck,
  ForgeDevicePoll,
  ForgeDeviceStart,
  ForgeKind,
  ForgeRepo,
  ForgeRepoPage,
  ForgeServerInfo,
  GitHubRepoStats,
  GitPullResult,
  GitPublishPreflight,
  GitPublishPrepared,
  ImportPathsResult,
  InitialState,
  PendingOpenRequest,
  LibraryStorageSummary,
  ManifestHome,
  PackIndexInfo,
  PackInfo,
  Prerequisite,
  ProjectAvailability,
  ProjectAvailabilityReport,
  ProjectInfo,
  ProjectMeta,
  ProjectSourcesRequest,
  ProjectSourcesResult,
  ProjectStateChanged,
  RecycledProjectInfo,
  RenameFileResult,
  SearchHit,
  SynctexHit,
  SynctexForwardHit,
  TaggedCompileResult,
  TemplateInfo,
  TexDistribution,
  TexFlavor,
  TexSpec,
  TexStatus,
  TinytexInstallState,
  TypstSource,
  ValidatedCompileFingerprint,
  ZoteroAccount,
  ZoteroConnectionReport,
  ZoteroExportedEntry,
  ZoteroExportStyle,
  ZoteroHit,
  ZoteroItemRef,
  ZoteroKeysReply,
  ZoteroLibraryExport,
  ZoteroLibraryStatus,
  ZoteroProjectLink,
  ZoteroSearchReply,
} from "@oleafly/backend-port";
import type { LoginItemState } from "@/lib/background-helper";
export type * from "@oleafly/backend-port";

export type BrowserCookieSourceId =
  | "chrome"
  | "brave"
  | "edge"
  | "firefox"
  | "safari";

export type BrowserCookieSourceStatus =
  | "available"
  | "no_cookie_store"
  | "not_installed"
  | "coming_soon";

export interface BrowserCookieSource {
  browser: BrowserCookieSourceId;
  browserName: string;
  profile: string | null;
  profileName: string | null;
  status: BrowserCookieSourceStatus;
  detail: string;
}

export interface BrowserCookieImportRequest {
  browser: BrowserCookieSourceId;
  profile: string;
  domain: string | null;
}

export interface BrowserCookieImportSummary {
  imported: number;
  browserName: string;
  profileName: string;
  domain: string | null;
}

export const reloadViews = () => invoke<void>("reload_views");

export const detectBrowserCookieSources = () =>
  invoke<BrowserCookieSource[]>("detect_browser_cookie_sources");

export const importBrowserCookies = (request: BrowserCookieImportRequest) =>
  invoke<BrowserCookieImportSummary>("import_browser_cookies", {
    request: { ...request, confirmed: true },
  });

export const focusCurrentWindow = async () => {
  const window = getCurrentWindow();
  await window.setFocus();
};

export const getProjectEngine = (projectId: string, root?: string) =>
  invoke<DocumentEngineDescriptor>("project_engine", root === undefined ? { projectId } : { projectId, root });

export const readCompiledPdf = (projectId: string) =>
  invoke<ArrayBuffer>("read_compiled_pdf", { projectId });

export function isMissingCompiledPdf(error: unknown): boolean {
  return errorStartsWith(error, "no compiled PDF");
}

export const readBuildArtifact = (projectId: string, name: string) =>
  invoke<string | null>("read_build_artifact", { projectId, name });

export const projectHtmlPreviewUrl = (projectId: string, path: string) =>
  invoke<string>("project_html_preview_url", { projectId, path });

export const validateCompileFingerprint = (projectId: string, mainDoc: string) =>
  invoke<ValidatedCompileFingerprint | null>("validate_compile_fingerprint", {
    projectId,
    mainDoc,
  });

export const recordProjectTexSpec = (projectId: string) =>
  invoke<TexSpec | null>("record_project_tex_spec", { projectId });

export const importOverleafProjectCmd = (path: string, name?: string) =>
  invoke<string>("import_overleaf_project", { path, name: name ?? null });

export const projectTexStatus = (projectId: string) =>
  invoke<TexStatus | null>("project_tex_status", { projectId });

export const compileProject = (
  projectId: string,
  mainDoc: string,
  offline = false,
  fast = false,
  haltOnError = false,
  typstVariant: string | null = null,
) =>
  invoke<CompileResult>("compile_project", {
    projectId,
    mainDoc,
    offline,
    fast,
    haltOnError,
    typstVariant,
  });

export const checkpointList = (projectId: string) =>
  invoke<CheckpointSummary[]>("checkpoint_list", { projectId });

export const checkpointSetLabel = (projectId: string, snapshotRoot: string, label: string) =>
  invoke<CheckpointSummary>("checkpoint_set_label", { projectId, snapshotRoot, label });

export const checkpointFiles = (projectId: string, snapshotRoot: string) =>
  invoke<CheckpointFileSummary[]>("checkpoint_files", { projectId, snapshotRoot });

export const checkpointSaveFile = (projectId: string, snapshotRoot: string, path: string, dest: string) =>
  invoke<void>("checkpoint_save_file", { projectId, snapshotRoot, path, dest });

export const checkpointReadText = (projectId: string, snapshotRoot: string, path: string) =>
  invoke<string>("checkpoint_read_text", { projectId, snapshotRoot, path });

export const checkpointSave = (projectId: string, text?: string) =>
  invoke<CheckpointPublicationOutcome>("checkpoint_save", { projectId, text: text ?? null });

export const pdfSyncStatus = (projectId: string) =>
  invoke<PdfSyncStatus>("pdf_sync_status", { projectId });

export const pdfSyncSet = (projectId: string, enabled: boolean, outputId: string | null) =>
  invoke<PdfSyncStatus>("pdf_sync_set", { projectId, enabled, outputId });

export const pdfSyncNoteSaved = (projectId: string, path: string) =>
  invoke<void>("pdf_sync_note_saved", { projectId, path });

export type PdfAnnotationKind = "comment" | "delete" | "replace" | "insert" | "region";

export type PdfAnnotationOrigin = "pdf" | "review" | "aiReview";

export type PdfAnnotationStatus = "draft" | "sent" | "addressed" | "resolved";

export type PdfAnnotationPlacement = "placed" | "needsPlacing";

export interface PdfAnnotationQuote {
  text: string;
  before: string;
  after: string;
}

export interface PdfAnnotationSource {
  path: string;
  startLine: number;
  endLine: number;
  excerpt: string;
}

export interface PdfAnnotationBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfAnnotation {
  id: string;
  number: number;
  kind: PdfAnnotationKind;
  comment: string;
  quote: PdfAnnotationQuote;
  page: number;
  source: PdfAnnotationSource | null;
  boxes: PdfAnnotationBox[];
  build: string | null;
  origin: PdfAnnotationOrigin;
  status: PdfAnnotationStatus;
  placement: PdfAnnotationPlacement;
  createdAt: number;
  updatedAt: number;
}

export interface PdfAnnotationList {
  items: PdfAnnotation[];
  readOnly: boolean;
  setAside: boolean;
}

export interface NewPdfAnnotation {
  kind: PdfAnnotationKind;
  comment: string;
  quote: PdfAnnotationQuote;
  page: number;
  source: PdfAnnotationSource | null;
  boxes: PdfAnnotationBox[];
  build: string | null;
  origin: PdfAnnotationOrigin;
}

export interface PdfAnnotationUpdate {
  id: string;
  expectedUpdatedAt?: number;
  comment?: string;
  kind?: PdfAnnotationKind;
  status?: PdfAnnotationStatus;
  placement?: PdfAnnotationPlacement;
  quote?: PdfAnnotationQuote;
  page?: number;
  source?: PdfAnnotationSource | null;
  boxes?: PdfAnnotationBox[];
  build?: string | null;
}

export const pdfAnnotationsList = (projectId: string) =>
  invoke<PdfAnnotationList>("pdf_annotations_list", { projectId });

export const pdfAnnotationsAdd = (projectId: string, annotation: NewPdfAnnotation) =>
  invoke<PdfAnnotation>("pdf_annotations_add", { projectId, annotation });

export const pdfAnnotationsUpdate = (projectId: string, updates: PdfAnnotationUpdate[]) =>
  invoke<PdfAnnotation[]>("pdf_annotations_update", { projectId, updates });

export const pdfAnnotationsDelete = (projectId: string, ids: string[]) =>
  invoke<PdfAnnotation[]>("pdf_annotations_delete", { projectId, ids });

export const checkpointInspect = (projectId: string) =>
  invoke<CheckpointStoreInspection>("checkpoint_inspect", { projectId });

export const checkpointRevealStore = (projectId: string) =>
  invoke<void>("checkpoint_reveal_store", { projectId });

export const checkpointStats = (projectId: string) =>
  invoke<CheckpointStoreStats>("checkpoint_stats", { projectId });

export const checkpointRestore = (
  projectId: string,
  snapshotRoot: string,
  expectedGeneration: number,
) =>
  invoke<ProjectStateChanged>("checkpoint_restore", {
    projectId,
    snapshotRoot,
    expectedGeneration,
  });

export const checkpointDelete = (projectId: string, snapshotRoot: string) =>
  invoke<void>("checkpoint_delete", { projectId, snapshotRoot });

export const checkpointKeepLatest = (projectId: string) =>
  invoke<void>("checkpoint_keep_latest", { projectId });

export const checkpointReset = (projectId: string) =>
  invoke<void>("checkpoint_reset", { projectId });

export const checkpointVerify = (projectId: string) =>
  invoke<CheckpointIntegrity>("checkpoint_verify", { projectId });

export const checkpointExport = (projectId: string, dest: string, password: string) =>
  invoke<void>("checkpoint_export", { projectId, dest, password });

export const checkpointImport = (projectId: string, source: string, password: string) =>
  invoke<void>("checkpoint_import", { projectId, source, password });

export const cancelCompile = () => invoke<boolean>("cancel_compile", {});

export const clearBuildDir = (projectId: string) =>
  invoke<void>("clear_build_dir", { projectId });

export const compileIsolated = (projectId: string, source: string, offline = false) =>
  invoke<CompileResult>("compile_isolated", { projectId, source, offline });

export const cancelIsolatedCompile = () => invoke<boolean>("cancel_isolated_compile", {});

export const readIsolatedPdf = (projectId: string) =>
  invoke<ArrayBuffer>("read_isolated_pdf", { projectId });

export const readProjectBytes = (projectId: string, relPath: string) =>
  invoke<ArrayBuffer>("read_project_bytes", { projectId, relPath });

export const readNoteFile = (projectId: string, path: string) =>
  invoke<ArrayBuffer>("read_note_file", { projectId, relPath: path });

export const projectFileSizes = (projectId: string, paths: readonly string[]) =>
  invoke<Record<string, number>>("project_file_sizes", { projectId, paths });

export const projectMutationGeneration = (projectId: string) =>
  invoke<number>("project_mutation_generation", { projectId });

const projectWriteFailed = createEmitter<[projectId: string]>();

export const onProjectWriteFailure = projectWriteFailed.subscribe;

async function projectWrite<T>(projectId: string, request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    projectWriteFailed.emit(projectId);
    throw error;
  }
}

export const writeProjectBytes = (
  projectId: string,
  relPath: string,
  dataBase64: string,
  expectedGeneration?: number,
) =>
  projectWrite(
    projectId,
    invoke<FileMutationResult>("write_project_bytes", {
      projectId,
      relPath,
      dataBase64,
      expectedGeneration,
    }),
  );

export const writeBytesFile = (dest: string, dataBase64: string) =>
  invoke<void>("write_bytes_file", { dest, dataBase64 });

export const exportProjectImage = (projectId: string, dest: string, dataBase64: string) =>
  invoke<void>("export_project_image", { projectId, dest, dataBase64 });

export const listFiles = (projectId: string) =>
  invoke<FileEntry[]>("list_files", { projectId });

export const listFileTree = (projectId: string) =>
  invoke<FileTreeListing>("list_file_tree", { projectId });

export const existingProjectFiles = (projectId: string, paths: string[]) =>
  invoke<string[]>("existing_project_files", { projectId, paths });

export const watchProjectFolder = (projectId: string) =>
  invoke<number | null>("watch_project_folder", { projectId });

export const unwatchProjectFolder = (projectId: string, token: number) =>
  invoke<boolean>("unwatch_project_folder", { projectId, token });

export const readFileContent = (projectId: string, path: string, allowMissing = false) =>
  invoke<string>("read_file", { projectId, path, ...(allowMissing ? { allowMissing: true } : {}) });

export const readProjectSourcesBatch = (
  projectId: string,
  request: ProjectSourcesRequest,
) => invoke<ProjectSourcesResult>("read_project_sources", { projectId, request });

export const documentStats = (
  projectId: string,
  request: DocumentStatsRequest,
) => invoke<DocumentStatsResult>("document_stats", { projectId, request });

export const writeFileContent = (
  projectId: string,
  path: string,
  content: string,
  expectedGeneration?: number,
  expectedHash?: string,
) =>
  projectWrite(
    projectId,
    invoke<FileMutationResult>("write_file", {
      projectId,
      path,
      content,
      expectedGeneration,
      ...(expectedHash ? { expectedHash } : {}),
    }),
  );

export async function createFile(
  projectId: string,
  path: string,
  isDir: boolean,
  conflictStrategy: FileConflictStrategy = "error",
  expectedGeneration?: number,
): Promise<{ path: string; generation: number }> {
  const result = await projectWrite(
    projectId,
    invoke<CreateFileResult>("create_file", {
      projectId,
      path,
      isDir,
      conflictStrategy,
      expectedGeneration,
    }),
  );
  if (result.status === "conflict") throw new FileConflictError(result);
  return { path: result.path, generation: result.generation };
}

export const deleteFile = (
  projectId: string,
  path: string,
  expectedGeneration?: number,
  permanent?: boolean,
) =>
  projectWrite(
    projectId,
    invoke<FileMutationResult>("delete_file", {
      projectId,
      path,
      expectedGeneration,
      ...(permanent === undefined ? {} : { permanent }),
    }),
  );

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
  const result = await projectWrite(
    projectId,
    invoke<RenameFileResult>("rename_file", {
      projectId,
      from,
      to,
      conflictStrategy,
      expectedGeneration,
    }),
  );
  if (result.status === "conflict") throw new FileConflictError(result);
  return result.path;
}

export const copyFile = (
  projectId: string,
  from: string,
  to: string,
  expectedGeneration?: number,
) =>
  projectWrite(
    projectId,
    invoke<CopyFileResult>("copy_file", { projectId, from, to, expectedGeneration }),
  );

export const importPathsIntoProject = (
  projectId: string,
  destDir: string,
  sourcePaths: string[],
  expectedGeneration?: number,
) =>
  projectWrite(
    projectId,
    invoke<ImportPathsResult>("import_paths_into_project", {
      projectId,
      destDir,
      sourcePaths,
      expectedGeneration,
    }),
  );

export const takeDroppedPaths = () => invoke<string[]>("take_dropped_paths");

export const readDroppedFile = (path: string) => invoke<ArrayBuffer>("read_dropped_file", { path });

export const saveFileBase64 = (
  projectId: string,
  path: string,
  data: string,
  expectedGeneration?: number,
) =>
  projectWrite(
    projectId,
    invoke<FileMutationResult>("save_file_base64", { projectId, path, data, expectedGeneration }),
  );

export const readFileBase64 = (projectId: string, path: string) =>
  invoke<string>("read_file_base64", { projectId, path });
export const readPickedFileBase64 = (path: string) =>
  invoke<string>("read_picked_file_base64", { path });
export const pickTableImportFile = () => invoke<string | null>("pick_table_import_file");
export const registerPickedFileForE2E = (path: string) =>
  invoke<string>("register_picked_file_for_e2e", { path });

export interface FileDialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenPathOptions {
  title?: string;
  filters?: FileDialogFilter[];
  multiple?: boolean;
  directory?: boolean;
  defaultPath?: string;
  canCreateDirectories?: boolean;
}

export interface SavePathOptions {
  title?: string;
  filters?: FileDialogFilter[];
  defaultPath?: string;
  canCreateDirectories?: boolean;
}

export const pickOpenPaths = (options?: OpenPathOptions) =>
  invoke<string[] | null>("pick_open_paths", { options: options ?? null });
export const pickSaveDestination = (options?: SavePathOptions) =>
  invoke<string | null>("pick_save_path", { options: options ?? null });
export const grantTestOpenPaths = (paths: string[]) =>
  invoke<string[]>("grant_test_open_paths", { paths });
export const grantTestSavePath = (path: string) =>
  invoke<string>("grant_test_save_path", { path });

export interface AdHocArtifact {
  path: string;
  dataBase64: string;
}

export interface AdHocConversionRequest {
  source: "latex" | "markdown" | "typst" | "html" | "docx" | "equation" | "ocr-markdown" | "ocr-fragment" | "markdown-fragment" | "markdown-note";
  target: "latex" | "markdown" | "typst" | "html" | "docx";
  text?: string;
  dataBase64?: string;
  report?: boolean;
  check?: boolean;
  files?: AdHocArtifact[];
}

export interface AdHocCheckDiagnostic {
  severity: "error" | "warning";
  message: string;
  line: number | null;
}

export interface AdHocCheck {
  ok: boolean;
  diagnostics: AdHocCheckDiagnostic[];
}

export interface AdHocConversionResult {
  kind: "text" | "binary";
  text: string | null;
  dataBase64: string | null;
  fileName: string;
  mediaType: string;
  files: AdHocArtifact[];
  report?: string[];
  check?: AdHocCheck;
}

export const convertAdHoc = (request: AdHocConversionRequest) =>
  invoke<AdHocConversionResult>("convert_ad_hoc", { request });

export type TypstSnippetFormat = "svg" | "png";

export interface TypstSnippetRequest {
  source: string;
  format: TypstSnippetFormat;
  ppi?: number;
  projectId?: string;
  document?: boolean;
  offline?: boolean;
}

export interface TypstSnippetDiagnostic {
  severity: "error" | "warning";
  message: string;
  line: number | null;
  column: number | null;
}

export type TypstSnippetImage =
  | { format: "svg"; svg: string }
  | { format: "png"; pngBase64: string };

export type TypstSnippetRender =
  | { status: "rendered"; image: TypstSnippetImage; diagnostics: TypstSnippetDiagnostic[] }
  | { status: "failed"; diagnostics: TypstSnippetDiagnostic[] };

export const renderTypstSnippet = (request: TypstSnippetRequest) =>
  invoke<TypstSnippetRender>("render_typst_snippet", { request });

export const notesRenderTypst = (source: string) => invoke<string>("notes_render_typst", { source });
export const notesRenderTikz = (document: string) => invoke<string>("notes_render_tikz", { document });

export const artifactFrameOpen = (html: string) => invoke<string>("artifact_frame_open", { html });

export const artifactFrameClose = (token: string) => invoke<boolean>("artifact_frame_close", { token });

export const artifactFrameRuntimeUrl = () => invoke<string>("artifact_frame_runtime_url");

export const noteVideoFrameOrigin = () => invoke<string>("note_video_frame_origin");

export interface NoteLinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  favicon: string | null;
}

export const noteLinkPreview = (url: string) => invoke<NoteLinkPreview>("note_link_preview", { url });

export interface NoteXPost {
  url: string;
  id: string;
  author: string;
  handle: string;
  date: string;
  text: string;
}

export const noteXPost = (url: string) => invoke<NoteXPost>("note_x_post", { url });

export interface ArxivSourceRequest {
  arxivId?: string;
  dataBase64?: string;
}

export interface ArxivSourceResult {
  archiveName: string;
  mainFile: string;
  mainSource: string;
  files: AdHocArtifact[];
}

export const extractArxivSource = (request: ArxivSourceRequest) =>
  invoke<ArxivSourceResult>("extract_arxiv_source", { request });

export interface CreateAdHocProjectRequest {
  name: string;
  target: "latex" | "markdown" | "typst";
  text?: string;
  mainFile?: string;
  files: AdHocArtifact[];
}

export const createProjectFromAdHoc = (request: CreateAdHocProjectRequest) =>
  invoke<string>("create_project_from_ad_hoc", { request });

export const createProjectFromDocx = (name: string, dataBase64: string) =>
  invoke<string>("create_project_from_docx", { name, dataBase64 });

export const importDocument = (path: string, target?: ImportTarget) =>
  invoke<string>("import_document", { path, target: target ?? null });

export const appendAppLog = (message: string) =>
  invoke<void>("append_app_log", { message });

export const appIconSet = (variant: string) => invoke<void>("app_icon_set", { variant });

export const readAppLog = (maxBytes: number) =>
  invoke<string>("read_app_log", { maxBytes });

export const readAppLogChunked = (maxBytes: number) =>
  receiveChunkedText((channel) =>
    invoke<void>("read_app_log_chunked", { maxBytes, channel }),
  );

export type LogLevel = "info" | "warning" | "error";

export interface LogEntry {
  ts_ms: number;
  level: LogLevel;
  message: string;
  safe: unknown;
  sensitive: unknown;
}

export const readLogEntries = () => invoke<LogEntry[]>("read_log_entries");

export const clearLogs = () => invoke<void>("clear_logs");

export const revealAppLog = () => invoke<void>("reveal_app_log");

export const exportLogArchive = (dest: string) =>
  invoke<void>("export_log_archive", { dest, includeSensitive: false });

export const projectCompileFolder = (projectId: string, mainDoc: string) =>
  invoke<string | null>("project_compile_folder", { projectId, mainDoc });

export const setMainDocCmd = (projectId: string, mainDoc: string) =>
  invoke<ProjectMeta>("set_main_doc", { projectId, mainDoc });
export const mainDocumentCandidates = (projectId: string) =>
  invoke<FolderDetection>("main_document_candidates", { projectId });

export const setProjectEngineCmd = (
  projectId: string,
  engine: string,
  flavor: TexFlavor | null = null,
) => invoke<ProjectMeta>("set_project_engine", { projectId, engine, flavor });

export const setDefaultLatexEngineCmd = (engine: "tectonic" | "latexmk") =>
  invoke<void>("set_default_latex_engine", { engine });

export interface TypstSystemInstall {
  version: string;
  path: string;
}

export interface TypstVersionEntry {
  version: string;
  releasedAt: string | null;
  inCatalog: boolean;
  sources: TypstSource[];
  downloadBytes: number | null;
  tinymistVersion?: string | null;
}

export interface TypstToolchainStatus {
  bundledVersion: string;
  defaultVersion: string;
  defaultChoice: string | null;
  system: TypstSystemInstall | null;
  installing: string | null;
  versions: TypstVersionEntry[];
  unusedTinymist?: string[];
}

export type TypstInstallPhase = "downloading" | "verifying" | "extracting" | "done";

export interface TypstInstallProgress {
  version: string;
  phase: TypstInstallPhase;
  receivedBytes: number;
  totalBytes: number;
}

export const typstToolchainStatus = () =>
  invoke<TypstToolchainStatus>("typst_toolchain_status");

export async function installTypstVersion(
  version: string,
  onProgress: (progress: TypstInstallProgress) => void,
): Promise<TypstToolchainStatus> {
  const channel = new Channel<TypstInstallProgress>();
  channel.onmessage = onProgress;
  try {
    return await invoke<TypstToolchainStatus>("install_typst_version", {
      version,
      onProgress: channel,
    });
  } finally {
    channel.onmessage = () => {};
  }
}

export const removeTypstVersion = (version: string) =>
  invoke<TypstToolchainStatus>("remove_typst_version", { version });

export const removeUnusedTinymistDownloads = () =>
  invoke<TypstToolchainStatus>("remove_unused_tinymist_downloads");

export const setDefaultTypstVersion = (version: string | null) =>
  invoke<TypstToolchainStatus>("set_default_typst_version", { version });

export const setProjectTypstVersion = (projectId: string, version: string | null) =>
  invoke<ProjectMeta>("set_project_typst_version", { projectId, version });

export const setProjectDictionaryLocaleCmd = (
  projectId: string,
  locale: string | null,
) =>
  invoke<ProjectMeta>("set_project_dictionary_locale", { projectId, locale });

export const setProjectWritingSettingsCmd = (
  projectId: string,
  settings: Record<string, unknown> | null,
) =>
  invoke<ProjectMeta>("set_project_writing_settings", { projectId, settings });

export const resetProjectDictionaryLocaleOnDeviceCmd = (projectId: string) =>
  invoke<ProjectMeta>("reset_project_dictionary_locale_on_device", { projectId });

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

export const openDevtools = () => invoke<void>("open_devtools");

export const getProject = (projectId: string) =>
  invoke<ProjectMeta>("get_project", { projectId });

export const projectManifestHome = (projectId: string) =>
  invoke<ManifestHome>("project_manifest_home", { projectId });

export const saveProjectSettingsToFolder = (projectId: string) =>
  invoke<ProjectMeta>("save_project_settings_to_folder", { projectId });

export const listProjects = () => invoke<ProjectInfo[]>("list_projects");

export const probeProjectAvailability = (projectIds: string[]) =>
  invoke<ProjectAvailabilityReport[]>("probe_project_availability", { projectIds });

export const libraryStorageSummary = () =>
  invoke<LibraryStorageSummary>("library_storage_summary");

export const listRecycledProjects = () =>
  invoke<RecycledProjectInfo[]>("list_recycled_projects");

export const restoreRecycledProject = (recycleId: string) =>
  invoke<string>("restore_recycled_project", { recycleId });

export const permanentlyDeleteRecycledProject = (recycleId: string) =>
  invoke<void>("permanently_delete_recycled_project", { recycleId });

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

export const createDiagramProject = (name: string, source: string, language?: "tikz" | "typst" | "mermaid") =>
  invoke<string>("create_diagram_project", { name, source, language: language ?? null });

export const createNoteProject = (name: string, source: string, relatedProject?: string | null) =>
  invoke<string>("create_note_project", { name, source, relatedProject: relatedProject ?? null });

export type NotePropertyValue = string | number | boolean | null | (string | number | boolean | null)[];

export interface NoteFacts {
  id: string;
  noteId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  agent: string | null;
  tags: string[];
  aliases: string[];
  properties: Record<string, NotePropertyValue>;
  preview: string;
  relatedProject: string | null;
  updatedAt: number;
  knowledge: string;
  taskDigest: string;
}

export const noteFacts =(filter: { ids?: readonly string[]; relatedProject?: string } = {}) =>
  invoke<NoteFacts[]>("note_facts", { ids: filter.ids ?? null, relatedProject: filter.relatedProject ?? null });

export const releaseNoteCaches = () => invoke<void>("notes_release_caches");

export interface NoteLinkRecord {
  projectId: string;
  noteId: string | null;
  title: string;
  links: { kind: "note" | "project"; id: string; snippet: string; block?: string; line?: number }[];
  blocks?: string[];
}

export const noteLinks = (ids?: readonly string[]) => invoke<NoteLinkRecord[]>("note_links", { ids: ids ?? null });

export interface NoteSearchSnippet {
  text: string;
  ranges: [number, number][];
}

export type { SearchMode } from "@/lib/search-modes";

export interface TextTerm {
  kind: "text" | "path" | "ext" | "project";
  value: string;
}

export interface TextBranch {
  all: TextTerm[];
  none: TextTerm[];
}

export interface TextQuery {
  branches: TextBranch[];
  mode: SearchMode;
  limit?: number;
}

export type TextSearchHit = SearchHit & { ranges: [number, number][] };

export const textSearch = (projectId: string | null, query: TextQuery) =>
  invoke<TextSearchHit[]>("text_search", { projectId, query });

export interface NoteSearchOptions {
  mode?: SearchMode;
  blocks?: boolean;
}

export interface NoteBlockHit {
  line: number;
  block?: string;
  kind: "paragraph" | "item" | "row" | "heading" | "quote" | "code";
  text: string;
  ranges: [number, number][];
}

export interface NoteSearchHit {
  id: string;
  noteId: string | null;
  title: string;
  titleRanges: [number, number][];
  score: number;
  snippets: NoteSearchSnippet[];
  tags: string[];
  aliases: string[];
  relatedProject: string | null;
  updatedAt: number;
  blocks?: NoteBlockHit[];
}

export const noteSearch = (query: string, limit?: number | null, options: NoteSearchOptions = {}) =>
  invoke<NoteSearchHit[]>("note_search", { query, limit: limit ?? null, mode: options.mode ?? null, blocks: options.blocks ?? null });

export interface NoteTagCount {
  tag: string;
  label: string;
  count: number;
  notes: string[];
}

export const listNoteTags = () => invoke<NoteTagCount[]>("note_tags");

export interface NoteTaskRecord {
  projectId: string;
  tasks: { line: number; checked: boolean; text: string }[];
}

export const listNoteTasks = () => invoke<NoteTaskRecord[]>("note_tasks");

export const setNoteRelatedProject = (noteId: string, relatedProject: string | null) =>
  invoke<void>("set_note_related_project", { noteId, relatedProject });

export type QuickCaptureFailure = "taken" | "invalid" | "failed";

export interface QuickCaptureStatus {
  supported: boolean;
  registered: boolean;
  command: string | null;
  failure: QuickCaptureFailure | null;
  atLogin: LoginItemState;
}

export const quickCaptureConfigure = (enabled: boolean, accelerator: string | null, background: boolean) =>
  invoke<QuickCaptureStatus>("quick_capture_configure", { enabled, accelerator, background });

export const quickCaptureOpen = () => invoke<void>("quick_capture_open");

export const quickCaptureWindowButtons = (shown: boolean) => invoke<void>("quick_capture_window_buttons", { shown });

export const quickCaptureOpenNotes = () => invoke<void>("quick_capture_open_notes");

export interface NoteFileCopy {
  path: string;
  reused: boolean;
}

export const noteImportFile = (projectId: string, sourcePath: string) =>
  invoke<NoteFileCopy>("note_import_file", { projectId, sourcePath });

export interface NotesImportProgress {
  phase: "read" | "write";
  done: number;
  total: number;
  file: string;
}

export interface NotesImportSummary {
  notes: number;
  attachments: number;
  unresolved: number;
  skipped: number;
  cancelled: boolean;
  notCopied: string[];
  skippedNotes: string[];
}

export type NotesImportOutcome =
  | { kind: "dismissed" }
  | { kind: "seen"; importedAt: number; notes: number }
  | { kind: "large"; notes: number }
  | ({ kind: "done" } & NotesImportSummary);

export interface NotesImportRequest {
  runId: string;
  folderTags: boolean;
  again: boolean;
  files?: boolean;
  confirmLarge?: boolean;
  title: string;
}

export async function notesImportFolder(
  request: NotesImportRequest,
  onProgress: (progress: NotesImportProgress) => void,
): Promise<NotesImportOutcome> {
  const channel = new Channel<NotesImportProgress>();
  channel.onmessage = onProgress;
  try {
    return await invoke<NotesImportOutcome>("notes_import_folder", { request, onProgress: channel });
  } finally {
    channel.onmessage = () => {};
  }
}

export const notesImportCancel = (runId: string) => invoke<boolean>("notes_import_cancel", { runId });

export interface NotesExportSummary {
  folder: string;
  notes: number;
  attachments: number;
  skipped: number;
  paperLinks: string[];
}

export const notesExportFolder = (request: { noteId: string | null; folderName: string; title: string }) =>
  invoke<NotesExportSummary | null>("notes_export_folder", { request });

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

export const importTemplateFromPath = (path: string, name: string) =>
  invoke<string>("import_template_from_path", { path, name });

export const saveProjectAsTemplate = (
  projectId: string,
  name: string,
  previewPngBase64?: string | null,
) =>
  invoke<string>("save_project_as_template", {
    projectId,
    name,
    previewPngBase64: previewPngBase64 ?? null,
  });

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

export const listFontComponents = () => invoke<ComponentInfo[]>("list_font_components");

export const installFontComponent = (id: string) =>
  invoke<void>("install_font_component", { id });

export const removeFontComponent = (id: string) =>
  invoke<void>("remove_font_component", { id });

export const downloadAllFonts = () => invoke<void>("download_all_fonts");

export interface AddedFontPack {
  family: string;
  copied: string[];
  fontspec: string | null;
}

export const addFontPackToProject = (projectId: string, id: string) =>
  invoke<AddedFontPack>("add_font_pack_to_project", { projectId, id });

export const listDictionaries = () =>
  invoke<DictionaryInfo[]>("list_dictionaries");

export const installDictionary = (id: string) =>
  invoke<void>("install_dictionary", { id });

export const removeDictionary = (id: string) =>
  invoke<void>("remove_dictionary", { id });

export async function readDictionary(id: string): Promise<DictionaryBytes> {
  const payload = await invoke<ArrayBuffer>("read_dictionary", { id });
  const bytes = new Uint8Array(payload);
  if (bytes.byteLength <= 8) {
    throw new Error("The spelling dictionary payload is incomplete.");
  }
  const affLength = Number(
    new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true),
  );
  if (affLength <= 0 || affLength >= bytes.byteLength - 8) {
    throw new Error("The spelling dictionary payload is incomplete.");
  }
  return {
    aff: bytes.slice(8, 8 + affLength),
    dic: bytes.slice(8 + affLength),
  };
}

export const templatePrerequisites = (templateId: string) =>
  invoke<Prerequisite[]>("template_prerequisites", { templateId });

export const ensureTemplateAssets = (templateId: string) =>
  invoke<void>("ensure_template_assets", { templateId });

export const listTemplatePacks = () => invoke<PackInfo[]>("list_template_packs");

export const refreshPackCatalog = (force = false) =>
  invoke<boolean>("refresh_pack_catalog", { force });

export const packIndex = (packId: string, force = false) =>
  invoke<PackIndexInfo>("pack_index", { packId, force });

export const installTemplatePack = (id: string) =>
  invoke<void>("install_template_pack", { id });

export const installPackTemplate = (packId: string, templateId: string) =>
  invoke<void>("install_pack_template", { packId, templateId });

export const removeTemplatePack = (id: string) =>
  invoke<void>("remove_template_pack", { id });

export const TEMPLATE_LINK_EVENT = "template-link";

export interface TemplateLink {
  packId: string;
  templateId: string;
}

export const templateLinkReady = () => invoke<TemplateLink | null>("template_link_ready");

export const ASSET_PROGRESS_EVENT = "asset-progress";

export interface AssetProgressHandlers {
  readonly component?: (progress: AssetProgress) => void;
}

export function onAssetProgress(handlers: AssetProgressHandlers): Promise<UnlistenFn> {
  return listen<AssetProgress>(ASSET_PROGRESS_EVENT, ({ payload }) => {
    handlers.component?.(payload);
  });
}

async function withSubscription<R>(
  subscribe: () => Promise<UnlistenFn>,
  run: () => Promise<R>,
): Promise<R> {
  const unlisten = await subscribe();
  try {
    return await run();
  } finally {
    unlisten();
  }
}

export function withEventListener<T, R>(
  event: string,
  handler: (payload: T) => void,
  run: () => Promise<R>,
): Promise<R> {
  return withSubscription(() => listen<T>(event, ({ payload }) => handler(payload)), run);
}

export function withAssetProgress<R>(
  handlers: AssetProgressHandlers,
  run: () => Promise<R>,
): Promise<R> {
  return withSubscription(() => onAssetProgress(handlers), run);
}

export const readDeadlines = () => invoke<string>("read_deadlines");

export const refreshDeadlines = () => invoke<void>("refresh_deadlines");

export const gitIsInitialized = (projectId: string) =>
  invoke<boolean>("git_is_initialized", { projectId });

export const gitInitialize = (projectId: string) =>
  invoke<string>("git_initialize", { projectId });

export const gitPreparePublish = (
  projectId: string,
  message: string,
  options?: { allowTrackedSecrets?: string[] },
) =>
  invoke<GitPublishPrepared>("git_prepare_publish", {
    projectId,
    message,
    allowTrackedSecrets: options?.allowTrackedSecrets ?? [],
  });

export const gitPublishPreflight = (projectId: string) =>
  invoke<GitPublishPreflight>("git_publish_preflight", { projectId });

export const gitLog = (projectId: string) =>
  invoke<GitCommit[]>("git_log", { projectId });

export const gitRestore = (projectId: string, oid: string, expectedGeneration: number) =>
  invoke<ProjectStateChanged>("git_restore", { projectId, oid, expectedGeneration });

export const exportPdf = (projectId: string, dest: string, dataBase64?: string) =>
  invoke<void>("export_pdf", { projectId, dest, dataBase64 });

export const revealInDir = (path: string) =>
  invoke<void>("reveal_in_dir", { path });

export const revealProject = (projectId: string, path?: string | null) =>
  invoke<void>("reveal_project", { projectId, path: path ?? null });

export const projectFilePath = (projectId: string, path: string) =>
  invoke<string>("project_file_path", { projectId, path });

export interface CopyIntoLibraryProgress {
  phase: "counting" | "copying";
  entriesDone: number;
  entriesTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface CopiedIntoLibrary {
  projectId: string;
  leftOut: number;
}

export async function copyLinkedIntoLibrary(
  projectId: string,
  operationId: string,
  onProgress: (progress: CopyIntoLibraryProgress) => void,
): Promise<CopiedIntoLibrary> {
  const channel = new Channel<CopyIntoLibraryProgress>();
  channel.onmessage = onProgress;
  try {
    return await invoke<CopiedIntoLibrary>("copy_linked_into_library", {
      projectId,
      operationId,
      onProgress: channel,
    });
  } finally {
    channel.onmessage = () => {};
  }
}

export const cancelCopyIntoLibrary = (operationId: string) =>
  invoke<boolean>("cancel_copy_into_library", { operationId });

export const removeLinkedProject = (projectId: string) =>
  invoke<void>("remove_linked_project", { projectId });

export interface ProjectAvailabilityEvent {
  projectId: string;
  availability: ProjectAvailability;
  locationGeneration: number;
  relocated: boolean;
  grantsReset: boolean;
}
export type LocateFolderOutcome = "cancelled" | "declined" | "rebound";
export interface BufferCopyFile {
  path: string;
  content: string;
}
export interface SavedBufferCopy {
  folder: string;
  written: number;
}
export const locateProjectFolder = (projectId: string) =>
  invoke<LocateFolderOutcome>("locate_project_folder", { projectId });
export const adoptReplacedFolder = (projectId: string) =>
  invoke<LocateFolderOutcome>("adopt_replaced_folder", { projectId });
export const saveOpenBuffersCopy = (projectId: string, name: string, files: BufferCopyFile[]) =>
  invoke<SavedBufferCopy | null>("save_open_buffers_copy", { projectId, name, files });

export interface OpenRequestPreview {
  project_id: string | null;
  display_name: string;
}
export const pendingOpenRequests = () =>
  invoke<PendingOpenRequest[]>("pending_open_requests");
export const beginOpenSession = () => invoke<number>("begin_open_session");
export const prepareOpenRequest = (token: string, session: number | null) =>
  invoke<OpenRequestPreview>("prepare_open_request", { token, session });
export const discardOpenRequest = (token: string, session: number | null) =>
  invoke<void>("discard_open_request", { token, session });
export const openFolderRequest = (token: string, session: number | null) =>
  invoke<OpenedFolder>("open_folder_request", { token, session });
export const pickOpenFolder = (browse: string | null = null) =>
  invoke<PendingOpenRequest | null>("pick_open_folder", { browse });
export const debugInjectOpenRequest = (path: string) =>
  invoke<PendingOpenRequest>("debug_inject_open_request", { path });
export const debugAnswerNextConfirmation = (answer: boolean) =>
  invoke<void>("debug_answer_next_confirmation", { answer });
export type SystemIntegrationItemId =
  | "quick_action"
  | "explorer_menu"
  | "dolphin"
  | "nemo"
  | "nautilus"
  | "folder_open_with";
export type SystemIntegrationState = "installed" | "not_installed" | "needs_attention";
export type SystemIntegrationAttention =
  | "outdated"
  | "elsewhere"
  | "moved"
  | "no_default_file_manager";
export interface SystemIntegrationItem {
  id: SystemIntegrationItemId;
  state: SystemIntegrationState;
  packaged: boolean;
  attention: SystemIntegrationAttention | null;
  quick_actions_menu: boolean | null;
  menu_title: string | null;
}
export interface SystemIntegrationStatus {
  platform: "macos" | "windows" | "linux" | "other";
  items: SystemIntegrationItem[];
}
export const systemIntegrationStatus = () =>
  invoke<SystemIntegrationStatus>("system_integration_status");
export const setSystemIntegration = (item: SystemIntegrationItemId, enabled: boolean) =>
  invoke<SystemIntegrationItem>("system_integration_set", { item, enabled });
export const claimQuickActionOffer = () => invoke<boolean>("claim_quick_action_offer");
export interface RecentProjectEntry {
  id: string;
  name: string;
}
export const setRecentProjects = (projects: RecentProjectEntry[]) =>
  invoke<void>("set_recent_projects", { projects });

export const EXPORT_LOG_EVENT = "export:log";

export type ExportOutcome = import("@oleafly/backend-port").ExportOutcome;

export const exportDocument = (
  projectId: string,
  mainDoc: string,
  format: string,
  dest: string,
  typstVariant: string | null = null,
  offline?: boolean,
) => invoke<ExportOutcome>("export_document", { projectId, mainDoc, format, dest, typstVariant, offline });

export const hasPandoc = () => invoke<boolean>("has_pandoc");

export const downloadPandoc = () => invoke<string>("download_pandoc");

export const texDistributions = () => invoke<TexDistribution[]>("tex_distributions");
export const setTexDistribution = (binDir: string | null) =>
  invoke<void>("set_tex_distribution", { binDir });
export const setCustomTexFolder = (folder: string) =>
  invoke<string>("set_custom_tex_folder", { folder });

export type DownloadSourceChoice = "automatic" | "original" | "custom";

export interface DownloadSettings {
  source: DownloadSourceChoice;
  mirrorUrl: string | null;
  texRepository: string | null;
  oleaflyMirror: string;
  automaticTexRepository: string;
  environmentSource: string | null;
  environmentTexRepository: string | null;
}

export interface DownloadSettingsInput {
  source: DownloadSourceChoice;
  mirrorUrl: string | null;
  texRepository: string | null;
}

export const getDownloadSettings = () => invoke<DownloadSettings>("get_download_settings");
export const setDownloadSettings = (settings: DownloadSettingsInput) =>
  invoke<DownloadSettings>("set_download_settings", { settings });

export const latexEngineInfo = (rescan?: EngineRescan) =>
  invoke<EngineInfo>("latex_engine_info", { rescan });
export const setPhitexEnabled = (enabled: boolean) =>
  invoke<void>("set_phitex_enabled", { enabled });
export const hasTaggingEngine = () => invoke<boolean>("has_tagging_engine");
export const installTinytex = () => invoke<EngineInfo>("install_tinytex");
export const cancelTinytexInstall = () => invoke<void>("cancel_tinytex_install");
export const tinytexInstallState = () =>
  invoke<TinytexInstallState>("tinytex_install_state");
export const confirmQuitDuringInstall = () =>
  invoke<void>("confirm_quit_during_install");
export const confirmQuitFlush = (restart: boolean) =>
  invoke<void>("confirm_quit_flush", { restart });
export const cancelQuitFlush = () => invoke<void>("cancel_quit_flush");
export const deleteTinytex = () => invoke<void>("delete_tinytex");
export interface TexPackage {
  name: string;
  description: string;
}

export const tlmgrSearch = (query: string) => invoke<TexPackage[]>("tlmgr_search", { query });
export const tlmgrInstallMissing = (files: string[]) => invoke<string>("tlmgr_install_missing", { files });
export const tlmgrInstalled = (userTree = false) =>
  invoke<string[]>("tlmgr_installed", userTree ? { userTree: true } : {});
export const tlmgrInstall = (packages: string[]) => invoke<string>("tlmgr_install", { packages });
export const tlmgrRemove = (packages: string[], userTree = false) =>
  invoke<string>("tlmgr_remove", userTree ? { packages, userTree: true } : { packages });
export const compileTagged = (projectId: string, mainDoc: string) =>
  invoke<TaggedCompileResult>("compile_tagged", { projectId, mainDoc });

export const fetchDoiBibtex = (doi: string) => invoke<string>("fetch_doi_bibtex", { doi });
export const fetchArxiv = (id: string) => invoke<string>("fetch_arxiv", { id });
export const fetchIsbnBibtex = (isbn: string) => invoke<string>("fetch_isbn_bibtex", { isbn });
export const fetchPmidBibtex = (pmid: string) => invoke<string>("fetch_pmid_bibtex", { pmid });
export const importArxivEprint = (arxivId: string, name?: string) =>
  invoke<string>("import_arxiv_eprint", { arxivId, name: name ?? null });

export type ImportTarget = "latex" | "markdown" | "typst";

export interface CleanAction {
  kind: "renamed-key" | "removed-duplicate" | "advisory";
  old?: string;
  new?: string;
  removed?: string;
  kept?: string;
  by?: string;
  key?: string;
  field?: string;
}

export interface CleanLibraryOutcome {
  original: string;
  cleaned: string;
  entriesBefore: number;
  entriesAfter: number;
  actions: CleanAction[];
  applied: boolean;
  previewToken: string;
  changedFiles: string[];
  backupPath?: string | null;
  projectState?: ProjectStateChanged;
}

export const cleanBibtexLibrary = (projectId: string, bibPath: string, apply: boolean, previewToken?: string, expectedGeneration?: number) =>
  invoke<CleanLibraryOutcome>("clean_bibtex_library", { projectId, bibPath, apply, previewToken, expectedGeneration });

export interface StatsPValueResult {
  p: number;
  label: string;
}

export const statsPValue = (test: string, statistic: number, df?: number) =>
  invoke<StatsPValueResult>("stats_p_value", { test, statistic, df: df ?? null });

export interface StatsSampleSizeResult {
  z: number;
  infinitePopulation: number;
  finitePopulation?: number | null;
}

export const statsSampleSize = (
  proportion: number,
  marginError: number,
  confidence: number,
  population?: number,
) =>
  invoke<StatsSampleSizeResult>("stats_sample_size", {
    proportion,
    marginError,
    confidence,
    population: population ?? null,
  });

export interface StatsConfidenceIntervalResult {
  pointEstimate: number;
  lower: number;
  upper: number;
  standardError: number;
  marginOfError: number;
  criticalValue: number;
  criticalLabel: string;
  degreesOfFreedom?: number | null;
  intervalMethod: string;
}

export const statsConfidenceInterval = (
  mode: "mean" | "proportion",
  confidence: number,
  options: { mean?: number; sd?: number; n?: number; successes?: number },
) =>
  invoke<StatsConfidenceIntervalResult>("stats_confidence_interval", {
    mode,
    confidence,
    mean: options.mean ?? null,
    sd: options.sd ?? null,
    n: options.n ?? null,
    successes: options.successes ?? null,
  });
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
export const zoteroVerify = (userId: string, apiKey: string) =>
  invoke<ZoteroAccount>("zotero_verify", { userId, apiKey });
export const zoteroLibraryBibtex = () =>
  invoke<ZoteroLibraryExport>("zotero_library_bibtex");
export const zoteroLibraryStatus = () =>
  invoke<ZoteroLibraryStatus>("zotero_library_status");
export const zoteroLibrarySync = (offline: boolean, force: boolean) =>
  invoke<ZoteroLibraryStatus>("zotero_library_sync", { offline, force });
export const zoteroLibraryTest = (offline: boolean) =>
  invoke<ZoteroConnectionReport>("zotero_library_test", { offline });
export const zoteroLibrarySearch = (query: string, limit: number) =>
  invoke<ZoteroSearchReply>("zotero_library_search", { query, limit });
export const zoteroLibraryLookup = (keys: string[]) =>
  invoke<(ZoteroHit | null)[]>("zotero_library_lookup", { keys });
export const zoteroLibraryKeys = () =>
  invoke<ZoteroKeysReply>("zotero_library_keys");
export const zoteroLibraryItems = (refs: ZoteroItemRef[]) =>
  invoke<(ZoteroHit | null)[]>("zotero_library_items", { refs });
export const zoteroLibraryExport = (
  refs: ZoteroItemRef[],
  style: ZoteroExportStyle,
  offline: boolean,
) => invoke<ZoteroExportedEntry[]>("zotero_library_export", { refs, style, offline });
export const zoteroLibrarySetEnabled = (libraryId: string, enabled: boolean) =>
  invoke<ZoteroLibraryStatus>("zotero_library_set_enabled", { libraryId, enabled });
export const zoteroWebAccount = () =>
  invoke<ZoteroAccount | null>("zotero_web_account");
export const zoteroWebConnect = (userId: string, apiKey: string) =>
  invoke<ZoteroAccount>("zotero_web_connect", { userId, apiKey });
export const zoteroWebDisconnect = () => invoke<void>("zotero_web_disconnect");
export const zoteroProjectLinks = (projectId: string) =>
  invoke<Record<string, ZoteroProjectLink>>("zotero_project_links", { projectId });
export const zoteroUpdateProjectLinks = (
  projectId: string,
  changes: Record<string, ZoteroProjectLink | null>,
) =>
  invoke<Record<string, ZoteroProjectLink>>("zotero_update_project_links", {
    projectId,
    changes,
  });

export const searchDocs = (query: string) =>
  invoke<SearchHit[]>("search_docs", { query });

export const searchProject = (projectId: string, query: string) =>
  invoke<SearchHit[]>("search_project", { projectId, query });

export const getConfig = () => invoke<AppConfig>("get_config");
export const setConfig = (config: AppConfig) =>
  invoke<void>("set_config", { config });
export const claimStarterNote = () => invoke<boolean>("claim_starter_note");
export const REDACTED_MARKER = "__stored__";

export const ghPublicRepoStats = (fullName: string) =>
  invoke<GitHubRepoStats>("gh_public_repo_stats", { fullName });
export const discordCommunityStats = () =>
  invoke<DiscordCommunityStats>("discord_community_stats");

export const FORGE_ACCOUNTS_CHANGED_EVENT = "forge-accounts-changed";

export const forgeAccountsList = () => invoke<ForgeAccount[]>("forge_accounts_list");
export const forgeDetect = (base: string, caFile?: string | null) =>
  invoke<ForgeServerInfo>("forge_detect", { base, caFile: caFile ?? null });
export const forgeSignInToken = (
  base: string,
  kind: ForgeKind,
  token: string,
  caFile?: string | null,
) => invoke<ForgeAccount>("forge_sign_in_token", { base, kind, token, caFile: caFile ?? null });
export const forgeDeviceStart = (base: string) =>
  invoke<ForgeDeviceStart>("forge_device_start", { base });
export const forgeDevicePoll = (flowId: string) =>
  invoke<ForgeDevicePoll>("forge_device_poll", { flowId });
export const forgeDeviceCancel = (flowId: string) =>
  invoke<void>("forge_device_cancel", { flowId });
export const forgeSignOut = (base: string) => invoke<void>("forge_sign_out", { base });
export const forgeSetCaFile = (base: string, caFile: string | null) =>
  invoke<ForgeAccount>("forge_set_ca_file", { base, caFile });
export const forgeValidate = (base: string) =>
  invoke<ForgeAccountCheck>("forge_validate", { base });
export const forgeListRepos = (base: string, page: number, query?: string | null) =>
  invoke<ForgeRepoPage>("forge_list_repos", { base, page, query: query ?? null });
export const forgeCreateRepo = (base: string, name: string, isPrivate: boolean) =>
  invoke<ForgeRepo>("forge_create_repo", { base, name, private: isPrivate });
let repositoryImportId: string | null = null;
export const currentRepositoryImportId = (): string | null => repositoryImportId;
function nextRepositoryImportId(): string {
  repositoryImportId = crypto.randomUUID();
  return repositoryImportId;
}
export const forgeImportRepo = (base: string, fullName: string) =>
  invoke<string>("forge_import_repo", { base, fullName, cancelId: nextRepositoryImportId() });
export const gitCloneProject = (url: string) =>
  invoke<string>("git_clone_project", { url, cancelId: nextRepositoryImportId() });

export function onForgeAccountsChanged(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(FORGE_ACCOUNTS_CHANGED_EVENT, () => handler());
}

export const COLLAB_OPEN_LINK_EVENT = "collab-open-link";

export const collabPendingLinks = () => invoke<string[]>("collab_pending_links");

export function onCollabOpenLink(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(COLLAB_OPEN_LINK_EVENT, () => handler());
}

export const COLLAB_LIVE_WRITTEN_EVENT = "collab-live-written";
export const gitSetRemote = (projectId: string, url: string, options?: { replace?: boolean }) =>
  invoke<void>("git_set_remote", { projectId, url, replace: options?.replace ?? false });
export const gitRemoveRemote = (projectId: string) =>
  invoke<void>("git_remove_remote", { projectId });
export const gitGetRemote = (projectId: string) =>
  invoke<string | null>("git_get_remote", { projectId });
export const gitRemoteCredentialsNeedCleanup = (projectId: string) =>
  invoke<boolean>("git_remote_credentials_need_cleanup", { projectId });
export const gitCleanRemoteCredentials = (projectId: string) =>
  invoke<boolean>("git_clean_remote_credentials", { projectId });
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

export const gitWorkspaceSnapshot = (projectId: string) =>
  invoke<GitWorkspaceSnapshot>("git_workspace_snapshot", { projectId });

export const gitDiff = (projectId: string, path?: string, staged = false) =>
  invoke<string>("git_diff", { projectId, path: path ?? null, staged });

export const gitDiscard = (projectId: string, path: string, expectedGeneration: number) =>
  invoke<ProjectStateChanged>("git_discard", { projectId, path, expectedGeneration });

export const gitDiscardPaths = (
  projectId: string,
  paths: string[],
  expectedGeneration: number,
) => invoke<ProjectStateChanged>("git_discard_paths", { projectId, paths, expectedGeneration });

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

export const gitStagePaths = (projectId: string, paths: string[]) =>
  invoke<void>("git_stage_paths", { projectId, paths });

export const gitUnstagePaths = (projectId: string, paths: string[]) =>
  invoke<void>("git_unstage_paths", { projectId, paths });

export const gitCommit = (projectId: string, message: string) =>
  invoke<boolean>("git_commit", { projectId, message });

export const gitCommitAmend = (projectId: string, message: string) =>
  invoke<boolean>("git_commit_amend", { projectId, message });

export const gitFetch = (projectId: string) =>
  invoke<string>("git_fetch", { projectId });

export const gitCreateBranch = (projectId: string, branch: string) =>
  invoke<string>("git_create_branch", { projectId, branch });

export const gitCheckoutBranch = (
  projectId: string,
  branch: string,
  expectedGeneration: number,
) => invoke<ProjectStateChanged>("git_checkout_branch", { projectId, branch, expectedGeneration });

export const gitStashPush = (projectId: string, expectedGeneration: number) =>
  invoke<GitWorktreeOperationResult>("git_stash_push", { projectId, expectedGeneration });

export const gitStashPop = (projectId: string, expectedGeneration: number) =>
  invoke<GitWorktreeOperationResult>("git_stash_pop", { projectId, expectedGeneration });

export const gitResolveConflict = (
  projectId: string,
  path: string,
  resolution: "current" | "incoming" | "mark",
  expectedGeneration: number,
) => invoke<ProjectStateChanged>("git_resolve_conflict", {
  projectId,
  path,
  resolution,
  expectedGeneration,
});

export const gitContinueMerge = (projectId: string, expectedGeneration: number) =>
  invoke<GitWorktreeOperationResult>("git_continue_merge", { projectId, expectedGeneration });

export const gitAbortMerge = (projectId: string, expectedGeneration: number) =>
  invoke<GitWorktreeOperationResult>("git_abort_merge", { projectId, expectedGeneration });

export const gitShow = (projectId: string, rev: string, path: string) =>
  invoke<string>("git_show", { projectId, rev, path });

export const downloadProjectZip = (projectId: string, dest: string) =>
  invoke<{ skippedLinks: number }>("download_project_zip", { projectId, dest });

export const duplicateProject = (projectId: string, newName: string) =>
  invoke<string>("duplicate_project", { projectId, newName });

export const clearBuildCache = (projectId: string) =>
  invoke<void>("clear_build_cache", { projectId });

export const recycleProject = (projectId: string) =>
  invoke<void>("recycle_project", { projectId });

export const libraryRoot = () => invoke<string>("library_root");
export const displayHomes = () => invoke<string[]>("display_homes");
export const appVersion = () => invoke<string>("app_version");
export const backendProtocolInfo = () =>
  invoke<BackendProtocolInfo>("backend_protocol_info");
export const initialState = () => invoke<InitialState>("initial_state");

export type ProjectTrust = {
  trusted: boolean;
  source: "library" | "folder" | "parent_folder" | null;
  parent: string | null;
  repository: { name: string; trusted: boolean } | null;
};
export type TrustScope = "folder" | "parent" | "repository";
export const projectTrustState = (projectId: string) =>
  invoke<ProjectTrust>("project_trust_state", { projectId });
export const trustFolder = (projectId: string, scope: TrustScope) =>
  invoke<ProjectTrust>("trust_folder", { projectId, scope });
export const revokeFolderTrust = (projectId: string) =>
  invoke<ProjectTrust>("revoke_folder_trust", { projectId });

export type SyncService =
  | "icloud_drive"
  | "one_drive"
  | "dropbox"
  | "google_drive"
  | "box"
  | "cloud_storage";
export type FolderStatus = {
  read_only: boolean;
  synced_with: SyncService | null;
};
export const projectFolderStatus = (projectId: string) =>
  invoke<FolderStatus | null>("project_folder_status", { projectId });

export { base64ToBytes as base64ToUint8Array, bytesToBase64 as uint8ToBase64 } from "@/lib/base64";

export const synctexForward = (
  projectId: string,
  mainDoc: string,
  file: string,
  line: number
) =>
  invoke<SynctexForwardHit | null>("synctex_forward", {
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

export type CollabSyncDecision = import("@oleafly/backend-port").CollabSyncDecision;
export type CollabSyncPaused = import("@oleafly/backend-port").CollabSyncPaused;
export type CollabSyncResumed = import("@oleafly/backend-port").CollabSyncResumed;
export type {
  CollabGuestInvitation,
  CollabGuestInvitationStatus,
  CollabGuestInviteResult,
  CollabProjectGuestInvitations,
} from "@oleafly/backend-port";

export type { CollabSignInCode, CollabSignOut, CollabUnsentProject } from "@oleafly/backend-port";

export type {
  CollabLiveEndedReason,
  CollabLiveSyncState,
  CollabLiveMembers,
  CollabMemberChangeKind,
  CollabSessionEnd,
} from "@oleafly/backend-port";

export const setActiveProject = (projectId: string | null) => invoke<void>("set_active_project", { projectId });
export const connectorKeySaved = (connectorId: string) => invoke<boolean>("connector_key_saved", { connectorId });
export const setConnectorKey = (connectorId: string, value: string) => invoke<void>("set_connector_key", { connectorId, value });
