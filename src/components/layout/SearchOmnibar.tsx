import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Command } from "cmdk";
import {
  Bookmark,
  FileText,
  Ghost,
  Link2,
  Moon,
  NotebookText,
  Pilcrow,
  Plus,
  StickyNote,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  commandKeywords,
  commandLabel,
  commandsFor,
  type AppContext,
  type CommandContribution,
} from "@oleafly/registry";
import { useSettingsStore } from "@/store/settings";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { useFilesStore } from "@/store/files";
import { useProjectColorsStore } from "@/store/project-colors";
import { DEFAULT_BOOK_COLOR } from "@/components/library/Book";
import { useTheme } from "@/lib/theme";
import type { NoteBlockHit, NoteSearchHit, ProjectInfo, SearchHit } from "@/lib/tauri";
import { useDocSearch, useSearchResults } from "@/hooks/use-doc-search";
import { useNotesAppearanceRef } from "@/hooks/use-notes-appearance";
import type { OmnibarNoteResults, OmnibarNoteSearch } from "@/components/notes/omnibar-note-search";
import { textSearchTruncated } from "@/lib/text-search-query";
import { openNotes } from "@/features/open-tool";
import { blockFragment, textFragment } from "@/components/notes/note-block-ids";
import { Highlighted } from "@/components/ui/highlighted";
import { SearchModeMenu } from "@/components/ui/search-mode-menu";
import { useSearchModeStore } from "@/store/search-modes";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import { projectModifiedLabel } from "@/lib/project-format";
import { libraryProjects } from "@/lib/library-projects";
import { i18n } from "@/i18n";
import { gotoLine } from "@/components/editor/cm/controller";
import { objectKey } from "@/lib/react-key";
import { COMMAND_GROUP, COMMAND_ITEM, CommandDialogShell } from "@/components/ui/command-dialog";
import { Kbd } from "@/components/ui/kbd";
import { useFavoritesStore } from "@/store/favorites";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { basename } from "@/lib/path-utils";
import { useModalLayer } from "@/components/ui/use-modal-accessibility";
import { EmptyState } from "@/components/ui/empty";
import { NoteSnippet } from "@/components/notes/NoteSnippet";

