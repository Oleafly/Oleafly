import { jsonSchema } from "ai";
import {
  readFileContent,
  writeFileContent,
  createFile as apiCreateFile,
  deleteFile as apiDeleteFile,
  renameFile as apiRenameFile,
  setMainDocCmd,
  listFiles,
  searchProject,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { extractPdfText } from "@/lib/pdf-text";

const pid = () => useFilesStore.getState().projectId;
const store = () => useFilesStore.getState();
const compile = () => useCompileStore.getState();

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

/** A request to the user to approve a destructive AI edit before it runs. */
export interface ToolApprovalRequest {
  /** The tool being called, e.g. "delete_file". */
  tool: string;
  /** One-line summary of what will happen (e.g. `Delete sections/intro.tex`). */
  summary: string;
  /** The primary path affected, when there is one. */
  path?: string;
}

/**
 * Ask the user to approve a destructive edit. Returns true to proceed, false to
 * decline. When no callback is provided (e.g. a non-interactive context), edits
 * proceed as before.
 */
export type ConfirmFn = (req: ToolApprovalRequest) => Promise<boolean>;

export function createOpenLeafTools(opts?: { confirm?: ConfirmFn }) {
  const confirm = opts?.confirm;
  const declined = (tool: string) => ({
    error: "The user declined this change.",
    declined: true as const,
    tool,
  });

  const tools: Record<string, RawToolDef> = {
    read_file: {
      description:
        "Read the full contents of a file in the current project.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative file path, e.g. 'main.tex' or 'sections/intro.tex'" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const path = input.path as string;
        const id = pid();
        if (!id) return { error: "No project open" };
        try {
          return { path, content: await readFileContent(id, path) };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    write_file: {
      description:
        "Write or overwrite a file in the current project. Use for editing LaTeX, adding content, or fixing issues.",
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
        if (confirm && !(await confirm({ tool: "write_file", summary: `Write ${path}`, path }))) {
          return declined("write_file");
        }
        try {
          await writeFileContent(id, path, content);
          store().applyExternalWrite(path, content);
          return { success: true, path, bytes: content.length };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    replace_in_file: {
      description:
        "Replace occurrences of an exact string in a file. Prefer this over write_file for small, precise fixes (e.g. fixing a single LaTeX command). Set replace_all=true to replace every occurrence. Fails if the find string is not present.",
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
        if (confirm && !(await confirm({ tool: "replace_in_file", summary: `Edit ${path}`, path }))) {
          return declined("replace_in_file");
        }
        try {
          const original = await readFileContent(id, path);
          if (!original.includes(find)) {
            return { error: "find string not found in file", path };
          }
          const count = replace_all ? original.split(find).length - 1 : 1;
          const updated = replace_all
            ? original.split(find).join(replace)
            : original.replace(find, replace);
          await writeFileContent(id, path, updated);
          store().applyExternalWrite(path, updated);
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
        try {
          await apiCreateFile(id, path, is_dir ?? false);
          await store().refreshTree();
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
          store().applyExternalRename(from, to);
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
          store().applyExternalDelete(path);
          return { success: true, path };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    compile: {
      description:
        "Compile the current LaTeX project to PDF. Persists the active editor file first, runs the build, and returns the outcome. Always check `success` and `errors`; if errors remain, read them, fix the file, then compile again until success is true.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        try {
          const result = await compile().recompile();
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
        "Return the full LaTeX compile log from the last compile. Use this when `compile` reports errors and you need surrounding context to diagnose them.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      execute: async () => {
        const log = compile().log;
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
        const bytes = compile().pdfBytes;
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
      description: "Set the project's main document (the compile entry point, e.g. main.tex).",
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
        try {
          const meta = await setMainDocCmd(id, path);
          useFilesStore.setState({ mainDoc: meta.main_doc });
          return { success: true, main_doc: meta.main_doc };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },

    search_project: {
      description: "Search the CURRENT project's documents for a query string. Returns matching lines with file paths and line numbers.",
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
          window.dispatchEvent(new CustomEvent("localleaf:toggle-theme"));
          return { success: true };
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
