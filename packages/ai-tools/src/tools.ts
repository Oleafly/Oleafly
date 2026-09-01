import {
  buildStandaloneDoc,
  slugifyFigureName,
  bytesToBase64,
  normalizeFigureCode,
} from "@oleafly/latex";
import { pickPagesToVerify } from "./pick-pages";
import {
  cuaActionRisk,
  runCuaAction,
  type CuaActionType,
  type CuaSurface,
} from "./cua";

export interface IndexDefView {
  kind: string;
  name: string;
  level?: number;
  file?: string;
  line?: number;
}

export interface IndexUseView {
  kind: string;
  name: string;
  file?: string;
  target?: string;
}

export interface ProjectIndexView {
  defs: IndexDefView[];
  uses: IndexUseView[];
  definitionFor(use: IndexUseView): unknown;
}

// The app builds one adapter over its Tauri client and stores; this package
// stays free of them.
export interface AiToolsHost {
  getProjectId(): string | null;
  readFileContent(projectId: string, path: string): Promise<string>;
  writeFileContent(
    projectId: string,
    path: string,
    content: string,
    expectedGeneration?: number,
  ): Promise<unknown>;
  createFile(
    projectId: string,
    path: string,
    isDir: boolean,
    expectedGeneration?: number,
  ): Promise<unknown>;
  deleteFile(projectId: string, path: string, expectedGeneration?: number): Promise<unknown>;
  renameFile(
    projectId: string,
    from: string,
    to: string,
    expectedGeneration?: number,
  ): Promise<unknown>;
  setMainDoc(projectId: string, path: string): Promise<{ main_doc: string }>;
  listFiles(projectId: string): Promise<unknown[]>;
  searchProject(projectId: string, query: string): Promise<unknown[]>;
  readProjectBytes(projectId: string, path: string): Promise<ArrayBuffer | ArrayLike<number>>;
  writeProjectBytes(
    projectId: string,
    relPath: string,
    dataBase64: string,
    expectedGeneration?: number,
  ): Promise<unknown>;
  prepareExternalMutation(projectId: string): Promise<number>;
  applyExternalWrite(projectId: string, path: string, content: string): boolean;
  applyExternalRename(projectId: string, from: string, to: string): boolean;
  applyExternalDelete(projectId: string, path: string): boolean;
  refreshTree(projectId: string): Promise<void>;
  recompile(): Promise<
    { ok?: boolean; errors?: unknown[]; has_pdf?: boolean; log?: string | null } | null | undefined
  >;
  getCompileLog(): string | null;
  getPdfBytes(): Uint8Array | null;
  extractPdfText(bytes: Uint8Array): Promise<{ pages: string[]; numPages: number }>;
  getPdfCursorPage?(): number | null | undefined;
  // Symbol index (built lazily by the host when absent).
  getProjectIndex(): Promise<ProjectIndexView | null>;
  compileIsolated(
    projectId: string,
    source: string,
  ): Promise<{ ok: boolean; errors: unknown[]; has_pdf: boolean; log?: string | null }>;
  readIsolatedPdf(projectId: string): Promise<ArrayBuffer | ArrayLike<number>>;
  pdfToPng(bytes: Uint8Array, page: number, scale: number): Promise<string>;
  // Figure session state (last preview, insert target from a selection).
  setLastFigurePreview(v: { pdfBytes: Uint8Array } | null): void;
  getLastFigurePreview(): { pdfBytes: Uint8Array } | null;
  getFigureInsertTarget(): { from: number; to: number } | null;
  insertAtCursor(
    projectId: string,
    text: string,
    mutationAllowed?: () => boolean,
  ): boolean | Promise<boolean>;
  replaceRange(
    projectId: string,
    from: number,
    to: number,
    text: string,
    mutationAllowed?: () => boolean,
  ): boolean | Promise<boolean>;
  // Agent plan checklist (update_todos / get_todos).
  getAgentTodos(): { id: string; content: string; status: string }[];
  setAgentTodos(todos: { id: string; content: string; status: string }[]): void;
  // PDF vision verify (optional privacy gate).
  getAiPdfCaptureEnabled(): boolean;
  // Sticky project memory notes (across chats).
  rememberNote(content: string): { id: string; content: string } | { error: string };
  forgetNote(id: string): { success: boolean; error?: string };
  listNotes(): { id: string; content: string }[];
}

type RawSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
};

