import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import {
  CornerDownLeft,
  FileText,
  FolderOpen,
  Link2,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Workflow,
} from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useTheme } from "@/lib/theme";
import { searchDocs, type SearchHit } from "@/lib/tauri";
import { gotoLine } from "@/components/editor/cm/controller";
import { cn } from "@/lib/utils";

function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

type Mode = "all" | "projects" | "docs" | "refs" | "create" | "theme" | "settings" | "help";

// Slash commands and their aliases. `/create`, `/theme`, `/settings` are actions
// (Enter runs them); `/projects`, `/docs`, `/refs` scope the search.
const SLASH: { keys: string[]; mode: Mode; hint: string }[] = [
  { keys: ["create", "new"], mode: "create", hint: "open the template gallery" },
  { keys: ["projects", "p"], mode: "projects", hint: "search your projects" },
  { keys: ["docs", "search"], mode: "docs", hint: "search inside documents" },
  { keys: ["refs"], mode: "refs", hint: "open references for this project" },
  { keys: ["theme"], mode: "theme", hint: "toggle light / dark" },
  { keys: ["settings"], mode: "settings", hint: "open settings" },
];

function parse(q: string): { mode: Mode; term: string; cmd: string } {
  if (!q.startsWith("/")) return { mode: "all", term: q, cmd: "" };
  const m = q.slice(1).match(/^(\S*)\s*([\s\S]*)$/);
  const cmd = (m?.[1] ?? "").toLowerCase();
  const term = m?.[2] ?? "";
  const found = SLASH.find((s) => s.keys.includes(cmd));
  if (found) return { mode: found.mode, term, cmd };
  return { mode: "help", term: q, cmd };
}

