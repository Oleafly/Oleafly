export type ResearchToolStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "declined";

export interface ProjectResearchArtifactTarget {
  scope: "project";
  projectId?: string;
  path: string;
  line?: number;
  page?: number;
  revision?: string;
}

export interface LinkedResearchArtifactTarget {
  scope: "linked";
  rootId: string;
  relativePath: string;
}

export type ResearchArtifactTarget =
  | ProjectResearchArtifactTarget
  | LinkedResearchArtifactTarget;

export interface ResearchArtifactPreview {
  relativePath: string;
  content: string;
  truncated: boolean;
  isBinary: boolean;
}

export interface ResearchArtifactPorts {
  openProject: (
    projectId: string,
    target: ProjectResearchArtifactTarget,
  ) => void | Promise<void>;
  inspectLinked: (
    projectId: string,
    target: LinkedResearchArtifactTarget,
  ) => ResearchArtifactPreview | Promise<ResearchArtifactPreview>;
}

export interface ResearchSourceTarget {
  sourceId?: string;
  url?: string;
  doi?: string;
  page?: number;
  quote?: string;
}

export interface ResearchChatActions {
  openArtifact?: (
    target: ResearchArtifactTarget,
  ) => Promise<ResearchArtifactPreview | undefined>;
  openSource?: (target: ResearchSourceTarget) => void;
  openSession?: (target: { threadId: string; runtime?: string | null; projectId?: string }) => void;
  reviewChanges?: (target: { turnId: string; paths: string[] }) => void;
  respondToApproval?: (target: { requestId: string; decision: string }) => void;
}

export interface LiteratureResultView {
  id?: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  source?: string;
  abstract?: string;
}

export type ResearchToolView = {
  kind:
    | "command"
    | "literature"
    | "citation"
    | "source"
    | "compile"
    | "artifact"
    | "delegation"
    | "generic";
  name: string;
  label: string;
  status: ResearchToolStatus;
  statusLabel: string;
  output: string;
  summary?: string;
  path?: string;
  artifactTarget?: ResearchArtifactTarget;
  line?: number;
  page?: number;
  doi?: string;
  url?: string;
  verified?: boolean;
  hasArtifact?: boolean;
  threadId?: string;
  command?: string;
  exitCode?: number | null;
  results?: LiteratureResultView[];
  diagnostics?: string[];
};

const LABELS: Record<string, string> = {
  run_command: "Run command",
  literature_search: "Search literature",
  alphaxiv_search: "Search papers",
  alphaxiv_paper_content: "Read paper",
  verify_citation: "Check citation",
  project_library_search: "Search project sources",
  read_file: "Read file",
  read_linked_file: "Read linked file",
  read_research_root_file: "Read linked file",
  list_files: "List project files",
  search_project: "Search project",
  project_map: "Map project",
  compile: "Compile document",
  get_log: "Read compile log",
  read_pdf_text: "Read compiled PDF",
  verify_pdf_pages: "Check PDF pages",
  preview_figure: "Preview figure",
  insert_figure: "Insert figure",
  spawn_agent: "Start delegated task",
  wait_agent: "Wait for delegated task",
  send_message: "Update delegated task",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOutput(output: string | undefined): unknown {
  if (!output) return null;
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return output;
  }
}

export interface ToolActivityEntry {
  id?: string;
  name: string;
  status: "running" | "done" | "error";
  output?: string;
  approval?: "approved" | "rejected";
}

function explicitStatus(entry: ToolActivityEntry, value: unknown): ResearchToolStatus {
  if (entry.approval === "rejected") return "declined";
  const data = record(value);
  const rawStatus = stringValue(data?.status)?.toLowerCase();
  if (data?.declined === true || rawStatus === "declined" || rawStatus === "rejected") {
    return "declined";
  }
  if (
    data?.cancelled === true ||
    data?.canceled === true ||
    data?.interrupted === true ||
    rawStatus === "cancelled" ||
    rawStatus === "canceled" ||
    rawStatus === "interrupted" ||
    rawStatus === "stopped"
  ) {
    return "cancelled";
  }
  if (
    entry.status === "error" ||
    data?.error != null ||
    data?.success === false ||
    data?.timed_out === true ||
    rawStatus === "failed" ||
    rawStatus === "error"
  ) {
    return "failed";
  }
  const exitCode = numberValue(data?.exit_code);
  if (exitCode !== undefined) return exitCode === 0 ? "completed" : "failed";
  if (
    data?.success === true ||
    rawStatus === "completed" ||
    rawStatus === "done" ||
    rawStatus === "success"
  ) {
    return "completed";
  }
  return entry.status === "running" ? "running" : "completed";
}

