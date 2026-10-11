import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCw, Search } from "lucide-react";
import { Book, BOOK_SWATCHES } from "@/components/library/Book";
import { LayoutToggle } from "@/components/library/LayoutToggle";
import { OverleafBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { DEFAULT_OVERLEAF_SERVER, isOverleafError, type OverleafProject } from "@/lib/overleaf";
import { projectModifiedLabel } from "@/lib/project-format";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useOverleafImportStore, type OverleafRowProgress } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";

type Filter = "all" | "owned" | "shared";

function bookColor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
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

export function OverleafImportView({
  onOpenProject,
}: Readonly<{ onOpenProject: (projectId: string) => void }>) {
  const { t } = useTranslation(["library"]);
  const store = useOverleafImportStore();
  const layout = useSettingsStore((state) => state.homeProjectLayout);
  const setLayout = useSettingsStore((state) => state.setHomeProjectLayout);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const selectAllId = useId();
  const { open } = store;

  useEffect(() => {
    void open();
  }, [open]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return store.projects.filter((project) => {
      if (filter === "owned" && !project.owned) return false;
      if (filter === "shared" && project.owned) return false;
      if (!needle) return true;
      return `${project.name} ${project.ownerName ?? ""}`.toLocaleLowerCase().includes(needle);
    });
  }, [store.projects, query, filter]);

  if (store.phase === "idle" || store.phase === "checking" || store.phase === "loading") {
    return (
      <output data-testid="overleaf-import-loading" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner />
        {store.phase === "loading"
          ? t(($) => $.library.import.overleaf.loading)
          : t(($) => $.library.import.overleaf.checking)}
      </output>
    );
  }

  if (store.phase === "signed-out" || store.phase === "signing-in") {
    return <SignInPanel />;
  }

  if (store.phase === "error") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <p role="alert" className="select-text text-sm text-destructive">
          {isOverleafError(store.error, "unrecognized")
            ? describeError(store.error)
            : t(($) => $.library.import.overleaf.loadFailed)}
        </p>
        {!isOverleafError(store.error, "unrecognized") && store.error ? (
          <p className="select-text text-xs text-muted-foreground">{describeError(store.error)}</p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => void store.open()}>
          <RotateCw aria-hidden className="size-3.5" />
          {t(($) => $.library.import.tryAgain)}
        </Button>
      </div>
    );
  }

  const selected = new Set(store.selected);
  const visibleIds = visible.map((project) => project.id);
  const visibleSelected = visibleIds.filter((id) => selected.has(id)).length;
  const allChecked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
  const anyImportedSelected = store.projects.some((project) => selected.has(project.id) && project.importedAs);
  const doneCount = Object.values(store.progress).filter((row) => row.phase === "done").length;
  const failedCount = Object.values(store.progress).filter((row) => row.phase === "failed").length;

  const toggleAll = () => {
    if (allChecked) {
      store.setSelected(store.selected.filter((id) => !visibleIds.includes(id)));
    } else {
      store.setSelected([...store.selected, ...visibleIds]);
    }
  };

  const runImport = async (ids?: readonly string[]) => {
    const outcomes = await store.importSelected(ids);
    if (outcomes.some((outcome) => outcome.projectId)) {
      await useFilesStore.getState().refreshProjects();
    }
  };

  return (
    <div data-testid="overleaf-import-view" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="overleaf-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t(($) => $.library.import.overleaf.searchLabel)}
            placeholder={t(($) => $.library.import.overleaf.searchPlaceholder, { count: store.projects.length })}
            className="h-8 pl-8"
          />
        </div>
        <fieldset
          aria-label={t(($) => $.library.import.overleaf.filterLabel)}
          className="flex items-center rounded-lg border p-0.5"
        >
          {(["all", "owned", "shared"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              data-testid={`overleaf-filter-${value}`}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors focus-visible:bg-accent/60 focus-visible:text-foreground",
                filter === value ? "bg-accent text-foreground" : "hover:text-foreground",
              )}
            >
              {value === "all"
                ? t(($) => $.library.import.overleaf.filter.all)
                : value === "owned"
                  ? t(($) => $.library.import.overleaf.filter.owned)
                  : t(($) => $.library.import.overleaf.filter.shared)}
            </button>
          ))}
        </fieldset>
        <LayoutToggle value={layout} onChange={setLayout} className="border p-0.5" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <Checkbox
            id={selectAllId}
            data-testid="overleaf-select-all"
            checked={allChecked ? true : visibleSelected > 0 ? "indeterminate" : false}
            disabled={visibleIds.length === 0 || store.importing}
            onCheckedChange={toggleAll}
          />
          <label htmlFor={selectAllId}>{t(($) => $.library.import.overleaf.selectAll)}</label>
        </span>
        <span className="flex items-center gap-2">
          <span className="truncate">
            {store.status?.email
              ? t(($) => $.library.import.overleaf.signedInAs, { email: store.status.email })
              : t(($) => $.library.import.overleaf.signedIn)}
          </span>
          <button
            type="button"
            data-testid="overleaf-sign-out"
            disabled={store.importing}
            onClick={() => void store.signOut()}
            className="rounded px-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
          >
            {t(($) => $.library.import.overleaf.signOut)}
          </button>
        </span>
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {store.projects.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t(($) => $.library.import.overleaf.empty)}</p>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t(($) => $.library.import.overleaf.noMatches)}</p>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-5 pb-2">
            {visible.map((project) => (
              <ProjectBook
                key={project.id}
                project={project}
                checked={selected.has(project.id)}
                progress={store.progress[project.id]}
                busy={store.importing}
                onToggle={() => store.toggle(project.id)}
                onOpen={onOpenProject}
                onRetry={() => void runImport([project.id])}
              />
            ))}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {visible.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                checked={selected.has(project.id)}
                progress={store.progress[project.id]}
                busy={store.importing}
                onToggle={() => store.toggle(project.id)}
                onOpen={onOpenProject}
                onRetry={() => void runImport([project.id])}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0 space-y-0.5 text-xs text-muted-foreground">
          <p data-testid="overleaf-selection-summary" className="font-medium text-foreground">
            {doneCount > 0 || failedCount > 0
              ? [
                  doneCount > 0 ? t(($) => $.library.import.overleaf.doneSummary, { count: doneCount }) : null,
                  failedCount > 0 ? t(($) => $.library.import.overleaf.failedSummary, { count: failedCount }) : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : t(($) => $.library.import.overleaf.selected, { count: store.selected.length })}
          </p>
          <p>
            {anyImportedSelected
              ? t(($) => $.library.import.overleaf.copyNote)
              : t(($) => $.library.import.overleaf.notCarried)}
          </p>
        </div>
        <Button
          type="button"
          data-testid="overleaf-import-selected"
          disabled={store.selected.length === 0 || store.importing}
          onClick={() => void runImport()}
        >
          {store.importing ? <Spinner size="sm" /> : null}
          {t(($) => $.library.import.overleaf.import, { count: store.selected.length })}
        </Button>
      </div>
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
    <div data-testid="overleaf-sign-in-panel" className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-8 text-center">
      <OverleafBrandIcon className="size-8 text-[#47A141]" />
      <p className="max-w-md text-sm text-muted-foreground">
        {signing
          ? t(($) => $.library.import.overleaf.signingIn)
          : expired
            ? t(($) => $.library.import.overleaf.expired)
            : t(($) => $.library.import.overleaf.signInPrompt)}
      </p>
      <Button
        type="button"
        data-testid="overleaf-sign-in"
        disabled={signing}
        onClick={() => void store.signIn(t(($) => $.library.import.overleaf.signInWindowTitle))}
      >
        {signing ? <Spinner size="sm" /> : null}
        {t(($) => $.library.import.overleaf.signIn)}
      </Button>
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
          <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
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
            className="rounded px-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
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
              className="rounded px-1 font-medium text-foreground transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
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
  checked: boolean;
  progress: OverleafRowProgress | undefined;
  busy: boolean;
  onToggle: () => void;
  onOpen: (projectId: string) => void;
  onRetry: () => void;
}>;

function ProjectStatus({ project, progress, onOpen, onRetry }: Pick<ItemProps, "project" | "progress" | "onOpen" | "onRetry">) {
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
        <button type="button" onClick={onRetry} className="rounded px-1 font-medium text-foreground hover:bg-accent focus-visible:bg-accent">
          {t(($) => $.library.import.tryAgain)}
        </button>
      </span>
    );
  }
  const imported = progress?.phase === "done" ? progress.projectId : project.importedAs;
  if (imported) {
    return (
      <span data-testid={testId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckBadge tone="success" />
        {t(($) => $.library.import.overleaf.imported)}
        <button
          type="button"
          onClick={() => onOpen(imported)}
          className="rounded px-1 font-medium text-foreground hover:bg-accent focus-visible:bg-accent"
        >
          {t(($) => $.library.import.overleaf.open)}
        </button>
      </span>
    );
  }
  return null;
}