export function SearchOmnibar() {
  const open = useSettingsStore((s) => s.searchOpen);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setRailTab = useSettingsStore((s) => s.setRailTab);
  const projects = useFilesStore((s) => s.projects);
  const projectId = useFilesStore((s) => s.projectId);
  const openProject = useFilesStore((s) => s.openProject);
  const openFile = useFilesStore((s) => s.openFile);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  const { mode, term } = useMemo(() => parse(query), [query]);
  const trimmed = term.trim();

  // Make sure the project list is fresh whenever the omnibar opens.
  useEffect(() => {
    if (open) void refreshProjects().catch(() => {});
  }, [open, refreshProjects]);

  // Document text search (backend), for the "all" and "docs" scopes only.
  useEffect(() => {
    const wantDocs = mode === "all" || mode === "docs";
    if (!wantDocs || !trimmed) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        setHits(await searchDocs(trimmed));
      } catch {
        setHits([]);
      }
      setLoading(false);
    }, 200);
    return () => clearTimeout(t);
  }, [trimmed, mode]);

  // ⌘/Ctrl + Shift + F toggles the omnibar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(!useSettingsStore.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  const close = () => {
    setSearchOpen(false);
    setQuery("");
    setHits([]);
  };

  const matchedProjects = useMemo(() => {
    if (mode !== "all" && mode !== "projects") return [];
    const q = trimmed.toLowerCase();
    const list = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
    return list.slice(0, mode === "projects" ? 30 : 6);
  }, [projects, trimmed, mode]);

  // Top-level commands, filtered by the typed term in the default scope.
  const commands = useMemo(() => {
    const all = [
      {
        id: "create",
        label: "Create a new project",
        kw: "new project create template gallery",
        icon: <Plus className="size-4" />,
        run: () => setNewProjectOpen(true),
      },
      {
        id: "theme",
        label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
        kw: "theme dark light appearance mode",
        icon: theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />,
        run: toggleTheme,
      },
      // Figures insert into an open document, so only offer this with a project open.
      ...(projectId
        ? [
            {
              id: "figure",
              label: "Generate a figure with AI",
              kw: "figure diagram draw tikz plot chart illustration",
              icon: <Sparkles className="size-4" />,
              run: () => {
                const s = useSettingsStore.getState();
                s.setRailTab("ai");
                if (!s.showTree) s.toggleTree();
                s.setFigureModeOpen(true);
              },
            },
            {
              id: "diagram",
              label: "Insert a diagram (manual)",
              kw: "diagram figure tikz manual composer draw insert paste",
              icon: <Workflow className="size-4" />,
              run: () => useSettingsStore.getState().setDiagramComposerOpen(true),
            },
          ]
        : []),
      {
        id: "settings",
        label: "Open settings",
        kw: "settings preferences options",
        icon: <Settings className="size-4" />,
        run: () => setSettingsOpen(true),
      },
    ];
    if (mode !== "all") return [];
    const q = trimmed.toLowerCase();
    return q ? all.filter((c) => (c.label + " " + c.kw).toLowerCase().includes(q)) : all;
  }, [trimmed, mode, theme, toggleTheme, setNewProjectOpen, setSettingsOpen, projectId]);

  const runProject = async (id: string) => {
    close();
    await openProject(id);
  };
  const openHit = async (hit: SearchHit) => {
    close();
    await openProject(hit.project_id);
    await openFile(hit.path);
    window.setTimeout(() => gotoLine(hit.line), 120);
  };
  const runAction = (fn: () => void) => {
    close();
    fn();
  };

  const placeholder =
    mode === "projects"
      ? "Search projects…"
      : mode === "docs"
        ? "Search inside documents…"
        : "Search projects, documents, or type / for commands…";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={(v) => (v ? setSearchOpen(true) : close())}
      label="Search"
      shouldFilter={false}
      className="fixed left-1/2 top-[18%] z-50 w-[min(660px,92vw)] -translate-x-1/2"
    >
      <div className="overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            autoFocus
            placeholder={placeholder}
            className="flex h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <span className="shrink-0 text-xs text-muted-foreground">
            {loading ? "…" : ""}
          </span>
        </div>

        <Command.List className="max-h-[min(60vh,440px)] overflow-auto p-1.5">
          {/* Immediate actions for action slash-commands. */}
          {mode === "create" && (
            <Group heading="Action">
              <Row
                icon={<Plus className="size-4" />}
                title="Create a new project"
                hint="Enter"
                onSelect={() => runAction(() => setNewProjectOpen(true))}
              />
            </Group>
          )}
          {mode === "theme" && (
            <Group heading="Action">
              <Row
                icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
                hint="Enter"
                onSelect={() => runAction(toggleTheme)}
              />
            </Group>
          )}
          {mode === "settings" && (
            <Group heading="Action">
              <Row
                icon={<Settings className="size-4" />}
                title="Open settings"
                hint="Enter"
                onSelect={() => runAction(() => setSettingsOpen(true))}
              />
            </Group>
          )}
          {mode === "refs" && (
            <Group heading="References">
              {projectId ? (
                <Row
                  icon={<Link2 className="size-4" />}
                  title="Open references for this project"
                  hint="Enter"
                  onSelect={() => runAction(() => setRailTab("refs"))}
                />
              ) : (
                <Hint>Open a project first to browse its references.</Hint>
              )}
            </Group>
          )}

          {/* Commands (default scope). */}
          {commands.length > 0 && (
            <Group heading="Commands">
              {commands.map((c) => (
                <Row
                  key={c.id}
                  icon={c.icon}
                  title={c.label}
                  onSelect={() => runAction(c.run)}
                />
              ))}
            </Group>
          )}

          {/* Projects, shown before document matches. */}
          {matchedProjects.length > 0 && (
            <Group heading="Projects">
              {matchedProjects.map((p) => (
                <Row
                  key={p.id}
                  icon={<FolderOpen className="size-4" />}
                  title={p.name}
                  hint={p.updated_at > 0 ? new Date(p.updated_at * 1000).toLocaleDateString() : undefined}
                  onSelect={() => void runProject(p.id)}
                />
              ))}
            </Group>
          )}

          {/* Document text matches. */}
          {(mode === "all" || mode === "docs") && hits.length > 0 && (
            <Group heading="Documents">
              {hits.map((hit, i) => (
                <Command.Item
                  key={`${hit.project_id}:${hit.path}:${hit.line}:${i}`}
                  value={`doc-${i}`}
                  onSelect={() => void openHit(hit)}
                  className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{basename(hit.path)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {hit.project_name} · {hit.path} : {hit.line}
                    </span>
                  </div>
                  <PreviewLine preview={hit.preview} query={trimmed} />
                </Command.Item>
              ))}
            </Group>
          )}

          {/* Empty / help states. */}
          {mode === "help" && (
            <Hint>Unknown command. Try /create, /projects, /docs, /refs, /theme, or /settings.</Hint>
          )}
          {mode === "all" &&
            !trimmed &&
            commands.length === 0 &&
            matchedProjects.length === 0 && <SlashHelp />}
          {(mode === "all" || mode === "docs" || mode === "projects") &&
            trimmed &&
            !loading &&
            hits.length === 0 &&
            matchedProjects.length === 0 &&
            commands.length === 0 && <Hint>No matches found.</Hint>}
        </Command.List>

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CornerDownLeft className="size-3" /> open
          </span>
          <span>/ for commands</span>
        </div>
      </div>
    </Command.Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className="px-1 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
    >
      {children}
    </Command.Group>
  );
}

function Row({
  icon,
  title,
  hint,
  onSelect,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={title}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{title}</span>
      {hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{hint}</span>}
    </Command.Item>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function SlashHelp() {
  return (
    <div className="px-2 py-2">
      <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Try a command</p>
      {SLASH.map((s) => (
        <div key={s.keys[0]} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/{s.keys[0]}</code>
          <span className="text-xs text-muted-foreground">{s.hint}</span>
        </div>
      ))}
    </div>
  );
}

function PreviewLine({ preview, query }: { preview: string; query: string }) {
  if (!query.trim()) return <span className="truncate text-xs text-muted-foreground">{preview}</span>;
  const idx = preview.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0)
    return <span className="truncate font-mono text-xs text-muted-foreground">{preview}</span>;
  return (
    <span className={cn("truncate font-mono text-xs text-muted-foreground")}>
      {preview.slice(0, idx)}
      <mark className="rounded-sm bg-primary/25 px-0.5 text-foreground">
        {preview.slice(idx, idx + query.length)}
      </mark>
      {preview.slice(idx + query.length)}
    </span>
  );
}