function statusLabel(status: ResearchToolStatus, value: unknown): string {
  const data = record(value);
  if (status === "running") return "Running";
  if (status === "declined") return "Declined";
  if (status === "cancelled") return "Stopped";
  if (status === "failed") {
    if (data?.timed_out === true) return "Timed out";
    const exitCode = numberValue(data?.exit_code);
    return exitCode === undefined ? "Failed" : `Failed with exit code ${exitCode}`;
  }
  return "Done";
}

export function stripAnsi(value: string): string {
  const escapeSequence = String.fromCharCode(27);
  return value.replace(new RegExp(`${escapeSequence}\\[[0-?]*[ -/]*[@-~]`, "g"), "");
}

function readableOutput(raw: string | undefined, value: unknown): string {
  if (!raw) return "";
  if (typeof value === "string") return stripAnsi(value);
  const data = record(value);
  const commandOutput = stringValue(data?.output);
  if (commandOutput !== undefined) return stripAnsi(commandOutput);
  const content = stringValue(data?.content);
  if (content !== undefined) return stripAnsi(content);
  const log = stringValue(data?.log) ?? stringValue(data?.log_tail);
  if (log !== undefined) return stripAnsi(log);
  const error = stringValue(data?.error);
  if (error !== undefined) return error;
  return stripAnsi(JSON.stringify(value, null, 2) ?? raw);
}

function abstractFromIndex(value: unknown): string | undefined {
  const index = record(value);
  if (!index) return undefined;
  const words: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === "number") words.push({ word, position });
    }
  }
  return words
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.word)
    .join(" ") || undefined;
}

function literatureResult(value: unknown): LiteratureResultView | null {
  const data = record(value);
  const title = stringValue(data?.title) ?? stringValue(data?.display_name);
  if (!title) return null;
  const authorships = Array.isArray(data?.authorships) ? data.authorships : [];
  const authors = authorships
    .map((authorship) => stringValue(record(record(authorship)?.author)?.display_name))
    .filter((author): author is string => Boolean(author));
  const directAuthors = Array.isArray(data?.authors)
    ? data.authors.map((author) => stringValue(record(author)?.display_name) ?? stringValue(author))
    : [];
  const location = record(data?.primary_location);
  const source = record(location?.source);
  const doi = stringValue(data?.doi)?.replace(/^https?:\/\/doi\.org\//i, "");
  const landingUrl = safeWebUrl(stringValue(location?.landing_page_url));
  const id = stringValue(data?.id);
  return {
    id,
    title,
    authors: [...authors, ...directAuthors.filter((author): author is string => Boolean(author))],
    year: numberValue(data?.publication_year) ?? numberValue(data?.year),
    doi,
    url: landingUrl ?? safeWebUrl(stringValue(data?.url)) ?? safeWebUrl(id),
    source: stringValue(source?.display_name) ?? stringValue(data?.source),
    abstract: stringValue(data?.abstract) ?? abstractFromIndex(data?.abstract_inverted_index),
  };
}

export function safeWebUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const data = record(item);
      return stringValue(data?.message) ?? stringValue(data?.text) ?? stringValue(data?.error);
    })
    .filter((message): message is string => Boolean(message));
}

function kindFor(name: string): ResearchToolView["kind"] {
  if (name === "run_command" || name === "exec_command" || name === "shell_command") return "command";
  if (name === "literature_search" || name === "alphaxiv_search") return "literature";
  if (name === "verify_citation") return "citation";
  if (["read_file", "read_linked_file", "read_research_root_file", "project_library_search", "alphaxiv_paper_content", "search_project", "list_files", "project_map", "get_log", "read_pdf_text", "verify_pdf_pages"].includes(name)) return "source";
  if (name === "compile" || name === "preview_figure") return "compile";
  if (name === "insert_figure" || name === "generate_artifact" || name === "create_artifact") return "artifact";
  if (["spawn_agent", "wait_agent", "send_message", "send_message_to_agent"].includes(name)) return "delegation";
  return "generic";
}

function normalizedToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function artifactTarget(
  name: string,
  data: Record<string, unknown> | null,
  path: string | undefined,
  line: number | undefined,
  page: number | undefined,
): ResearchArtifactTarget | undefined {
  const linked = name === "read_linked_file" || name === "read_research_root_file";
  if (linked) {
    const rootId = stringValue(data?.rootId) ?? stringValue(data?.root_id);
    const relativePath = stringValue(data?.relativePath) ?? stringValue(data?.relative_path) ?? path;
    return rootId && relativePath
      ? { scope: "linked", rootId, relativePath }
      : undefined;
  }
  const projectScoped = [
    "read_file",
    "project_library_search",
    "search_project",
    "list_files",
    "project_map",
    "compile",
    "get_log",
    "read_pdf_text",
    "verify_pdf_pages",
    "preview_figure",
    "insert_figure",
    "generate_artifact",
    "create_artifact",
  ].includes(name);
  return projectScoped && path ? { scope: "project", path, line, page } : undefined;
}

export function createResearchArtifactAction(
  projectId: string | null,
  ports: ResearchArtifactPorts,
): NonNullable<ResearchChatActions["openArtifact"]> {
  return async (target) => {
    if (!projectId) return;
    if (target.scope === "linked") return await ports.inspectLinked(projectId, target);
    if (target.projectId && target.projectId !== projectId) return;
    await ports.openProject(projectId, target);
  };
}

export function projectToolEntry(entry: ToolActivityEntry): ResearchToolView {
  const value = parseOutput(entry.output);
  const data = record(value);
  const status = explicitStatus(entry, value);
  const name = normalizedToolName(entry.name);
  const kind = kindFor(name);
  const rawResults = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.works)
      ? data.works
      : [];
  const results = rawResults
    .map(literatureResult)
    .filter((result): result is LiteratureResultView => result !== null);
  const path = stringValue(data?.path) ?? stringValue(data?.file) ??
    stringValue(data?.relativePath) ?? stringValue(data?.relative_path);
  const line = numberValue(data?.line) ?? numberValue(data?.offset);
  const page = numberValue(data?.page);
  const command = stringValue(data?.command);
  const doi = stringValue(data?.doi)?.replace(/^https?:\/\/doi\.org\//i, "");
  const url = safeWebUrl(stringValue(data?.url) ?? stringValue(data?.source_url));
  const verified = typeof data?.verified === "boolean" ? data.verified : undefined;
  const errors = diagnosticMessages(data?.errors);
  const diagnostics = [...errors, ...diagnosticMessages(data?.diagnostics)];
  let summary: string | undefined;
  if (kind === "literature" && status === "completed") summary = `${results.length} ${results.length === 1 ? "paper" : "papers"}`;
  if (kind === "citation" && verified === true) summary = "Verified by the citation service";
  if (kind === "citation" && verified === false) summary = stringValue(data?.reason) ?? "No matching record found";
  if (kind === "compile" && status === "completed") summary = diagnostics.length ? `${diagnostics.length} diagnostics` : "Compiled successfully";
  if (kind === "compile" && status === "failed") summary = diagnostics.length ? `${diagnostics.length} diagnostics` : "Compilation failed";
  if (kind === "source" && path) summary = path;
  return {
    kind,
    name,
    label: LABELS[name] ?? entry.name.replaceAll("_", " "),
    status,
    statusLabel: statusLabel(status, value),
    output: readableOutput(entry.output, value),
    summary,
    path,
    artifactTarget: artifactTarget(name, data, path, line, page),
    line,
    page,
    doi,
    url,
    verified,
    hasArtifact: data?.has_pdf === true || data?.artifact === true || Boolean(path && kind === "artifact"),
    threadId: stringValue(data?.threadId) ?? stringValue(data?.thread_id) ?? stringValue(data?.taskPath),
    command,
    exitCode: typeof data?.exit_code === "number" || data?.exit_code === null
      ? (data.exit_code as number | null)
      : undefined,
    results: results.length ? results : undefined,
    diagnostics: diagnostics.length ? diagnostics : undefined,
  };
}
