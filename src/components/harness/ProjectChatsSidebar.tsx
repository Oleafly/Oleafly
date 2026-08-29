import { useMemo, useState, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  ArrowDownUp,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  MessageSquare,
  MessageSquarePlus,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { gitHeadOid, loadProjectChats, type ProjectInfo } from "@/lib/tauri";
import { useChatsStore, type StoredChat } from "@/store/chats";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// Minimal chat projection for projects that are not currently open: the tree
// only needs identity + recency, never message bodies.
interface SidebarChat {
  id: string;
  title: string;
  updatedAt: number;
}

function parseSidebarChats(raw: string): SidebarChat[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c): c is StoredChat => !!c && typeof c === "object" && "id" in c)
      .map((c) => ({
        id: String(c.id),
        title: c.title || "Untitled chat",
        updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

// Projects start collapsed (every group closed until the user opens it); only
// explicitly expanded groups persist.
const EXPANDED_KEY = "oleafly.harness.sidebar-expanded";
const RECENTS_COUNT = 8;

type SortMode = "recent" | "name";

const chatTime = (ms: number) => {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

function SectionHeader({
  onMenu,
  children,
}: {
  onMenu?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 pb-1.5 pt-3">
      <p className="px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {children}
      </p>
      {onMenu && (
        <button
          type="button"
          aria-label="Project list options"
          data-testid="harness-projects-menu"
          onClick={onMenu}
          className="ml-auto mr-0.5 rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
        >
          <MoreVertical className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// The composer's navigation: New task + search on top, Projects as
// collapsible groups (closed by default, dimmed like the reference), and
// Recents as a flat cross-project list of the latest threads.
export function ProjectChatsSidebar() {
  const projects = useFilesStore((s) => s.projects);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);

  const currentChats = useChatsStore((s) => s.chats);
  const activeChatId = useChatsStore((s) => s.activeId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_KEY);
      const ids = raw ? (JSON.parse(raw) as string[]) : [];
      return Object.fromEntries(ids.map((id) => [id, true]));
    } catch {
      return {};
    }
  });

  const setGroupExpanded = (id: string, isExpanded: boolean) => {
    setExpanded((prev) => {
      const next = { ...prev, [id]: isExpanded };
      try {
        window.localStorage.setItem(
          EXPANDED_KEY,
          JSON.stringify(Object.keys(next).filter((k) => next[k])),
        );
      } catch {
        /* non-persistent contexts (tests) keep in-memory state only */
      }
      return next;
    });
  };

  // Threads of projects that are not currently open are read from disk on
  // demand; the open project reads from the store. Recents needs every
  // project's threads, so the queries run unconditionally and expand merely
  // decides whether the group renders.
  const others = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["project-chats-sidebar", p.id],
      queryFn: async () => parseSidebarChats(await loadProjectChats(p.id)),
      enabled: p.id !== projectId,
      staleTime: 15_000,
    })),
  });
  const chatsByProject = useMemo(() => {
    const map = new Map<string, SidebarChat[]>();
    projects.forEach((p, i) => {
      if (p.id === projectId) {
        map.set(
          p.id,
          currentChats.map((c) => ({
            id: c.id,
            title: c.title || "Untitled chat",
            updatedAt: c.updatedAt,
          })),
        );
      } else {
        map.set(p.id, others[i].data ?? []);
      }
    });
    return map;
  }, [projects, others, projectId, currentChats]);

  const sortedProjects = useMemo(() => {
    const list = [...projects];
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? list.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            (chatsByProject.get(p.id) ?? []).some((c) => c.title.toLowerCase().includes(needle)),
        )
      : list;
    if (sortMode === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      filtered.sort(
        (a, b) =>
          (chatsByProject.get(b.id)?.[0]?.updatedAt ?? 0) -
          (chatsByProject.get(a.id)?.[0]?.updatedAt ?? 0),
      );
    }
    return { filtered, needle };
  }, [projects, filter, sortMode, chatsByProject]);

  const recents = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all: (SidebarChat & { projectId: string; projectName: string })[] = [];
    for (const p of projects) {
      for (const c of chatsByProject.get(p.id) ?? []) {
        all.push({ ...c, projectId: p.id, projectName: p.name });
      }
    }
    return all
      .filter(
        (c) =>
          !needle ||
          c.title.toLowerCase().includes(needle) ||
          c.projectName.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, RECENTS_COUNT);
  }, [projects, chatsByProject, filter]);

  const openChat = async (pid: string, chatId: string) => {
    const files = useFilesStore.getState();
    if (files.projectId !== pid) {
      await files.openProject(pid);
      await useChatsStore.getState().load(pid);
    }
    useChatsStore.getState().setActive(chatId);
    // Make the thread findable in the tree as well when its project opens.
    setGroupExpanded(pid, true);
  };

  const newChat = async (pid: string) => {
    const files = useFilesStore.getState();
    if (files.projectId !== pid) {
      await files.openProject(pid);
    }
    let head: string | null = null;
    try {
      head = await gitHeadOid(pid);
    } catch {
      head = null;
    }
    const cs = useChatsStore.getState();
    const chat = cs.create(pid, head);
    cs.setActive(chat.id);
  };

  // A task always needs a project to run against; the center's chooser covers
  // the no-project case.
  const newTask = async () => {
    const pid = useFilesStore.getState().projectId;
    if (!pid) {
      toast.info("Choose a project first — then start a task in it.");
      return;
    }
    await newChat(pid);
  };

  const projectRow = (project: ProjectInfo, i: number) => {
    const isOpen = expanded[project.id] === true;
    const isActiveProject = project.id === projectId;
    const chats = chatsByProject.get(project.id) ?? [];
    const loading = !isActiveProject && isOpen && (others[i]?.isPending ?? false);
    return (
      <div key={project.id} data-testid={`harness-project-group-${project.id}`}>
        <div
          className={cn(
            "group flex items-center gap-1 rounded-md pr-1 transition-colors",
            isActiveProject ? "bg-accent/60" : "hover:bg-accent/40",
          )}
        >
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} chats for ${project.name}`}
            onClick={() => setGroupExpanded(project.id, !isOpen)}
            className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
          >
            <ChevronRight
              className={cn(
                "size-3 shrink-0 text-muted-foreground/60 transition-transform duration-200",
                isOpen && "rotate-90",
              )}
            />
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/50" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span className="truncate text-xs text-muted-foreground">
              {project.id === projectId && projectName ? projectName : project.name}
            </span>
            {chats.length > 0 && (
              <span className="ml-auto shrink-0 pr-1 text-[10px] text-muted-foreground/70">
                {chats.length}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label={`Start a new chat in ${project.name}`}
            data-testid={`harness-new-chat-${project.id}`}
            onClick={() => void newChat(project.id)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MessageSquarePlus className="size-3.5" />
          </button>
        </div>
        {isOpen && (
          <div
            className="ml-4 border-l pl-1.5"
            data-testid={`harness-project-chats-${project.id}`}
          >
            {chats.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {loading ? "Loading chats…" : "No chats yet"}
              </p>
            ) : (
              <ul className="space-y-px pb-1.5">
                {chats.map((chat) => (
                  <li key={chat.id} className="group/chat relative">
                    <button
                      type="button"
                      data-testid={`harness-chat-${chat.id}`}
                      onClick={() => void openChat(project.id, chat.id)}
                      className={cn(
                        "flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 pr-6 text-left text-xs transition-colors",
                        chat.id === activeChatId && project.id === projectId
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{chat.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {chatTime(chat.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete chat ${chat.title}`}
                      onClick={() => useChatsStore.getState().remove(chat.id)}
                      className="absolute top-1/2 right-1 hidden -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-danger group-hover/chat:block"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="project-chats-sidebar">
      <div className="shrink-0 space-y-2 px-2.5 pb-2 pt-1">
        <button
          type="button"
          data-testid="harness-new-task"
          onClick={() => void newTask()}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface-secondary px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-tertiary"
        >
          <Plus className="size-3.5" />
          New task
        </button>
        <label className="flex items-center gap-1.5 rounded-lg bg-surface-secondary px-2.5 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground/70" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search projects and chats"
            aria-label="Search projects and chats"
            data-testid="harness-sidebar-search"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="sticky top-0 z-10 bg-sidebar/95 pb-0.5 backdrop-blur">
          <SectionHeader onMenu={() => setMenuOpen((v) => !v)}>
            Projects
          </SectionHeader>
          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
              menuOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
            aria-hidden={!menuOpen}
          >
            <div className="overflow-hidden">
              <div className="mb-1 rounded-md border bg-surface p-1.5 shadow-sm">
                <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
                  <ArrowDownUp className="size-3" />
                  Sort
                </div>
                {(
                  [
                    ["recent", "Recent activity"],
                    ["name", "Name"],
                  ] as [SortMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`harness-sort-${mode}`}
                    tabIndex={menuOpen ? 0 : -1}
                    onClick={() => setSortMode(mode)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <Check className={cn("size-3", sortMode !== mode && "invisible")} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {projects.length === 0 && (
          <p className="px-1.5 pb-2 text-xs text-muted-foreground">
            No projects yet — start one from the composer's home screen.
          </p>
        )}
        <div className="space-y-0.5">
          {sortedProjects.filtered.map((project) =>
            projectRow(
              project,
              projects.findIndex((p) => p.id === project.id),
            ),
          )}
        </div>
        {sortedProjects.filtered.length === 0 && projects.length > 0 && (
          <p
            className="px-1.5 pb-2 text-xs text-muted-foreground"
            data-testid="harness-projects-no-match"
          >
            Nothing matches “{filter.trim()}”.
          </p>
        )}

        <div className="mt-1 pb-2" data-testid="harness-recents">
          <SectionHeader>Recents</SectionHeader>
          {recents.length === 0 ? (
            <p className="px-1.5 text-xs text-muted-foreground">
              Your latest threads appear here.
            </p>
          ) : (
            <ul className="space-y-px">
              {recents.map((chat) => (
                <li key={`${chat.projectId}:${chat.id}`}>
                  <button
                    type="button"
                    data-testid={`harness-recent-${chat.id}`}
                    onClick={() => void openChat(chat.projectId, chat.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      chat.id === activeChatId && chat.projectId === projectId
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <MessageSquare className="size-3 shrink-0 opacity-50" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{chat.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground/70">
                        {chat.projectName}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">
                      {chatTime(chat.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
