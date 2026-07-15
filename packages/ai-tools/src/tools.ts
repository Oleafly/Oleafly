import { jsonSchema } from "ai";
import { buildStandaloneDoc, slugifyFigureName, bytesToBase64 } from "@openleaf/latex";
import { pickPagesToVerify } from "./pick-pages";

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
  writeFileContent(projectId: string, path: string, content: string): Promise<void>;
  createFile(projectId: string, path: string, isDir: boolean): Promise<unknown>;
  deleteFile(projectId: string, path: string): Promise<unknown>;
  renameFile(projectId: string, from: string, to: string): Promise<unknown>;
  setMainDoc(projectId: string, path: string): Promise<{ main_doc: string }>;
  listFiles(projectId: string): Promise<unknown[]>;
  searchProject(projectId: string, query: string): Promise<unknown[]>;
  readProjectBytes(projectId: string, path: string): Promise<ArrayBuffer | ArrayLike<number>>;
  writeProjectBytes(projectId: string, relPath: string, dataBase64: string): Promise<void>;
  // Reflect completed tool actions into the app's open-editor state.
  applyExternalWrite(path: string, content: string): void;
  applyExternalRename(from: string, to: string): void;
  applyExternalDelete(path: string): void;
  refreshTree(): Promise<void>;
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
  insertAtCursor(text: string): void;
  replaceRange(from: number, to: number, text: string): void;
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
  path?: string;
  diff?: { path: string; oldText: string; newText: string };
  image?: string;
}

export type ConfirmFn = (req: ToolApprovalRequest) => Promise<boolean>;

export function createOpenLeafTools(
  host: AiToolsHost,
  opts?: { confirm?: ConfirmFn; onImage?: (dataUrl: string) => void },
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
  const declined = (tool: string) => ({
    error: "The user declined this change.",
    declined: true as const,
    tool,
  });

  const tools: Record<string, RawToolDef> = {
    read_file: {
      description:
        "Read a file in the current project. Prefer offset/limit for large files. Returns truncated content when over the size cap; re-read another slice if needed.",
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
          return {
            path,
            offset,
            lines_returned: slice.length,
            total_lines: lines.length,
            truncated,
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
          content: { type: "string", description: "The full file content to write" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path, content } = input as { path: string; content: string };
        const id = pid();
        if (!id) return { error: "No project open" };
        if (confirm) {
          const oldText = await readFileContent(id, path).catch(() => "");
          if (!(await confirm({
            tool: "write_file",
            summary: `Write ${path}`,
            path,
            diff: { path, oldText, newText: content },
          }))) {
            return declined("write_file");
          }
        }
        try {
          await writeFileContent(id, path, content);
          host.applyExternalWrite(path, content);
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
          find: { type: "string", description: "Exact string to search for (verbatim, including backslashes)" },
          replace: { type: "string", description: "String to replace it with" },
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
        try {
          const original = await readFileContent(id, path);
          if (!original.includes(find)) {
            return { error: "find string not found in file", path };
          }
          const count = replace_all ? original.split(find).length - 1 : 1;
          // Both branches replace literally: String.prototype.replace with a
          // string pattern would interpret `$$`, `$&`, `` $` ``, `$'`, `$1`.. in
          // the AI-supplied `replace` text and corrupt LaTeX (e.g. `$$` -> `$`).
          // Splice the first occurrence in by index instead.
          const idx = original.indexOf(find);
          const updated = replace_all
            ? original.split(find).join(replace)
            : original.slice(0, idx) + replace + original.slice(idx + find.length);
          // Nothing has been written yet; declining leaves the file untouched.
          if (confirm && !(await confirm({
            tool: "replace_in_file",
            summary: `Edit ${path}`,
            path,
            diff: { path, oldText: original, newText: updated },
          }))) {
            return declined("replace_in_file");
          }
          await writeFileContent(id, path, updated);
          host.applyExternalWrite(path, updated);
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
          await apiCreateFile(id, path, is_dir ?? false);
          await host.refreshTree();
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
          await apiRenameFile(id, from, to);
          host.applyExternalRename(from, to);
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
          await apiDeleteFile(id, path);
          host.applyExternalDelete(path);
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
      description: "Set the project's main document (the compile entry point, e.g. main.tex, main.typ, or main.md). Requires user approval.",
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
          return { results: hits.slice(0, 20), total: hits.length };
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
          window.dispatchEvent(new CustomEvent("openleaf:toggle-theme"));
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
          content: { type: "string", description: "Note text (short; durable project knowledge)" },
        },
        required: ["content"],
        additionalProperties: false,
      },
      execute: async (input) => host.rememberNote(String(input.content ?? "")),
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
      execute: async (input) => host.forgetNote(String(input.id ?? "")),
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
        "After a successful compile, inspect rendered PDF pages for layout issues (overflow, cut-off text, empty regions). Vision models receive page PNGs; text-only models get page text excerpts. Prefer after structural edits. Respects the user setting that allows PDF page capture.",
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
                : "No images captured; inspect text excerpts only.",
          };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  };

  const wrapped: Record<
    string,
    {
      description: string;
      inputSchema: ReturnType<typeof jsonSchema>;
      execute: RawToolDef["execute"];
    }
  > = {};
  for (const [name, def] of Object.entries(tools)) {
    wrapped[name] = {
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema),
      execute: def.execute,
    };
  }
  return wrapped;
}

function pngDataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function createFigureTools(
  host: AiToolsHost,
  opts?: {
    confirm?: ConfirmFn;
    onImage?: (dataUrl: string) => void;
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
  const declined = (tool: string) => ({
    error: "The user declined this change.",
    declined: true as const,
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
        "Insert the finished figure into the document at the user's cursor (or the selected paragraph it was generated from), and save a PNG copy to figures/. Provide the final `code`, and optionally a `caption` and `label`; set raw=true to insert the bare code without a figure environment.",
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
        const latex = raw
          ? code
          : `\\begin{figure}[htbp]\n\\centering\n${code}\n` +
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
        const target = getFigureInsertTarget();
        if (target) replaceRange(target.from, target.to, latex);
        else insertAtCursor(latex);
        try {
          if (png) {
            const name = slugifyFigureName(caption || label || "figure");
            await writeProjectBytes(id, `figures/${name}.png`, pngDataUrlToBase64(png));
            await host.refreshTree();
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
          const lower = path.toLowerCase();
          const mime =
            lower.endsWith(".jpg") || lower.endsWith(".jpeg")
              ? "image/jpeg"
              : lower.endsWith(".gif")
                ? "image/gif"
                : "image/png";
          const b64 = bytesToBase64(bytes);
          if (onImage) onImage(`data:${mime};base64,${b64}`);
          return { loaded: true, path };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  };

  const wrapped: Record<
    string,
    {
      description: string;
      inputSchema: ReturnType<typeof jsonSchema>;
      execute: RawToolDef["execute"];
    }
  > = {};
  for (const [name, def] of Object.entries(tools)) {
    wrapped[name] = {
      description: def.description,
      inputSchema: jsonSchema(def.inputSchema),
      execute: def.execute,
    };
  }
  return wrapped;
}
