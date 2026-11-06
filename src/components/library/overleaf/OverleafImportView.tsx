import { memo, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import { Search } from "@/components/icons/pack";
import { Book, BOOK_SWATCHES } from "@/components/library/Book";
import { LayoutToggle } from "@/components/library/LayoutToggle";
import { OverleafBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { BrowserSignInCopy } from "@/components/settings/BrowserSignInCopy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { DEFAULT_OVERLEAF_SERVER, isOverleafError, type OverleafProject } from "@/lib/overleaf";
import { projectModifiedLabel } from "@/lib/project-format";
import { cn, isLinux } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore, type OverleafRowProgress } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";

type Filter = "all" | "owned" | "shared";
type LibraryTranslate = ReturnType<typeof useTranslation<["library"]>>["t"];

const FILTERS: readonly Filter[] = ["all", "owned", "shared"];
const LINK_BUTTON =
  "rounded px-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50";
const MAX_NAMED_CARDS = 60;

function transitionName(id: string): string {
  return `overleaf-card-${id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

function withViewTransition(update: () => void): void {
  const view = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (isLinux || typeof view.startViewTransition !== "function" || reduced) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.overleafImportTransition = "true";
  const clear = () => {
    delete root.dataset.overleafImportTransition;
  };
  view.startViewTransition(() => flushSync(update)).finished.then(clear, clear);
}

function bookColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return BOOK_SWATCHES[hash % BOOK_SWATCHES.length];
}

function editedLabel(project: OverleafProject): string | undefined {
  const time = project.lastUpdated ? Date.parse(project.lastUpdated) : Number.NaN;
  return Number.isNaN(time) ? undefined : projectModifiedLabel(time / 1000);
}

function serverHost(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

function filterLabel(t: LibraryTranslate, filter: Filter): string {
  const labels: Record<Filter, string> = {
    all: t(($) => $.library.import.overleaf.filter.all),
    owned: t(($) => $.library.import.overleaf.filter.owned),
    shared: t(($) => $.library.import.overleaf.filter.shared),
  };
  return labels[filter];
}

function ownerLabel(t: LibraryTranslate, project: OverleafProject): string | null {
  if (project.owned) return t(($) => $.library.import.overleaf.ownedByYou);
  if (project.ownerName) return t(($) => $.library.import.overleaf.owner, { name: project.ownerName });
  return null;
}

function promptText(t: LibraryTranslate, signing: boolean, expired: boolean): string {
  if (signing) return t(($) => $.library.import.overleaf.signingIn);
  if (expired) return t(($) => $.library.import.overleaf.expired);
  return t(($) => $.library.import.overleaf.signInPrompt);
}

function matches(project: OverleafProject, filter: Filter, needle: string): boolean {
  if (filter === "owned" && !project.owned) return false;
  if (filter === "shared" && project.owned) return false;
  if (!needle) return true;
  return `${project.name} ${project.ownerName ?? ""}`.toLocaleLowerCase().includes(needle);
}

async function importAndRefresh(ids?: readonly string[]): Promise<void> {
  const outcomes = await useOverleafImportStore.getState().importSelected(ids);
  if (outcomes.some((outcome) => outcome.projectId)) {
    await useFilesStore.getState().refreshProjects();
  }
}

function retryImport(id: string): void {
  void importAndRefresh([id]);
}

export function OverleafImportView({
  onOpenProject,
  onDone,
}: Readonly<{ onOpenProject: (projectId: string) => void; onDone: () => void }>) {
  const phase = useOverleafImportStore((state) => state.phase);
  const open = useOverleafImportStore((state) => state.open);
  const running = useOverleafImportStore((state) => state.run !== null);

  useEffect(() => {
    void open();
    return () => useOverleafImportStore.getState().finishRun();
  }, [open]);

  if (phase === "idle" || phase === "checking" || phase === "loading") {
    return <LoadingState loading={phase === "loading"} />;
  }
  if (phase === "signed-out" || phase === "signing-in") return <SignInPanel />;
  if (phase === "error") return <ErrorState />;
  if (running) return <ImportRun onOpenProject={onOpenProject} onDone={onDone} />;
  return <ProjectPicker onOpenProject={onOpenProject} />;
}

function LoadingState({ loading }: Readonly<{ loading: boolean }>) {
  const { t } = useTranslation(["library"]);
  return (
    <output data-testid="overleaf-import-loading" className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner />
      {loading ? t(($) => $.library.import.overleaf.loading) : t(($) => $.library.import.overleaf.checking)}
    </output>
  );
}

function ErrorState() {
  const { t } = useTranslation(["library"]);
  const error = useOverleafImportStore((state) => state.error);
  const open = useOverleafImportStore((state) => state.open);
  const unrecognized = isOverleafError(error, "unrecognized");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border bg-card px-6 py-8 text-center">
      <p role="alert" className="max-w-md select-text text-sm text-destructive">
        {unrecognized ? describeError(error) : t(($) => $.library.import.overleaf.loadFailed)}
      </p>
      {!unrecognized && error ? (
        <p className="max-w-md select-text text-xs text-muted-foreground">{describeError(error)}</p>
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={() => void open()}>
        <RotateCw aria-hidden className="size-3.5" />
        {t(($) => $.library.import.tryAgain)}
      </Button>
    </div>
  );
}

function ProjectPicker({ onOpenProject }: Readonly<{ onOpenProject: (projectId: string) => void }>) {
  const projects = useOverleafImportStore((state) => state.projects);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return projects.filter((project) => matches(project, filter, needle));
  }, [projects, query, filter]);

  return (
    <div data-testid="overleaf-import-view" className="flex min-h-0 flex-1 flex-col gap-3">
      <PickerToolbar query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} total={projects.length} />
      <SelectionBar visibleIds={visible.filter((project) => !project.importedAs).map((project) => project.id)} />
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <ProjectArea projects={projects} visible={visible} onOpenProject={onOpenProject} />
      </div>
      <PickerFooter />
    </div>
  );
}

function PickerToolbar({
  query,
  onQuery,
  filter,
  onFilter,
  total,
}: Readonly<{
  query: string;
  onQuery: (query: string) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  total: number;
}>) {
  const { t } = useTranslation(["library"]);
  const layout = useSettingsStore((state) => state.homeProjectLayout);
  const setLayout = useSettingsStore((state) => state.setHomeProjectLayout);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid="overleaf-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label={t(($) => $.library.import.overleaf.searchLabel)}
          placeholder={t(($) => $.library.import.overleaf.searchPlaceholder, { count: total })}
          className="h-8 pl-8"
        />
      </div>
      <fieldset aria-label={t(($) => $.library.import.overleaf.filterLabel)} className="flex items-center rounded-lg border p-0.5">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            data-testid={`overleaf-filter-${value}`}
            onClick={() => onFilter(value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors focus-visible:bg-accent/60 focus-visible:text-foreground",
              filter === value ? "bg-accent text-foreground" : "hover:text-foreground",
            )}
          >
            {filterLabel(t, value)}
          </button>
        ))}
      </fieldset>
      <LayoutToggle value={layout} onChange={setLayout} className="border p-0.5" />
    </div>
  );
}

function SelectionBar({ visibleIds }: Readonly<{ visibleIds: string[] }>) {
  const { t } = useTranslation(["library"]);
  const selected = useOverleafImportStore((state) => state.selected);
  const importing = useOverleafImportStore((state) => state.importing);
  const email = useOverleafImportStore((state) => state.status?.email ?? null);
  const setSelected = useOverleafImportStore((state) => state.setSelected);
  const signOut = useOverleafImportStore((state) => state.signOut);
  const chosen = new Set(selected);
  const allChosen = visibleIds.length > 0 && visibleIds.every((id) => chosen.has(id));

  const toggleAll = () => {
    setSelected(allChosen ? selected.filter((id) => !visibleIds.includes(id)) : [...selected, ...visibleIds]);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <button
        type="button"
        data-testid="overleaf-select-all"
        disabled={visibleIds.length === 0 || importing}
        onClick={toggleAll}
        className={cn(LINK_BUTTON, "-ml-1")}
      >
        {allChosen
          ? t(($) => $.library.import.overleaf.clearSelection)
          : t(($) => $.library.import.overleaf.selectAll)}
      </button>
      <span className="flex items-center gap-2">
        <span className="truncate">
          {email
            ? t(($) => $.library.import.overleaf.signedInAs, { email })
            : t(($) => $.library.import.overleaf.signedIn)}
        </span>
        <button
          type="button"
          data-testid="overleaf-sign-out"
          disabled={importing}
          onClick={() => void signOut()}
          className={LINK_BUTTON}
        >
          {t(($) => $.library.import.overleaf.signOut)}
        </button>
      </span>
    </div>
  );
}

function ProjectArea({
  projects,
  visible,
  onOpenProject,
}: Readonly<{
  projects: OverleafProject[];
  visible: OverleafProject[];
  onOpenProject: (projectId: string) => void;
}>) {
  const { t } = useTranslation(["library"]);
  const layout = useSettingsStore((state) => state.homeProjectLayout);
  const selected = useOverleafImportStore((state) => state.selected);
  const progress = useOverleafImportStore((state) => state.progress);
  const importing = useOverleafImportStore((state) => state.importing);
  const toggle = useOverleafImportStore((state) => state.toggle);

  if (projects.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t(($) => $.library.import.overleaf.empty)}</p>;
  }
  if (visible.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t(($) => $.library.import.overleaf.noMatches)}</p>;
  }
  const chosen = new Set(selected);
  const nameable = selected.length <= MAX_NAMED_CARDS;
  const itemProps = (project: OverleafProject) => ({
    project,
    mode: "pick" as const,
    checked: chosen.has(project.id),
    named: nameable && chosen.has(project.id),
    progress: progress[project.id],
    busy: importing,
    onToggle: project.importedAs ? undefined : toggle,
    onOpen: onOpenProject,
    onRetry: retryImport,
  });
  if (layout === "grid") {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-5 pb-2">
        {visible.map((project) => (
          <ProjectBook key={project.id} {...itemProps(project)} />
        ))}
      </div>
    );
  }
  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {visible.map((project) => (
        <ProjectRow key={project.id} {...itemProps(project)} />
      ))}
    </ul>
  );
}

function PickerFooter() {
  const { t } = useTranslation(["library"]);
  const selected = useOverleafImportStore((state) => state.selected);
  const progress = useOverleafImportStore((state) => state.progress);
  const importing = useOverleafImportStore((state) => state.importing);
  const rows = Object.values(progress);
  const doneCount = rows.filter((row) => row.phase === "done").length;
  const failedCount = rows.filter((row) => row.phase === "failed").length;
  const outcome: string[] = [];
  if (doneCount > 0) outcome.push(t(($) => $.library.import.overleaf.doneSummary, { count: doneCount }));
  if (failedCount > 0) outcome.push(t(($) => $.library.import.overleaf.failedSummary, { count: failedCount }));
  const summary =
    outcome.length > 0 ? outcome.join(" ") : t(($) => $.library.import.overleaf.selected, { count: selected.length });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
        <p data-testid="overleaf-selection-summary" className="font-medium text-foreground">
          {summary}
        </p>
        <p>{t(($) => $.library.import.overleaf.notCarried)}</p>
      </div>
      <Button
        type="button"
        data-testid="overleaf-import-selected"
        disabled={selected.length === 0 || importing}
        onClick={() =>
          withViewTransition(() => {
            void importAndRefresh(useOverleafImportStore.getState().startRun());
          })
        }
      >
        {importing ? <Spinner size="sm" /> : null}
        {t(($) => $.library.import.overleaf.import, { count: selected.length })}
      </Button>
    </div>
  );
}

function SignInPanel() {
  const { t } = useTranslation(["library"]);
  const store = useOverleafImportStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(store.server);
  const signing = store.phase === "signing-in";
  const expired = isOverleafError(store.error, "session_expired");
  const custom = store.server !== DEFAULT_OVERLEAF_SERVER;

  return (
    <div data-testid="overleaf-sign-in-panel" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border bg-card px-6 py-8 text-center">
      <OverleafBrandIcon className="size-8 text-[#47A141]" />
      <p className="max-w-md text-sm text-muted-foreground">{promptText(t, signing, expired)}</p>
      <Button
        type="button"
        data-testid="overleaf-sign-in"
        disabled={signing}
        onClick={() => void store.signIn(t(($) => $.library.import.overleaf.signInWindowTitle))}
      >
        {signing ? <Spinner size="sm" /> : null}
        {t(($) => $.library.import.overleaf.signIn)}
      </Button>
      <p data-testid="overleaf-passkey-hint" className="max-w-md text-xs text-muted-foreground">
        {t(($) => $.library.import.overleaf.passkeyHint)}
      </p>
      {signing ? null : (
        <BrowserSignInCopy server={store.server} variant="button" onSignedIn={() => void store.load()} />
      )}
      {store.error && !expired && !signing ? (
        <p role="alert" className="max-w-md select-text text-xs text-destructive">
          {describeError(store.error)}
        </p>
      ) : null}
      {editing ? (
        <form
          className="flex w-full max-w-md items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            store.setServer(draft);
            setEditing(false);
            void store.open();
          }}
        >
          <Input
            data-testid="overleaf-server-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t(($) => $.library.import.overleaf.serverLabel)}
            placeholder={DEFAULT_OVERLEAF_SERVER}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="outline" data-testid="overleaf-save-server" disabled={!draft.trim()}>
            {t(($) => $.library.import.overleaf.saveServer)}
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.library.import.overleaf.server, { server: serverHost(store.server) })}{" "}
          <button
            type="button"
            data-testid="overleaf-change-server"
            disabled={signing}
            onClick={() => {
              setDraft(store.server);
              setEditing(true);
            }}
            className={LINK_BUTTON}
          >
            {t(($) => $.library.import.overleaf.useDifferentServer)}
          </button>
          {custom ? (
            <button
              type="button"
              disabled={signing}
              onClick={() => {
                store.setServer(DEFAULT_OVERLEAF_SERVER);
                void store.open();
              }}
              className={LINK_BUTTON}
            >
              {t(($) => $.library.import.overleaf.useDefaultServer)}
            </button>
          ) : null}
        </p>
      )}
    </div>
  );
}

type ItemProps = Readonly<{
  project: OverleafProject;
  mode: "pick" | "run";
  checked: boolean;
  named: boolean;
  progress: OverleafRowProgress | undefined;
  busy: boolean;
  onToggle?: (id: string) => void;
  onOpen: (projectId: string) => void;
  onRetry: (id: string) => void;
}>;

function ProjectStatus({
  project,
  progress,
  onOpen,
  onRetry,
}: Readonly<{
  project: OverleafProject;
  progress: OverleafRowProgress | undefined;
  onOpen: (projectId: string) => void;
  onRetry: () => void;
}>) {
  const { t } = useTranslation(["library"]);
  const testId = `overleaf-status-${project.id}`;
  if (progress?.phase === "queued") {
    return <span data-testid={testId} className="text-xs text-muted-foreground">{t(($) => $.library.import.overleaf.progress.queued)}</span>;
  }
  if (progress?.phase === "downloading") {
    const percent = progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;
    return (
      <span data-testid={testId} className="flex w-28 flex-col gap-1 text-xs text-muted-foreground">
        {percent === null
          ? t(($) => $.library.import.overleaf.progress.downloadingUnknown)
          : t(($) => $.library.import.overleaf.progress.downloading, { percent })}
        <Progress value={percent ?? 15} className="h-1" />
      </span>
    );
  }
  if (progress?.phase === "importing") {
    return (
      <span data-testid={testId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.library.import.overleaf.progress.importing)}
      </span>
    );
  }
  if (progress?.phase === "failed") {
    return (
      <span data-testid={testId} className="flex items-center gap-1.5 text-xs">
        <span className="max-w-56 truncate text-destructive" title={describeError(progress.error)}>
          {describeError(progress.error)}
        </span>
        <button type="button" onClick={onRetry} className={LINK_BUTTON}>
          {t(($) => $.library.import.tryAgain)}
        </button>
      </span>
    );
  }
  const imported = importedId(project, progress);
  if (!imported) return null;
  return (
    <span data-testid={testId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CheckBadge tone="success" />
      {t(($) => $.library.import.overleaf.imported)}
      <button type="button" onClick={() => onOpen(imported)} className={LINK_BUTTON}>
        {t(($) => $.library.import.overleaf.open)}
      </button>
    </span>
  );
}

function importedId(project: OverleafProject, progress: OverleafRowProgress | undefined): string | null {
  return progress?.phase === "done" ? progress.projectId : project.importedAs;
}

const ProjectRow = memo(function ProjectRow({ project, mode, checked, named, progress, busy, onToggle, onOpen, onRetry }: ItemProps) {
  const { t } = useTranslation(["library"]);
  const picking = mode === "pick";
  const details = [ownerLabel(t, project), editedLabel(project)].filter(Boolean).join(" · ");
  const text = (
    <>
      <span className="block truncate text-sm font-medium text-foreground">{project.name}</span>
      <span className="block truncate text-xs text-muted-foreground">{details}</span>
    </>
  );
  return (
    <li
      data-testid={`overleaf-project-${project.id}`}
      style={named ? { viewTransitionName: transitionName(project.id) } : undefined}
      className={cn(
        "flex items-center gap-3 px-3 py-2 transition-colors [contain-intrinsic-size:auto_3rem] [content-visibility:auto]",
        picking && checked && "bg-accent/60",
      )}
    >
      {picking ? (
        <button
          type="button"
          disabled={busy || !onToggle}
          aria-pressed={checked}
          aria-label={t(($) => $.library.import.overleaf.selectProject, { name: project.name })}
          onClick={() => onToggle?.(project.id)}
          className="min-w-0 flex-1 rounded text-left focus-visible:bg-accent/60"
        >
          {text}
        </button>
      ) : (
        <div className="min-w-0 flex-1">{text}</div>
      )}
      {project.archived ? <Badge variant="outline" size="sm">{t(($) => $.library.import.overleaf.archived)}</Badge> : null}
      <ProjectStatus project={project} progress={progress} onOpen={onOpen} onRetry={() => onRetry(project.id)} />
      {picking && checked ? <CheckBadge /> : null}
    </li>
  );
});

const ProjectBook = memo(function ProjectBook({ project, mode, checked, named, progress, busy, onToggle, onOpen, onRetry }: ItemProps) {
  const { t } = useTranslation(["library"]);
  const picking = mode === "pick";
  const imported = importedId(project, progress);
  let onClick: (() => void) | undefined;
  if (picking) onClick = busy || !onToggle ? undefined : () => onToggle(project.id);
  else if (imported) onClick = () => onOpen(imported);
  return (
    <div data-testid={`overleaf-project-${project.id}`} className="relative flex flex-col items-center gap-1.5 [contain-intrinsic-size:auto_14rem] [content-visibility:auto]">
      <div className="relative rounded-md" style={named ? { viewTransitionName: transitionName(project.id) } : undefined}>
        <Book
          title={project.name}
          color={bookColor(project.id)}
          date={editedLabel(project)}
          width={120}
          onClick={onClick}
          openLabel={bookLabel(t, project, picking && Boolean(onToggle), !picking && Boolean(imported))}
          pressed={picking ? checked : undefined}
          dimmed={picking && !checked && busy}
          badge={picking && checked ? <CheckBadge className="size-[1.125rem] shadow-sm [&_svg]:size-2.5" /> : undefined}
        />
      </div>
      <ProjectStatus project={project} progress={progress} onOpen={onOpen} onRetry={() => onRetry(project.id)} />
    </div>
  );
});

function bookLabel(t: LibraryTranslate, project: OverleafProject, selectable: boolean, openable: boolean): string {
  if (selectable) return t(($) => $.library.import.overleaf.selectProject, { name: project.name });
  if (openable) return t(($) => $.library.projects.open, { name: project.name });
  return project.name;
}

function runSummary(
  t: LibraryTranslate,
  importing: boolean,
  rows: readonly (OverleafRowProgress | undefined)[],
): string {
  if (importing) return t(($) => $.library.import.overleaf.importingProjects);
  const doneCount = rows.filter((row) => row?.phase === "done").length;
  const failedCount = rows.filter((row) => row?.phase === "failed").length;
  const parts = [t(($) => $.library.import.overleaf.doneSummary, { count: doneCount })];
  if (failedCount > 0) parts.push(t(($) => $.library.import.overleaf.failedSummary, { count: failedCount }));
  return parts.join(" ");
}

function ImportRun({
  onOpenProject,
  onDone,
}: Readonly<{ onOpenProject: (projectId: string) => void; onDone: () => void }>) {
  const { t } = useTranslation(["library"]);
  const layout = useSettingsStore((state) => state.homeProjectLayout);
  const run = useOverleafImportStore((state) => state.run);
  const projects = useOverleafImportStore((state) => state.projects);
  const progress = useOverleafImportStore((state) => state.progress);
  const importing = useOverleafImportStore((state) => state.importing);
  const finishRun = useOverleafImportStore((state) => state.finishRun);
  const items = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    return (run ?? []).flatMap((id) => byId.get(id) ?? []);
  }, [projects, run]);
  const named = items.length <= MAX_NAMED_CARDS;
  const itemProps = (project: OverleafProject) => ({
    project,
    mode: "run" as const,
    checked: true,
    named,
    progress: progress[project.id],
    busy: importing,
    onOpen: onOpenProject,
    onRetry: retryImport,
  });

  return (
    <div data-testid="overleaf-import-run" className="flex min-h-0 flex-1 flex-col gap-3">
      <p data-testid="overleaf-run-summary" className="flex items-center gap-2 text-sm font-medium text-foreground">
        {importing ? <Spinner size="sm" /> : null}
        {runSummary(t, importing, items.map((project) => progress[project.id]))}
      </p>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-5 pb-2">
            {items.map((project) => (
              <ProjectBook key={project.id} {...itemProps(project)} />
            ))}
          </div>
        ) : (
          <ul className="divide-y overflow-hidden rounded-lg border">
            {items.map((project) => (
              <ProjectRow key={project.id} {...itemProps(project)} />
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="min-w-0 text-xs text-muted-foreground">{t(($) => $.library.import.overleaf.notCarried)}</p>
        <Button
          type="button"
          data-testid="overleaf-import-done"
          disabled={importing}
          onClick={() => {
            finishRun();
            onDone();
          }}
        >
          {t(($) => $.library.import.overleaf.done)}
        </Button>
      </div>
    </div>
  );
}