function ProjectRow({ project, checked, progress, busy, onToggle, onOpen, onRetry }: ItemProps) {
  const { t } = useTranslation(["library"]);
  const edited = editedLabel(project);
  return (
    <li data-testid={`overleaf-project-${project.id}`} className="flex items-center gap-3 px-3 py-2 [contain-intrinsic-size:auto_3rem] [content-visibility:auto]">
      <Checkbox
        checked={checked}
        disabled={busy}
        onCheckedChange={onToggle}
        aria-label={t(($) => $.library.import.overleaf.selectProject, { name: project.name })}
      />
      <button type="button" disabled={busy} onClick={onToggle} className="min-w-0 flex-1 rounded text-left focus-visible:bg-accent/60">
        <span className="block truncate text-sm font-medium text-foreground">{project.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[
            project.owned ? t(($) => $.library.import.overleaf.ownedByYou) : project.ownerName ? t(($) => $.library.import.overleaf.owner, { name: project.ownerName }) : null,
            edited,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </button>
      {project.archived ? <Badge variant="outline" size="sm">{t(($) => $.library.import.overleaf.archived)}</Badge> : null}
      <ProjectStatus project={project} progress={progress} onOpen={onOpen} onRetry={onRetry} />
    </li>
  );
}

function ProjectBook({ project, checked, progress, busy, onToggle, onOpen, onRetry }: ItemProps) {
  const { t } = useTranslation(["library"]);
  return (
    <div data-testid={`overleaf-project-${project.id}`} className="relative flex flex-col items-center gap-1.5 [contain-intrinsic-size:auto_14rem] [content-visibility:auto]">
      <div className={cn("relative rounded-md transition-opacity", busy && !checked && "opacity-60")}>
        <Book
          title={project.name}
          color={bookColor(project.id)}
          date={editedLabel(project)}
          width={120}
          onClick={busy ? undefined : onToggle}
          openLabel={t(($) => $.library.import.overleaf.selectProject, { name: project.name })}
          dimmed={!checked && busy}
        />
        <Checkbox
          checked={checked}
          disabled={busy}
          onCheckedChange={onToggle}
          aria-label={t(($) => $.library.import.overleaf.selectProject, { name: project.name })}
          className="absolute left-2 top-2 z-10 bg-background/90"
        />
      </div>
      <ProjectStatus project={project} progress={progress} onOpen={onOpen} onRetry={onRetry} />
    </div>
  );
}