function searchableDate(timestamp: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString()} ${date.toISOString().slice(0, 10)}`;
}

function searchableEngine(project: ProjectInfo) {
  const raw = project.engine?.trim().toLowerCase() ?? "";
  const path = project.main_doc.toLowerCase();
  const isQuarto = raw === "quarto" || path.endsWith(".qmd") || path.endsWith(".rmd");
  const isMarkdown =
    raw === "markdown" ||
    raw === "md" ||
    raw === "pandoc" ||
    path.endsWith(".md") ||
    path.endsWith(".markdown");
  const markdownLabel = isQuarto ? "quarto markdown" : "markdown";
  const nonTypstLabel = isMarkdown || isQuarto ? markdownLabel : "tectonic";
  const label =
    raw === "typst" || raw === "typ" || path.endsWith(".typ") ? "typst" : nonTypstLabel;
  return `${raw} ${label}`.trim();
}

function projectSearchFields(project: ProjectInfo, bookmarked: boolean) {
  const exports = (project.exports ?? [])
    .map(
      (item) =>
        `${item.filename} ${item.format} ${item.path} ${searchableDate(item.date)}`,
    )
    .join(" ");
  return {
    id: project.id,
    project_id: project.id,
    name: project.name,
    engine: searchableEngine(project),
    type: searchableEngine(project),
    kind: project.kind,
    main: project.main_doc,
    main_doc: project.main_doc,
    path: project.main_doc,
    created: searchableDate(project.created_at),
    created_at: searchableDate(project.created_at),
    modified: searchableDate(project.updated_at),
    modified_at: searchableDate(project.updated_at),
    updated: searchableDate(project.updated_at),
    color: project.color ?? "",
    cover: project.color ?? "",
    bookmark: bookmarked
      ? "yes true bookmarked favorite starred"
      : "no false unbookmarked not-bookmarked",
    favorite: bookmarked
      ? "yes true bookmarked favorite starred"
      : "no false unbookmarked not-bookmarked",
    preview: project.has_preview
      ? "yes true available compiled pdf"
      : "no false missing",
    pdf_preview: project.has_preview
      ? "yes true available compiled pdf"
      : "no false missing",
    export: exports,
    exports,
  };
}

type ProjectSearchText = Readonly<{
  fields: ReturnType<typeof projectSearchFields>;
  all: string;
}>;

const projectSearchTexts = new WeakMap<ProjectInfo, [ProjectSearchText | null, ProjectSearchText | null]>();

function projectSearchText(project: ProjectInfo, bookmarked: boolean): ProjectSearchText {
  let slots = projectSearchTexts.get(project);
  if (!slots) {
    slots = [null, null];
    projectSearchTexts.set(project, slots);
  }
  const slot = bookmarked ? 1 : 0;
  const cached = slots[slot];
  if (cached) return cached;
  const fields = projectSearchFields(project, bookmarked);
  const text = { fields, all: Object.values(fields).join(" ").toLowerCase() };
  slots[slot] = text;
  return text;
}

export function projectMatches(project: ProjectInfo, query: string, bookmarked: boolean) {
  const { fields, all } = projectSearchText(project, bookmarked);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => {
      const separator = token.indexOf(":");
      if (separator < 1) return all.includes(token);
      const field = token.slice(0, separator) as keyof typeof fields;
      const value = token.slice(separator + 1);
      if (!Object.hasOwn(fields, field)) return false;
      const fieldValue = fields[field];
      return typeof fieldValue === "string" && fieldValue.toLowerCase().includes(value);
    });
}

type Mode =
  | "all"
  | "projects"
  | "docs"
  | "notes"
  | "refs"
  | "create"
  | "theme"
  | "settings"
  | "command"
  | "help";

interface SlashEntry {
  keys: readonly string[];
  mode: Mode;
  hint: string;
  command?: CommandContribution;
}

const NOTE_RESULTS = 20;
const NOTE_RESULTS_ALL = 5;
const NOTE_BLOCKS = 3;

const BUILT_IN_SLASH: SlashEntry[] = [
  {
    keys: ["create", "new"],
    mode: "create",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.create);
    },
  },
  {
    keys: ["projects", "p"],
    mode: "projects",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.projects);
    },
  },
  {
    keys: ["docs", "search"],
    mode: "docs",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.docs);
    },
  },
  {
    keys: ["notes", "n"],
    mode: "notes",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.notes);
    },
  },
  {
    keys: ["refs"],
    mode: "refs",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.refs);
    },
  },
  {
    keys: ["theme"],
    mode: "theme",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.theme);
    },
  },
  {
    keys: ["settings"],
    mode: "settings",
    get hint() {
      return i18n.t(($) => $.shell.omnibar.slash.settings);
    },
  },
];

function commandSlashEntries(
  commands: CommandContribution[],
  ctx: AppContext,
): SlashEntry[] {
  return commands.flatMap((command) =>
    command.slash?.length
      ? [
          {
            keys: command.slash,
            mode: "command" as const,
            hint: commandLabel(command, ctx),
            command,
          },
        ]
      : [],
  );
}

export function slashAliasesFor(
  commands: CommandContribution[],
  ctx: AppContext,
): string[] {
  return commandSlashEntries(commands, ctx).flatMap((entry) => [...entry.keys]);
}

export function parse(
  q: string,
  slashEntries: SlashEntry[],
): {
  mode: Mode;
  term: string;
  cmd: string;
  action?: CommandContribution;
} {
  if (!q.startsWith("/")) {
    return { mode: "all", term: q, cmd: "" };
  }
  const rest = q.slice(1);
  const boundary = rest.search(/\s/u);
  const cmd = (boundary === -1 ? rest : rest.slice(0, boundary)).toLowerCase();
  const term = boundary === -1 ? "" : rest.slice(boundary).trimStart();
  const found = slashEntries.find((entry) => entry.keys.includes(cmd));
  if (found) {
    return {
      mode: found.mode,
      term,
      cmd,
      action: found.command,
    };
  }
  return { mode: "help", term: q, cmd };
}

function noteBlockFragment(block: NoteBlockHit): string {
  return block.block ? blockFragment(block.block) : textFragment(block.text);
}

export function SearchOmnibar() {
  const open = useSettingsStore((s) => s.searchOpen);
  useModalLayer(open);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setRailTab = useSettingsStore((s) => s.setRailTab);
  const latexTools = useSettingsStore((s) => s.latexTools);
  const allProjects = useFilesStore((s) => s.projects);
  const notesOn = useSettingsStore((s) => s.notes);
  const projects = useMemo(() => libraryProjects(allProjects, notesOn), [allProjects, notesOn]);
  const projectColors = useProjectColorsStore((s) => s.colors);
  const favs = useFavoritesStore((s) => s.favs);
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const openProject = useFilesStore((s) => s.openProject);
  const openFile = useFilesStore((s) => s.openFile);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation(["common", "shell"]);
  const [query, setQuery] = useState("");
  const listRef = useScrollTopOnChange(query);
  const notesAppearanceRef = useNotesAppearanceRef<HTMLDivElement>();
  const noteSearcher = useRef<Promise<OmnibarNoteSearch> | null>(null);

  const ctx = useMemo<AppContext>(
    () => ({ projectId, projectKind, theme, latexToolsEnabled: latexTools }),
    [latexTools, projectId, projectKind, theme],
  );
  const availableCommands = useMemo(
    () => commandsFor("omnibar", ctx),
    [ctx],
  );
  const slashEntries = useMemo(
    () => [
      ...BUILT_IN_SLASH.filter((entry) => notesOn || entry.mode !== "notes"),
      ...commandSlashEntries(availableCommands, ctx),
    ],
    [availableCommands, ctx, notesOn],
  );
  const { mode, term, cmd, action } = useMemo(
    () => parse(query, slashEntries),
    [query, slashEntries],
  );
  const trimmed = term.trim();
  const fileMode = useSearchModeStore((state) => state.files);
  const noteMode = useSearchModeStore((state) => state.notes);
  const searchingFiles = mode === "all" || mode === "docs";
  const searchingNotes = notesOn && (mode === "all" || mode === "notes");
  const notesSearchMode = mode === "notes" ? noteMode : fileMode;
  const { hits, loading } = useDocSearch(trimmed, {
    enabled: searchingFiles,
    mode: fileMode,
  });
  const noteLimit = mode === "notes" ? NOTE_RESULTS : NOTE_RESULTS_ALL;
  const notes = useSearchResults<OmnibarNoteResults>(
    searchingNotes ? trimmed : "",
    `${notesSearchMode}\u0000${noteLimit}`,
    (term) => {
      noteSearcher.current ??= import("@/components/notes/omnibar-note-search").then((module) => module.omnibarNoteSearch());
      return noteSearcher.current.then((search) => search(term, noteLimit, notesSearchMode)).then((found) => [found]);
    },
  );
  const noteResults = notes.hits[0];
  const noteHits = noteResults?.hits ?? [];
  const truncated = useMemo(
    () => (searchingFiles && textSearchTruncated(trimmed, true)) || (searchingNotes && noteResults?.truncated === true),
    [noteResults, searchingFiles, searchingNotes, trimmed],
  );
  const slashSuggestions = useMemo(
    () =>
      mode === "help"
        ? slashEntries.filter((entry) =>
            entry.keys.some((key) => key.startsWith(cmd)),
          )
        : [],
    [cmd, mode, slashEntries],
  );

  useEffect(() => {
    if (!open) return;
    noteSearcher.current = null;
    void refreshProjects().catch(() => {});
  }, [open, refreshProjects]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      if (matchesShortcut(e, useShortcutStore.getState().bindings.searchDocuments)) {
        e.preventDefault();
        setSearchOpen(!useSettingsStore.getState().searchOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  useEffect(() => {
    if (!E2E_HOOKS || !open) return;
    const setE2eQuery = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== "string") {
        return;
      }
      setQuery(event.detail);
    };
    window.addEventListener("oleafly:e2e-command-query", setE2eQuery);
    return () =>
      window.removeEventListener("oleafly:e2e-command-query", setE2eQuery);
  }, [open]);

  const close = () => {
    setSearchOpen(false);
    setQuery("");
  };

  const matchedProjects = useMemo(() => {
    if (mode !== "all" && mode !== "projects") return [];
    const list = trimmed
      ? projects.filter((project) => projectMatches(project, trimmed, favs.includes(project.id)))
      : projects;
    return list.slice(0, mode === "projects" ? 30 : 6);
  }, [favs, projects, trimmed, mode]);

  const commands = useMemo(() => {
    const all = availableCommands.map((c) => ({
      id: c.id,
      label: commandLabel(c, ctx),
      kw: `${commandKeywords(c, ctx)} ${c.slash?.join(" ") ?? ""}`,
      icon: c.icon?.(ctx),
      run: () => c.run(ctx),
    }));
    if (mode !== "all") return [];
    const q = trimmed.toLowerCase();
    return q ? all.filter((c) => (`${c.label} ${c.kw}`).toLowerCase().includes(q)) : all;
  }, [availableCommands, ctx, trimmed, mode]);
  const generalCommands = useMemo(
    () => commands.filter((c) => !c.id.startsWith("tool.")),
    [commands],
  );
  const toolCommands = useMemo(
    () => commands.filter((c) => c.id.startsWith("tool.")),
    [commands],
  );

  const runProject = async (id: string) => {
    close();
    await openProject(id);
  };
  const openHit = async (hit: SearchHit) => {
    close();
    await openProject(hit.project_id);
    if (useFilesStore.getState().projectId !== hit.project_id) return;
    await openFile(hit.path);
    if (hit.line > 0) window.setTimeout(() => gotoLine(hit.line), 120);
  };
  const openNote = (hit: NoteSearchHit, block?: NoteBlockHit) => {
    close();
    void openNotes(hit.id, block ? noteBlockFragment(block) : null);
  };
  const runAction = (fn: () => void) => {
    close();
    fn();
  };

  const placeholderFor = (): string => {
    if (mode === "projects") return t(($) => $.shell.omnibar.placeholderProjects);
    if (mode === "docs") return t(($) => $.shell.omnibar.placeholderDocuments);
    if (mode === "notes") return t(($) => $.shell.omnibar.placeholderNotes);
    return t(($) => $.shell.omnibar.placeholder);
  };
  const placeholder = placeholderFor();

  return (
    <CommandDialogShell
      open={open}
      onOpenChange={(v) => (v ? setSearchOpen(true) : close())}
      label={t(($) => $.shell.omnibar.label)}
      shouldFilter={false}
      query={query}
      onQueryChange={setQuery}
      placeholder={placeholder}
      placement="top-[18%]"
      className="w-[min(660px,92vw)]"
      leading={<Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      trailing={
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">{loading || notes.loading ? "…" : ""}</span>
          {searchingFiles && (
            <SearchModeMenu value={fileMode} onChange={(next) => useSearchModeStore.getState().setMode("files", next)} />
          )}
          {mode === "notes" && (
            <SearchModeMenu value={noteMode} onChange={(next) => useSearchModeStore.getState().setMode("notes", next)} />
          )}
        </span>
      }
      listRef={listRef}
      listClassName="max-h-[min(60vh,440px)]"
      footer={
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[0.6875rem] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd className="border bg-background text-foreground">{t(($) => $.shell.keys.enter)}</Kbd>
            <span>{t(($) => $.common.actions.open)}</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd className="border bg-background text-foreground">/</Kbd>
            <span>{t(($) => $.shell.commandGroups.commands)}</span>
          </span>
          {truncated && (
            <span role="status" className="ml-auto min-w-0 text-right">
              {t(($) => $.common.querySearch.issues.tooManyBranches)}
            </span>
          )}
        </div>
      }
    >
      {mode === "create" && (
        <Group heading={t(($) => $.shell.omnibar.groups.action)}>
          <Row
            icon={<Plus className="size-4" />}
            title={t(($) => $.shell.omnibar.createProject)}
            hint={t(($) => $.shell.keys.enter)}
            onSelect={() => runAction(() => setNewProjectOpen(true))}
          />
        </Group>
      )}
      {mode === "theme" && (
        <Group heading={t(($) => $.shell.omnibar.groups.action)}>
          <Row
            icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            title={
              theme === "dark"
                ? t(($) => $.shell.commands.theme.toLight)
                : t(($) => $.shell.commands.theme.toDark)
            }
            hint={t(($) => $.shell.keys.enter)}
            onSelect={() => runAction(toggleTheme)}
          />
        </Group>
      )}
      {mode === "settings" && (
        <Group heading={t(($) => $.shell.omnibar.groups.action)}>
          <Row
            icon={<Settings className="size-4" />}
            title={t(($) => $.shell.commands.settings.label)}
            hint={t(($) => $.shell.keys.enter)}
            onSelect={() => runAction(() => setSettingsOpen(true))}
          />
        </Group>
      )}
      {mode === "command" && action && (
        <Group heading={t(($) => $.shell.omnibar.groups.action)}>
          <Row
            icon={action.icon?.(ctx)}
            title={commandLabel(action, ctx)}
            hint={t(($) => $.shell.keys.enter)}
            onSelect={() => runAction(() => action.run(ctx))}
          />
        </Group>
      )}
      {mode === "refs" && (
        <Group heading={t(($) => $.shell.omnibar.groups.references)}>
          {projectId ? (
            <Row
              icon={<Link2 className="size-4" />}
              title={t(($) => $.shell.omnibar.openReferences)}
              hint={t(($) => $.shell.keys.enter)}
              onSelect={() => runAction(() => setRailTab("refs"))}
            />
          ) : (
            <Hint>{t(($) => $.shell.omnibar.referencesNeedProject)}</Hint>
          )}
        </Group>
      )}

      {generalCommands.length > 0 && (
        <Group heading={t(($) => $.shell.commandGroups.commands)}>
          {generalCommands.map((c) => (
            <Row
              key={c.id}
              icon={c.icon}
              title={c.label}
              onSelect={() => runAction(c.run)}
            />
          ))}
        </Group>
      )}

      {toolCommands.length > 0 && (
        <Group heading={t(($) => $.shell.commandGroups.tools)}>
          {toolCommands.map((c) => (
            <Row
              key={c.id}
              icon={c.icon}
              title={c.label}
              onSelect={() => runAction(c.run)}
            />
          ))}
        </Group>
      )}

      {matchedProjects.length > 0 && (
        <Group heading={t(($) => $.shell.commandGroups.project)}>
          {matchedProjects.map((p) => (
            <Row
              key={p.id}
              icon={
                <span className="flex items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        projectColors[p.id] ?? (p.color || DEFAULT_BOOK_COLOR),
                    }}
                  />
                  <NotebookText className="size-4" />
                </span>
              }
              title={p.name}
              starred={favs.includes(p.id)}
              hint={projectModifiedLabel(p.updated_at)}
              onSelect={() => void runProject(p.id)}
            />
          ))}
        </Group>
      )}

      {(mode === "all" || mode === "notes") && noteHits.length > 0 && (
        <Group ref={notesAppearanceRef} heading={t(($) => $.shell.omnibar.groups.notes)}>
          {noteHits.flatMap((hit) => [
            <Command.Item
              key={`note:${hit.id}`}
              value={`note:${hit.id}`}
              onSelect={() => openNote(hit)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <div className="flex items-center gap-2">
                <StickyNote className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">
                  <Highlighted text={hit.title} ranges={hit.titleRanges} />
                </span>
              </div>
              {!hit.blocks?.length && hit.snippets[0] && (
                <span className="-my-0.5 truncate py-0.5 text-xs text-muted-foreground">
                  <NoteSnippet text={hit.snippets[0].text} ranges={hit.snippets[0].ranges} />
                </span>
              )}
            </Command.Item>,
            ...(hit.blocks ?? []).slice(0, NOTE_BLOCKS).map((block) => (
              <Command.Item
                key={`note:${hit.id}:${block.line}`}
                value={`note:${hit.id}:${block.line}`}
                data-omnibar-block={block.line}
                onSelect={() => openNote(hit, block)}
                className="flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2.5 pl-8 text-xs text-muted-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <Pilcrow className="size-3.5 shrink-0" />
                <span className="-my-0.5 truncate py-0.5">
                  <NoteSnippet text={block.text} ranges={block.ranges} />
                </span>
              </Command.Item>
            )),
          ])}
        </Group>
      )}

      {(mode === "all" || mode === "docs") && hits.length > 0 && (
        <Group heading={t(($) => $.shell.omnibar.groups.documents)}>
          {hits.map((hit) => {
            const itemKey = objectKey(hit, "document");
            return (
            <Command.Item
              key={itemKey}
              value={itemKey}
              onSelect={() => void openHit(hit)}
              className="flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <div className="flex items-center gap-2">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{basename(hit.path)}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {hit.line > 0 ? `${hit.project_name} · ${hit.path} : ${hit.line}` : `${hit.project_name} · ${hit.path}`}
                </span>
              </div>
              <span className="truncate font-mono text-xs text-muted-foreground">
                <Highlighted text={hit.preview} ranges={hit.ranges} />
              </span>
            </Command.Item>
            );
          })}
        </Group>
      )}

      {mode === "help" && slashSuggestions.length > 0 && (
        <Group heading={t(($) => $.shell.commandGroups.commands)}>
          {slashSuggestions.map((s) => (
            <Row
              key={s.keys[0]}
              icon={
                s.command?.icon?.(ctx) ?? (
                  <code className="text-xs">/{s.keys[0]}</code>
                )
              }
              title={s.hint}
              hint={`/${s.keys[0]}`}
              onSelect={() => {
                if (s.command) {
                  runAction(() => s.command?.run(ctx));
                } else {
                  setQuery(`/${s.keys[0]} `);
                }
              }}
            />
          ))}
        </Group>
      )}
      {mode === "help" && slashSuggestions.length === 0 && (
        <Hint>{t(($) => $.shell.omnibar.unknownCommand)}</Hint>
      )}
      {mode === "all" &&
        !trimmed &&
        commands.length === 0 &&
        matchedProjects.length === 0 && (
          <SlashHelp entries={slashEntries} />
        )}
      {(mode === "all" || mode === "docs" || mode === "projects") &&
        trimmed &&
        !loading &&
        hits.length === 0 &&
        matchedProjects.length === 0 &&
        commands.length === 0 && (
          <EmptyState
            className="px-3 py-6"
            icon={<Ghost aria-hidden className="size-6 text-muted-foreground" />}
            title={t(($) => $.shell.omnibar.noMatches)}
            testId="omnibar-no-matches"
          />
        )}
    </CommandDialogShell>
  );
}

function Group({ heading, children, ref }: Readonly<{ heading: string; children: ReactNode; ref?: Ref<HTMLDivElement> }>) {
  return (
    <Command.Group ref={ref} heading={heading} className={COMMAND_GROUP}>
      {children}
    </Command.Group>
  );
}

function Row({
  icon,
  title,
  hint,
  starred,
  onSelect,
}: Readonly<{
  icon: ReactNode;
  title: string;
  hint?: string;
  starred?: boolean;
  onSelect: () => void;
}>) {
  return (
    <Command.Item
      value={title}
      onSelect={onSelect}
      className={COMMAND_ITEM}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate">{title}</span>
      {starred && (
        <Bookmark
          className="size-3.5 shrink-0 fill-current text-amber-500"
          aria-label={i18n.t(($) => $.shell.omnibar.bookmarked)}
        />
      )}
      {hint && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{hint}</span>}
    </Command.Item>
  );
}

function Hint({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="px-3 py-6 text-center text-sm text-muted-foreground">{children}</div>;
}

function SlashHelp({ entries }: Readonly<{ entries: SlashEntry[] }>) {
  const { t } = useTranslation(["shell"]);
  return (
    <div className="px-2 py-2">
      <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
        {t(($) => $.shell.omnibar.tryCommand)}
      </p>
      {entries.map((s) => (
        <div key={s.keys[0]} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/{s.keys[0]}</code>
          <span className="text-xs text-muted-foreground">{s.hint}</span>
        </div>
      ))}
    </div>
  );
}