type RawToolDef = {
  description: string;
  inputSchema: RawSchema;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

export interface ToolApprovalRequest {
  tool: string;
  summary: string;
  projectId?: string;
  command?: string;
  cwd?: string;
  path?: string;
  diff?: { path: string; oldText: string; newText: string };
  image?: string;
}

export type ConfirmFn = (req: ToolApprovalRequest) => Promise<boolean>;

export interface ExecAuthorization {
  approvalToken: string;
  runId: string;
}

const MAX_MUTATION_BYTES = 16 * 1024 * 1024;
const MAX_REPLACEMENTS = 100_000;
const textEncoder = new TextEncoder();

function mutationSizeError(content: string): string | null {
  if (content.length > MAX_MUTATION_BYTES || textEncoder.encode(content).byteLength > MAX_MUTATION_BYTES) {
    return `File content exceeds the ${MAX_MUTATION_BYTES / (1024 * 1024)} MiB write limit.`;
  }
  return null;
}

function occurrenceCount(text: string, needle: string, replaceAll: boolean): number {
  const first = text.indexOf(needle);
  if (first < 0) return 0;
  if (!replaceAll) return 1;
  let count = 0;
  let at = first;
  while (at >= 0) {
    count += 1;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}

export function createOleaflyTools(
  host: AiToolsHost,
  opts?: {
    confirm?: ConfirmFn;
    onImage?: (dataUrl: string) => void;
    mutationAllowed?: () => boolean;
    /** When present, exposes the computer_use tool over this sandbox surface. */
    cuaSurface?: () => CuaSurface | null;
    alwaysConfirmComputerUse?: boolean;
    resolveExecCwd?: (projectId: string) => Promise<string>;
    authorizeExec?: (
      projectId: string,
      command: string,
      runIdOverride?: string,
    ) => Promise<ExecAuthorization>;
    execCommand?: (
      projectId: string,
      command: string,
      authorization: ExecAuthorization,
    ) => Promise<{
      command: string;
      output: string;
      exit_code: number | null;
      status: string;
      truncated: boolean;
      timed_out: boolean;
    }>;
  },
) {
  const confirm = opts?.confirm;
  const onImage = opts?.onImage;
  const {
    readFileContent,
    writeFileContent,
    createFile: apiCreateFile,
    deleteFile: apiDeleteFile,
    renameFile: apiRenameFile,
    setMainDoc: setMainDocCmd,
    listFiles,
    searchProject,
    extractPdfText,
  } = host;
  const pid = () => host.getProjectId();
  const mutationAllowed = () => opts?.mutationAllowed?.() ?? true;
  const assertMutationAllowed = (projectId: string) => {
    if (pid() !== projectId || !mutationAllowed()) {
      throw new Error("Project changed or the external request was cancelled before mutation.");
    }
  };
  const prepareMutation = async (projectId: string) => {
    assertMutationAllowed(projectId);
    const generation = await host.prepareExternalMutation(projectId);
    assertMutationAllowed(projectId);
    return generation;
  };
  const declined = (tool: string) => ({
    message: "The user declined this change.",
    declined: true as const,
    status: "declined" as const,
    tool,
  });
  const approveStateMutation = async (tool: string, summary: string): Promise<boolean> => {
    if (!opts?.mutationAllowed) return true;
    const projectId = pid();
    if (!projectId) throw new Error("No project open");
    if (confirm && !(await confirm({ tool, summary }))) return false;
    assertMutationAllowed(projectId);
    return true;
  };

  const tools: Record<string, RawToolDef> = {
    spawn_agent: {
      description:
        "Spawn a subagent that works on one delegated task in the background. Task names are canonical: spawning task_3 while your task is /root/task1 gives the agent the path /root/task1/task_3 (list_agents filters by that path). The agent inherits your current model unless the user asks for a different one. It shares your project tools and approval gates but cannot spawn further agents. Returns { id, taskPath, status } immediately; use wait_agent to collect its answer.",
      inputSchema: {
        type: "object",
        properties: {
          task_name: {
            type: "string",
            description: "Short unique name for the task (alphanumeric, _ and -)",
          },
          prompt: {
            type: "string",
            description: "Complete, self-contained instructions for the subagent",
          },
          label: {
            type: "string",
            description: "Optional display name shown while it works",
          },
        },
        required: ["task_name", "prompt"],
        additionalProperties: false,
      },
      // The backend intercepts the multi-agent tools before webview
      // dispatch; reaching this executor means the run is not agentic.
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    send_message: {
      description:
        "Send a message to a running agent without triggering a new turn; it is delivered at the agent's next message boundary. Use either message or items, not both.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent id or canonical task name" },
          message: { type: "string", description: "The message text" },
        },
        required: ["agent", "message"],
        additionalProperties: false,
      },
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    followup_task: {
      description:
        "Give an agent a new task and trigger a turn: a running agent receives it at its next boundary; a finished agent starts fresh work in its own thread with its prior answer as context.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent id or canonical task name" },
          message: { type: "string", description: "The new task" },
        },
        required: ["agent", "message"],
        additionalProperties: false,
      },
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    wait_agent: {
      description:
        "Wait for the listed agents and return whichever finishes first, with a bounded view of its final answer. Prefer longer waits (minutes) over busy polling. Pass multiple ids to wait on whichever finishes first.",
      inputSchema: {
        type: "object",
        properties: {
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Agent ids to wait on (omitting waits on all)",
          },
          timeout_ms: { type: "number", description: "Optional wait window in milliseconds" },
          max_output_chars: {
            type: "number",
            description: "Optional character budget for the returned answer",
          },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    interrupt_agent: {
      description:
        "Interrupt an agent's current turn, if any. The agent stays available for messages and follow-up tasks.",
      inputSchema: {
        type: "object",
        properties: { agent: { type: "string" } },
        required: ["agent"],
        additionalProperties: false,
      },
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    list_agents: {
      description:
        "List the live agents in this run with their canonical task paths and statuses. Optionally filter by task-path prefix.",
      inputSchema: {
        type: "object",
        properties: {
          path_prefix: { type: "string", description: "Canonical path prefix filter" },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    close_agent: {
      description:
        "Close an agent when its work is done. Completed agents stay open and count toward the concurrency limit until closed, so close agents you no longer need.",
      inputSchema: {
        type: "object",
        properties: { agent: { type: "string" } },
        required: ["agent"],
        additionalProperties: false,
      },
      execute: async () => ({ error: "subagents are only available in agentic runs" }),
    },
    read_file: {
      description:
        "Read a file in the current project. Prefer offset/limit for large files. Returns truncated content when over the size cap. Read another slice if needed.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path, e.g. 'main.tex', 'main.typ', or 'sections/intro.tex'" },
          offset: {
            type: "number",
            description: "1-based line number to start reading (default 1)",
          },
          limit: {
            type: "number",
            description: "Max number of lines to return (default: all remaining, hard-capped)",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const path = input.path as string;
        const offset = Math.max(1, Math.floor(Number(input.offset) || 1));
        const limitRaw = input.limit != null ? Math.floor(Number(input.limit)) : null;
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          const full = await readFileContent(id, path);
          const lines = full.split("\n");
          const start = Math.min(offset - 1, lines.length);
          const maxLines = 800;
          const take = Math.min(limitRaw != null && limitRaw > 0 ? limitRaw : maxLines, maxLines);
          const slice = lines.slice(start, start + take);
          let content = slice.join("\n");
          const MAX_CHARS = 40_000;
          let truncated = start + slice.length < lines.length;
          if (content.length > MAX_CHARS) {
            content = content.slice(0, MAX_CHARS);
            truncated = true;
          }
          // Legacy encodings decode lossily on the backend; flag it so the
          // model knows a rewrite would bake U+FFFD in permanently.
          const legacy = content.includes("\uFFFD");
          return {
            path,
            offset,
            lines_returned: slice.length,
            total_lines: lines.length,
            truncated,
            ...(legacy
              ? {
                  encoding: "lossy-utf8" as const,
                  encoding_note:
                    "This file contains bytes outside UTF-8 (likely a legacy encoding like Latin-1); unreadable characters appear as \uFFFD. Do not rewrite the whole file from this read — edit only the exact lines you must change.",
                }
              : {}),
            content,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    write_file: {
      description:
        "Write or overwrite a file in the current project. Use for editing document source, adding content, or fixing issues.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path" },
          content: {
            type: "string",
            maxLength: MAX_MUTATION_BYTES,
            description: "The full file content to write",
          },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path, content } = input as { path: string; content: string };
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          const sizeError = mutationSizeError(content);
          if (sizeError) return { error: sizeError };
          let expectedGeneration: number;
          if (confirm) {
            await prepareMutation(id);
            const oldText = await readFileContent(id, path).catch(() => "");
            if (!(await confirm({
              tool: "write_file",
              summary: `Write ${path}`,
              path,
              diff: { path, oldText, newText: content },
            }))) {
              return declined("write_file");
            }
            expectedGeneration = await prepareMutation(id);
            const latest = await readFileContent(id, path).catch(() => "");
            if (latest !== oldText) {
              return { error: `${path} changed while approval was pending. Review and retry.` };
            }
            assertMutationAllowed(id);
          } else {
            expectedGeneration = await prepareMutation(id);
          }
          await writeFileContent(id, path, content, expectedGeneration);
          if (!host.applyExternalWrite(id, path, content)) {
            return {
              error: `${path} changed locally while the external write was running. The local edit was preserved. Review and retry.`,
              conflict: true,
            };
          }
          return { success: true, path, bytes: content.length };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    replace_in_file: {
      description:
        "Replace occurrences of an exact string in a file. Prefer this over write_file for small, precise source fixes. Set replace_all=true to replace every occurrence. Fails if the find string is not present.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path" },
          find: {
            type: "string",
            minLength: 1,
            description: "Exact string to search for (verbatim, including backslashes)",
          },
          replace: {
            type: "string",
            maxLength: MAX_MUTATION_BYTES,
            description: "String to replace it with",
          },
          replace_all: { type: "boolean", description: "Replace every occurrence (default: false - first only)", default: false },
        },
        required: ["path", "find", "replace"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path, find, replace, replace_all } = input as {
          path: string; find: string; replace: string; replace_all?: boolean;
        };
        const id = pid();
        if (!id) return { error: "No project open" };
        if (!find) return { error: "find must not be empty" };
        try {
          let expectedGeneration = await prepareMutation(id);
          const original = await readFileContent(id, path);
          const count = occurrenceCount(original, find, !!replace_all);
          if (count === 0) {
            return { error: "find string not found in file", path };
          }
          const outputChars = original.length + count * (replace.length - find.length);
          if (!Number.isSafeInteger(outputChars) || outputChars > MAX_MUTATION_BYTES) {
            return { error: `Replacement output exceeds the ${MAX_MUTATION_BYTES / (1024 * 1024)} MiB write limit.` };
          }
          if (count > MAX_REPLACEMENTS) {
            return { error: `Replacement count exceeds the ${MAX_REPLACEMENTS.toLocaleString()} operation limit.` };
          }
          const idx = original.indexOf(find);
          const updated = replace_all
            ? original.replaceAll(find, () => replace)
            : original.slice(0, idx) + replace + original.slice(idx + find.length);
          const sizeError = mutationSizeError(updated);
          if (sizeError) return { error: sizeError };
          // Nothing has been written yet; declining leaves the file untouched.
          if (confirm && !(await confirm({
            tool: "replace_in_file",
            summary: `Edit ${path}`,
            path,
            diff: { path, oldText: original, newText: updated },
          }))) {
            return declined("replace_in_file");
          }
          expectedGeneration = await prepareMutation(id);
          const latest = await readFileContent(id, path);
          if (latest !== original) {
            return { error: `${path} changed while approval was pending. Review and retry.` };
          }
          assertMutationAllowed(id);
          await writeFileContent(id, path, updated, expectedGeneration);
          if (!host.applyExternalWrite(id, path, updated)) {
            return {
              error: `${path} changed locally while the external edit was running. The local edit was preserved. Review and retry.`,
              conflict: true,
            };
          }
          return { success: true, path, replacements: count };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    create_file: {
      description: "Create a new file or folder in the current project.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path for the new file or folder" },
          is_dir: { type: "boolean", description: "True to create a folder", default: false },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path, is_dir } = input as { path: string; is_dir?: boolean };
        const id = pid();
        if (!id) return { error: "No project open" };
        const summary = is_dir ? `Create folder ${path}` : `Create file ${path}`;
        if (confirm && !(await confirm({ tool: "create_file", summary, path }))) {
          return declined("create_file");
        }
        try {
          const expectedGeneration = await prepareMutation(id);
          await apiCreateFile(id, path, is_dir ?? false, expectedGeneration);
          await host.refreshTree(id);
          return { success: true, path, is_dir: is_dir ?? false };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    rename_file: {
      description: "Rename or move a file/folder to a new path.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Current project-relative path" },
          to: { type: "string", description: "New project-relative path" },
        },
        required: ["from", "to"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { from, to } = input as { from: string; to: string };
        const id = pid();
        if (!id) return { error: "No project open" };
        if (confirm && !(await confirm({ tool: "rename_file", summary: `Rename ${from} → ${to}`, path: from }))) {
          return declined("rename_file");
        }
        try {
          const expectedGeneration = await prepareMutation(id);
          await apiRenameFile(id, from, to, expectedGeneration);
          if (!host.applyExternalRename(id, from, to)) {
            return { error: "Project changed while the rename was running.", conflict: true };
          }
          return { success: true, from, to };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    delete_file: {
      description: "Delete a file or folder from the current project.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path of the file/folder to delete" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const path = input.path as string;
        const id = pid();
        if (!id) return { error: "No project open" };
        if (confirm && !(await confirm({ tool: "delete_file", summary: `Delete ${path}`, path }))) {
          return declined("delete_file");
        }
        try {
          const expectedGeneration = await prepareMutation(id);
          await apiDeleteFile(id, path, expectedGeneration);
          if (!host.applyExternalDelete(id, path)) {
            return {
              error: `${path} changed locally while deletion was running. Unsaved local edits were restored. Review and retry.`,
              conflict: true,
            };
          }
          return { success: true, path };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    compile: {
      description:
        "Compile the current document project to PDF with its selected engine. Persists the active editor file first, runs the build, and returns the outcome. Always check `success` and `errors`. If errors remain, read them, fix the file, then compile again until success is true.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        try {
          const result = await host.recompile();
          const log = result?.log ?? "";
          return {
            success: result?.ok ?? false,
            errors: result?.errors ?? [],
            has_pdf: result?.has_pdf ?? false,
            log_tail: log.slice(-4000),
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    get_log: {
      description:
        "Return the full document-engine compile log from the last compile. Use this when `compile` reports errors and you need surrounding context to diagnose them.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        const log = host.getCompileLog();
        if (!log) return { error: "No compile log yet. Run compile first." };
        return { log: log.slice(-20000) };
      },
    },

    get_pdf_text: {
      description:
        "Extract and return the text content of the last compiled PDF, page by page. Use to verify the rendered output (e.g. confirm a section, name, or link appears correctly).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        const bytes = host.getPdfBytes();
        if (!bytes) return { error: "No PDF available. Run compile first." };
        try {
          const { pages, numPages } = await extractPdfText(bytes);
          const body = pages
            .map((t, i) => `--- Page ${i + 1}/${numPages} ---\n${t.slice(0, 2000)}`)
            .join("\n\n");
          return { numPages, text: body.slice(0, 20000) };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    set_main_doc: {
      description: "Set the project's main document (the compile entry point, e.g. main.tex, main.typ, or main.md). Execution follows the active approval policy.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path of the new main document" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const path = input.path as string;
        const id = pid();
        if (!id) return { error: "No project open" };
        if (confirm && !(await confirm({
          tool: "set_main_doc",
          summary: `Set main document to ${path}`,
          path,
        }))) {
          return declined("set_main_doc");
        }
        try {
          await prepareMutation(id);
          const meta = await setMainDocCmd(id, path);
          return { success: true, main_doc: meta.main_doc };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    search_project: {
      description:
        "Search the CURRENT project's documents for a query string. Returns matching lines with file paths and line numbers. For broader topical retrieval of source chunks, relevant excerpts are also auto-injected each turn via project RAG.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text to search for" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const query = input.query as string;
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          const hits = await searchProject(id, query);
          return { results: hits, total: hits.length };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    list_files: {
      description: "List all files in the current project tree (read fresh from disk).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          const files = await listFiles(id);
          return { files };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    toggle_theme: {
      description: "Toggle the app between light and dark mode.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        try {
          if (!(await approveStateMutation("toggle_theme", "Toggle the application theme"))) {
            return declined("toggle_theme");
          }
          if (!mutationAllowed()) return { error: "The external request was cancelled before mutation." };
          window.dispatchEvent(new CustomEvent("oleafly:toggle-theme"));
          return { success: true };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    project_map: {
      description:
        "Get a structural map of the whole project: the section outline, labels, citation keys, macros, theorem and glossary names, included/imported files, and unresolved links. Typst @key uses are reported as ambiguous because the syntax can mean either a label reference or a citation. Call this before cross-cutting edits.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        const index = await host.getProjectIndex();
        if (!index) return { error: "No project open" };
        const of = (kind: string) => index.defs.filter((d) => d.kind === kind);
        return {
          files: of("file").map((d) => d.name),
          sections: of("section").map((d) => ({ title: d.name, level: d.level, file: d.file, line: d.line })),
          labels: of("label").map((d) => d.name),
          bibKeys: of("bibentry").map((d) => d.name),
          macros: of("macro").map((d) => d.name),
          theorems: of("theorem").map((d) => d.name),
          glossary: of("glossary").map((d) => d.name),
          inputGraph: index.uses
            .filter((u) => u.kind === "inputedge")
            .map((u) => ({ from: u.file, to: u.target })),
          unresolvedRefs: [...new Set(index.uses.filter((u) => u.kind === "ref" && !index.definitionFor(u)).map((u) => u.name))],
          unresolvedCites: [...new Set(index.uses.filter((u) => u.kind === "cite" && !index.definitionFor(u)).map((u) => u.name))],
          ambiguousTypstAtUses: [...new Set(index.uses.filter((u) => u.kind === "atuse").map((u) => u.name))],
        };
      },
    },

    update_todos: {
      description:
        "Create or replace the agent's plan checklist for this session. Use for multi-step work: set items to pending, mark the current one in_progress, complete items as you go. Keeps the user oriented.",
      inputSchema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            description: "Full replacement list of todo items",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable id for this item" },
                content: { type: "string", description: "Short task description" },
                status: {
                  type: "string",
                  description: "pending | in_progress | completed | cancelled",
                },
              },
              required: ["id", "content", "status"],
            },
          },
        },
        required: ["todos"],
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!(await approveStateMutation("update_todos", "Replace the agent checklist"))) {
          return declined("update_todos");
        }
        const raw = (input.todos as { id: string; content: string; status: string }[]) ?? [];
        const allowed = new Set(["pending", "in_progress", "completed", "cancelled"]);
        const todos = raw
          .filter((t) => t && t.id && t.content)
          .slice(0, 30)
          .map((t) => ({
            id: String(t.id).slice(0, 64),
            content: String(t.content).slice(0, 240),
            status: allowed.has(t.status) ? t.status : "pending",
          }));
        host.setAgentTodos(todos);
        return { success: true, count: todos.length, todos };
      },
    },

    get_todos: {
      description: "Read the current agent plan checklist (from update_todos).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => ({ todos: host.getAgentTodos() }),
    },

    remember_note: {
      description:
        "Save a short sticky note about this project for future agent turns (conventions, decisions, preferences). Use sparingly for durable facts the user would want remembered.",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "Note text for short, durable project knowledge" },
        },
        required: ["content"],
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!(await approveStateMutation("remember_note", "Save a project memory note"))) {
          return declined("remember_note");
        }
        return host.rememberNote(String(input.content ?? ""));
      },
    },

    forget_note: {
      description: "Remove a sticky project note by id (from remember_note / list_notes).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Note id" },
        },
        required: ["id"],
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!(await approveStateMutation("forget_note", "Remove a project memory note"))) {
          return declined("forget_note");
        }
        return host.forgetNote(String(input.id ?? ""));
      },
    },

    list_notes: {
      description: "List sticky project memory notes saved with remember_note.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => ({ notes: host.listNotes() }),
    },

    verify_pdf_pages: {
      description:
        "After a successful compile, inspect rendered PDF pages for layout issues (overflow, cut-off text, empty regions). Vision models receive page PNGs. Text-only models get page text excerpts. Prefer after structural edits. Respects the user setting that allows PDF page capture.",
      inputSchema: {
        type: "object",
        properties: {
          pages: {
            type: "array",
            items: { type: "number" },
            description: "Optional 1-based page numbers (default: first, last, and a few middle pages, max 4)",
          },
          max_pages: {
            type: "number",
            description: "Max pages to capture when pages is omitted (default 4, max 6)",
          },
        },
        required: [],
        additionalProperties: false,
      },
      execute: async (input) => {
        if (!host.getAiPdfCaptureEnabled()) {
          return {
            error:
              "PDF page capture is disabled in Settings → AI Assistant. Enable “Allow PDF page capture for AI” or use get_pdf_text instead.",
            capture_disabled: true,
          };
        }
        const bytes = host.getPdfBytes();
        if (!bytes) return { error: "No PDF available. Run compile first (and ensure it succeeds)." };
        try {
          const { pages: pageTexts, numPages } = await extractPdfText(bytes);
          if (!numPages) return { error: "PDF has no pages." };
          const maxPages = Math.min(6, Math.max(1, Math.floor(Number(input.max_pages) || 4)));
          let selected: number[];
          if (Array.isArray(input.pages) && input.pages.length) {
            selected = [
              ...new Set(
                (input.pages as number[])
                  .map((p) => Math.floor(Number(p)))
                  .filter((p) => p >= 1 && p <= numPages),
              ),
            ]
              .sort((a, b) => a - b)
              .slice(0, maxPages);
          } else {
            const cursorPage = host.getPdfCursorPage?.() ?? undefined;
            selected = pickPagesToVerify(numPages, {
              cursorPage: cursorPage ?? undefined,
              maxPages,
            });
          }
          const images: { page: number; dataUrl: string }[] = [];
          for (const page of selected) {
            try {
              const dataUrl = await host.pdfToPng(bytes, page, 1.5);
              images.push({ page, dataUrl });
            } catch {
              /* skip failed page raster */
            }
          }
          if (onImage) {
            for (const img of images) onImage(img.dataUrl);
          }
          const text = selected
            .map((p) => {
              const t = pageTexts[p - 1] ?? "";
              return `--- Page ${p}/${numPages} ---\n${t.slice(0, 1500)}`;
            })
            .join("\n\n");
          return {
            success: true,
            numPages,
            pages: selected,
            images_captured: images.length,
            // data URLs omitted from JSON echo to keep tool-result small; images go via onImage
            text: text.slice(0, 12000),
            note:
              images.length > 0
                ? "Page images were attached for vision models. Inspect for overflow, cut-off text, and empty regions."
                : "No images captured. Inspect text excerpts only.",
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  };

  if (opts?.execCommand && opts.resolveExecCwd && opts.authorizeExec) {
    const execCommand = opts.execCommand;
    const resolveExecCwd = opts.resolveExecCwd;
    const authorizeExec = opts.authorizeExec;
    tools.run_command = {
      description:
        "Run a shell command in the current project directory and return its output and exit status. Use for build tooling, git, file inspection, or scripts the dedicated tools do not cover. Execution follows the active approval policy.",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "A single shell command line, run from the project root",
          },
        },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const command = String(input.command ?? "").trim();
        if (!command) return { error: "command is required" };
        const projectId = pid();
        if (!projectId) return { error: "No project open" };
        if (!confirm) return { ...declined("run_command"), command };
        // A subagent tags its commands with its own execution owner so that
        // stopping the subagent cancels exactly its process tree. Absent for a
        // top-level run, which uses the run's own id.
        const ownerOverride =
          typeof input.__execOwner === "string" ? input.__execOwner : undefined;
        try {
          const cwd = await resolveExecCwd(projectId);
          assertMutationAllowed(projectId);
          if (!(await confirm({
            tool: "run_command",
            summary: `$ ${command}`,
            projectId,
            command,
            cwd,
          }))) {
            return { ...declined("run_command"), command };
          }
          assertMutationAllowed(projectId);
          const authorization = await authorizeExec(projectId, command, ownerOverride);
          assertMutationAllowed(projectId);
          const result = await execCommand(projectId, command, authorization);
          return {
            // Structured so the exec card renders command, output, and status;
            // the model also reads the flat fields.
            exec: true,
            command: result.command,
            output: result.output,
            exit_code: result.exit_code,
            status: result.status,
            timed_out: result.timed_out,
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    };
  }

  if (opts?.cuaSurface) {
    const getSurface = opts.cuaSurface;
    tools.computer_use = {
      description: opts.alwaysConfirmComputerUse
        ? "Drive the browser window: navigate to a URL, or wait for a page to load. It opens as a separate OS window whose page content cannot be read or scripted. Every navigation requires explicit user approval for external connections."
        : "Drive the browser window as a computer-use agent. It opens as a separate OS window, so the only supported actions are navigate (open a URL) and wait (pause while a page loads); the page's content cannot be read, captured, or clicked from here. navigate reports the resulting URL and follows the active approval policy.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["navigate", "wait"],
          },
          text: { type: "string", description: "URL to navigate to" },
          amount: { type: "number", description: "wait milliseconds" },
        },
        required: ["action"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const surface = getSurface();
        if (!surface) {
          return { error: "The browser window is unavailable; enable the web browser to use computer_use." };
        }
        const action = {
          type: input.action as CuaActionType,
          selector: input.selector as string | undefined,
          text: input.text as string | undefined,
          amount: input.amount as number | undefined,
        };
        if (opts.alwaysConfirmComputerUse || cuaActionRisk(action.type) === "confirm") {
          if (!confirm) return declined("computer_use");
          if (!(await confirm({
            tool: "computer_use",
            summary: `${action.type}${action.selector ? ` ${action.selector}` : action.text ? ` ${action.text}` : ""}`,
          }))) {
            return declined("computer_use");
          }
        }
        return runCuaAction(surface, action);
      },
    };
  }

  return tools;
}

function pngDataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 32_000_000;
type ImageDimensions = {
  mime: "image/png" | "image/jpeg" | "image/gif";
  width: number;
  height: number;
};

function imageTypeAndDimensions(bytes: Uint8Array): ImageDimensions | null {
  return pngDimensions(bytes) ?? gifDimensions(bytes) ?? jpegDimensions(bytes);
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24 || !hasBytePrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { mime: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 10 || !hasBytePrefix(bytes, [0x47, 0x49, 0x46])) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { mime: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 4 || !hasBytePrefix(bytes, [0xff, 0xd8])) return null;
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    const length = jpegSegmentLength(bytes, offset, marker);
    if (length === null) break;
    const dimensions = jpegFrameDimensions(bytes, offset, marker, length, startOfFrame);
    if (dimensions) return dimensions;
    offset += length;
  }
  return null;
}

function hasBytePrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function jpegSegmentLength(bytes: Uint8Array, offset: number, marker: number): number | null {
  if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) return null;
  const length = (bytes[offset] << 8) | bytes[offset + 1];
  return length >= 2 && offset + length <= bytes.length ? length : null;
}

function jpegFrameDimensions(
  bytes: Uint8Array,
  offset: number,
  marker: number,
  length: number,
  startOfFrame: ReadonlySet<number>,
): ImageDimensions | null {
  if (!startOfFrame.has(marker) || length < 7) return null;
  const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
  const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
  return { mime: "image/jpeg", width, height };
}

export function createFigureTools(
  host: AiToolsHost,
  opts?: {
    confirm?: ConfirmFn;
    onImage?: (dataUrl: string) => void;
    mutationAllowed?: () => boolean;
  },
) {
  const confirm = opts?.confirm;
  const onImage = opts?.onImage;
  const {
    compileIsolated,
    readIsolatedPdf,
    readProjectBytes,
    writeProjectBytes,
    pdfToPng: pdfPageToPng,
    setLastFigurePreview,
    getLastFigurePreview,
    getFigureInsertTarget,
    insertAtCursor,
    replaceRange,
  } = host;
  const pid = () => host.getProjectId();
  const mutationAllowed = () => opts?.mutationAllowed?.() ?? true;
  const assertMutationAllowed = (projectId: string) => {
    if (pid() !== projectId || !mutationAllowed()) {
      throw new Error("Project changed or the external request was cancelled before mutation.");
    }
  };
  const prepareMutation = async (projectId: string) => {
    assertMutationAllowed(projectId);
    const generation = await host.prepareExternalMutation(projectId);
    assertMutationAllowed(projectId);
    return generation;
  };
  const declined = (tool: string) => ({
    message: "The user declined this change.",
    declined: true as const,
    status: "declined" as const,
    tool,
  });

  const tools: Record<string, RawToolDef> = {
    preview_figure: {
      description:
        "Compile a figure in isolation and return the outcome. Pass `code` (a TikZ picture or other figure body), plus optional `packages` and `libraries` it needs. Returns { success, errors, log_tail }. Iterate: fix errors and call again until success is true.",
      inputSchema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The figure body, e.g. a \\begin{tikzpicture}...\\end{tikzpicture}",
          },
          packages: {
            type: "array",
            items: { type: "string" },
            description: "Extra LaTeX packages (tikz is always included)",
          },
          libraries: {
            type: "array",
            items: { type: "string" },
            description: "TikZ libraries, e.g. arrows.meta, positioning",
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { code, packages, libraries } = input as {
          code: string;
          packages?: string[];
          libraries?: string[];
        };
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          const source = buildStandaloneDoc({ code, packages, libraries });
          const result = await compileIsolated(id, source);
          let bytes: Uint8Array | null = null;
          if (result.has_pdf) {
            bytes = new Uint8Array(await readIsolatedPdf(id));
            setLastFigurePreview({ pdfBytes: bytes });
          } else {
            setLastFigurePreview(null);
          }
          // Hand the rendered image to the loop (Tier 2 vision refine).
          if (bytes && onImage) {
            try {
              onImage(await pdfPageToPng(bytes, 1, 2));
            } catch {
              /* rendering is best-effort; text refine still works */
            }
          }
          return {
            success: result.ok,
            errors: result.errors,
            has_pdf: result.has_pdf,
            log_tail: (result.log ?? "").slice(-4000),
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    insert_figure: {
      description:
        "Insert the finished figure into the document at the user's cursor (or the selected paragraph it was generated from), and save a PNG copy to figures/. Provide the final `code`, and optionally a `caption` and `label`. Set raw=true to insert the bare code without a figure environment.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "The final figure body" },
          caption: { type: "string", description: "Figure caption (omit for none)" },
          label: { type: "string", description: "Figure label, e.g. fig:transformer" },
          raw: {
            type: "boolean",
            description: "Insert the bare code without a figure environment",
            default: false,
          },
        },
        required: ["code"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { code, caption, label, raw } = input as {
          code: string;
          caption?: string;
          label?: string;
          raw?: boolean;
        };
        const id = pid();
        if (!id) return { error: "No project open" };
        const normalizedCode = normalizeFigureCode(code);
        const latex = raw
          ? normalizedCode
          : `\\begin{figure}[htbp]\n\\centering\n${normalizedCode}\n` +
            (caption ? `\\caption{${caption}}\n` : "") +
            (label ? `\\label{${label}}\n` : "") +
            `\\end{figure}`;
        // Render the compiled figure so the user sees what they are approving.
        const preview = getLastFigurePreview();
        let png: string | null = null;
        if (preview) {
          try {
            png = await pdfPageToPng(preview.pdfBytes, 1, 2);
          } catch {
            /* preview render is best-effort */
          }
        }
        if (
          confirm &&
          !(await confirm({
            tool: "insert_figure",
            summary: "Insert this figure into the document",
            ...(png ? { image: png } : {}),
          }))
        ) {
          return declined("insert_figure");
        }
        try {
          await prepareMutation(id);
        } catch (e) {
          return { error: String(e) };
        }
        const target = getFigureInsertTarget();
        const inserted = target
          ? await replaceRange(id, target.from, target.to, latex, mutationAllowed)
          : await insertAtCursor(id, latex, mutationAllowed);
        if (!inserted) return { error: "No editable document is open" };
        try {
          if (png) {
            const name = slugifyFigureName(caption || label || "figure");
            const expectedGeneration = await prepareMutation(id);
            await writeProjectBytes(
              id,
              `figures/${name}.png`,
              pngDataUrlToBase64(png),
              expectedGeneration,
            );
            await host.refreshTree(id);
          }
        } catch {
          /* saving the raster copy is optional; the LaTeX is already inserted */
        }
        return { success: true };
      },
    },

    load_image: {
      description:
        "Load an image already in the project (e.g. a hand-drawn sketch the user added) so you can look at it and reproduce it as a figure. Pass its project-relative path.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Project-relative image path, e.g. sketch.png",
          },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const path = input.path as string;
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          const bytes = new Uint8Array(await readProjectBytes(id, path));
          if (bytes.byteLength > MAX_IMAGE_BYTES) {
            return { error: `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)} MiB limit.` };
          }
          const image = imageTypeAndDimensions(bytes);
          if (!image || image.width <= 0 || image.height <= 0) {
            return { error: "Only valid PNG, JPEG, and GIF images are supported." };
          }
          if (image.width * image.height > MAX_IMAGE_PIXELS) {
            return { error: `Image dimensions exceed the ${MAX_IMAGE_PIXELS.toLocaleString()} pixel limit.` };
          }
          const b64 = bytesToBase64(bytes);
          if (onImage) onImage(`data:${image.mime};base64,${b64}`);
          return { loaded: true, path, width: image.width, height: image.height };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  };

  return tools;
}
