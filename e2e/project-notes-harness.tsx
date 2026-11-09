import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { FileEntry, ProjectInfo } from "@oleafly/backend-port";
import { installNotesAgentMock } from "./notes-agent-mock";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

const PLAN = [
  "---",
  "title: Lab plan",
  "kind: note",
  "id: 6f1e2d3c-1111-4a2b-8c9d-0e1f2a3b4c5d",
  "icon: lucide:atom",
  "color: mint",
  "---",
  "",
  "Run the sweep twice.",
  "",
].join("\n");
const PERSONAL = "---\ntitle: Reading list\nkind: note\nicon: lucide:book\ncolor: rose\n---\n\nPapers to read.\n";
const MAIN = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";

function project(id: string, overrides: Partial<ProjectInfo>): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "main.tex",
    kind: "document",
    created_at: 1,
    updated_at: Math.floor(Date.now() / 1000) - 120,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

const PROJECTS = [
  project("paper", { name: "Paper" }),
  project("mine", { name: "Reading list", kind: "note", main_doc: "note.md", related_project: "paper" }),
];

const disk = new Map<string, string>([
  ["paper/main.tex", MAIN],
  ["paper/notes/Plan.md", PLAN],
  ["mine/note.md", PERSONAL],
]);
const writes: { projectId: string; path: string; content: string }[] = [];

function tree(projectId: string): FileEntry[] {
  return [...disk.keys()]
    .filter((key) => key.startsWith(`${projectId}/`))
    .map((key) => ({ path: key.slice(projectId.length + 1), is_dir: false }));
}

mockWindows("main");
installNotesAgentMock({ configured: false, delayMs: 0 });
const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown, options?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
const fallback = internals.invoke.bind(internals);

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  read_file: (args) => {
    const text = disk.get(`${String(args.projectId)}/${String(args.path)}`);
    if (text === undefined) throw new Error(`missing ${String(args.path)}`);
    return text;
  },
  write_file: (args) => {
    const projectId = String(args.projectId);
    const path = String(args.path);
    const content = String(args.content);
    disk.set(`${projectId}/${path}`, content);
    writes.push({ projectId, path, content });
    return { generation: writes.length + 1 };
  },
  project_mutation_generation: () => writes.length + 1,
  note_heads: () => [{ id: "mine", head: disk.get("mine/note.md") ?? "" }],
  note_links: () => [],
  note_tags: () => [],
  note_search: () => [],
  list_files: (args) => tree(String(args.projectId)),
  watch_project_folder: () => 1,
  unwatch_project_folder: () => null,
  project_citations: () => [],
  list_projects: () => PROJECTS,
};

mockIPC(
  (command, args) => {
    const handler = handlers[command];
    if (handler) return handler((args ?? {}) as Record<string, unknown>);
    return fallback(command, args);
  },
  { shouldMockEvents: true },
);

Object.assign(window, { __writes: writes, __disk: disk });

await prepareHarnessI18n();
const [{ createRoot }, { loadNamespace }, files, settings, { Editor }, { ProjectNotesPanel }, { ThemeProvider }, query, react] =
  await Promise.all([
    import("react-dom/client"),
    import("/src/i18n"),
    import("/src/store/files"),
    import("/src/store/settings"),
    import("/src/components/editor/Editor"),
    import("/src/components/notes/ProjectNotesPanel"),
    import("/src/lib/theme"),
    import("@tanstack/react-query"),
    import("react"),
  ]);
await Promise.all(["notes", "editor", "common", "ai", "collab", "shell"].map((namespace) => loadNamespace(namespace)));

settings.useSettingsStore.setState({ notes: true });
files.useFilesStore.setState({
  projectId: "paper",
  projectName: "Paper",
  projectKind: "document",
  projects: PROJECTS,
  projectsLoaded: true,
  tree: tree("paper"),
  files: {
    "main.tex": { content: MAIN, dirty: false },
    "notes/Plan.md": { content: PLAN, dirty: false },
  },
  openTabs: ["main.tex", "notes/Plan.md"],
  tabOrder: { "main.tex": 1, "notes/Plan.md": 2 },
  assistantTabs: [],
  activePath: "notes/Plan.md",
  changedOnDisk: [],
  refreshProjects: async () => {},
});

const root = document.getElementById("root");
if (!root) throw new Error("Project notes fixture root is missing");
const client = new query.QueryClient();
createRoot(root).render(
  react.createElement(
    ThemeProvider,
    null,
    react.createElement(
      query.QueryClientProvider,
      { client },
      react.createElement(
        "div",
        { className: "flex h-screen" },
        react.createElement("aside", { className: "w-72 shrink-0 border-r" }, react.createElement(ProjectNotesPanel)),
        react.createElement("main", { className: "min-w-0 flex-1" }, react.createElement(Editor)),
      ),
    ),
  ),
);
document.body.dataset.fixtureState = "mounted";
