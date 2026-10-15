import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Search } from "lucide-react";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatBytes } from "@/lib/format-bytes";
import { formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import type {
  CollabAdminProject,
  CollabAdminProjectSort,
  CollabAdminProjectsQuery,
  CollabProjectStatus,
  CollabSortOrder,
} from "@/lib/tauri";
import {
  collabAdminArchiveProject,
  collabAdminProjects,
  collabAdminUnarchiveProject,
} from "@/lib/tauri-collab";
import { useBusyRows } from "../busy-rows";
import { collabErrorText } from "../errors";
import { InactiveBadge, isInactive } from "../InactiveBadge";
import { InlineAlert, LoadFailed } from "../feedback";
import { collabPerson } from "../people";
import { serverRoleAllows, type ServerRole } from "../roles";

export const PROJECTS_PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 300;

const FILTERS = ["all", "active", "archived", "pending"] as const;
type Filter = (typeof FILTERS)[number];

type Column = Exclude<CollabAdminProjectSort, "created">;
const COLUMNS: readonly Column[] = ["title", "owner", "members", "size", "activity"];
const NUMERIC: ReadonlySet<Column> = new Set<Column>(["members", "size"]);
const ASCENDING_FIRST: ReadonlySet<Column> = new Set<Column>(["title", "owner"]);

const STATUS_BADGE = {
  archived: "muted",
  pending: "info",
  unknown: "muted",
} as const satisfies Record<Exclude<CollabProjectStatus, "active">, BadgeVariant>;

interface Sorting {
  readonly column: Column;
  readonly order: CollabSortOrder;
}

interface Load {
  readonly serverId: string;
  readonly query: CollabAdminProjectsQuery;
  readonly request: number;
}

// Each answer keeps the request it answers, so a later page is only added to
// the list it continues, and a list for an older search reads as loading.
type ListState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly load: Load; readonly message: string }
  | {
      readonly status: "ready";
      readonly load: Load;
      readonly items: CollabAdminProject[];
      readonly next: string | null;
      readonly total: number;
    };

type MoreState =
  | { readonly status: "loading"; readonly load: Load }
  | { readonly status: "failed"; readonly load: Load; readonly message: string };

function ariaSort(sorting: Sorting, column: Column): "ascending" | "descending" | "none" {
  if (sorting.column !== column) return "none";
  return sorting.order === "asc" ? "ascending" : "descending";
}

function SortArrow({ order }: Readonly<{ order: Sorting["order"] }>) {
  return order === "asc" ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />;
}

function StatusBadge({ status }: Readonly<{ status: CollabProjectStatus }>) {
  const { t } = useTranslation(["collab"]);
  if (status === "active") return null;
  return (
    <Badge variant={STATUS_BADGE[status]} size="sm">
      {t(($) => $.collab.console.projects.status[status])}
    </Badge>
  );
}

export function ProjectsSection({
  serverId,
  actor,
  archiveDays,
  now,
}: Readonly<{ serverId: string; actor: ServerRole; archiveDays: number | null; now: number }>) {
  const { t } = useTranslation(["collab"]);
  const canArchive = serverRoleAllows(actor, "deleteProjectForStorage");
  const showSize = serverRoleAllows(actor, "viewStorage");
  const columns = COLUMNS.filter((column) => column !== "size" || showSize);
  const [search, setSearch] = useState("");
  const searched = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const [filter, setFilter] = useState<Filter>("all");
  const [sorting, setSorting] = useState<Sorting>({ column: "activity", order: "desc" });
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [request, setRequest] = useState(0);
  const [more, setMore] = useState<MoreState | null>(null);
  const rows = useBusyRows();
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirming, setConfirming] = useState<CollabAdminProject | null>(null);

  const query = useMemo<CollabAdminProjectsQuery>(
    () => ({
      q: searched === "" ? null : searched,
      status: filter === "all" ? null : filter,
      sort: sorting.column,
      order: sorting.order,
      cursor: null,
      limit: PROJECTS_PAGE_SIZE,
    }),
    [searched, filter, sorting],
  );

  const load = useMemo<Load>(() => ({ serverId, query, request }), [serverId, query, request]);

  useEffect(() => {
    let active = true;
    collabAdminProjects(load.serverId, load.query).then(
      (page) => {
        if (active) setList({ status: "ready", load, items: page.items, next: page.next_cursor, total: page.total });
      },
      (error: unknown) => {
        if (active) setList({ status: "failed", load, message: collabErrorText(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  // The list on screen answers an earlier search, filter or sort.
  const refreshing = list.status === "ready" && list.load !== load;
  const loadingMore = list.status === "ready" && more?.status === "loading" && more.load === list.load;
  const moreError =
    list.status === "ready" && more?.status === "failed" && more.load === list.load ? more.message : null;

  const loadMore = async () => {
    if (list.status !== "ready" || !list.next) return;
    const from = list;
    setMore({ status: "loading", load: from.load });
    try {
      const page = await collabAdminProjects(from.load.serverId, { ...from.load.query, cursor: from.next });
      setList((current) =>
        current.status === "ready" && current.load === from.load && current.next === from.next
          ? { ...current, items: [...current.items, ...page.items], next: page.next_cursor, total: page.total }
          : current,
      );
      setMore((current) => (current?.load === from.load ? null : current));
    } catch (error) {
      setMore((current) =>
        current?.load === from.load ? { status: "failed", load: from.load, message: collabErrorText(error) } : current,
      );
    }
  };

  const replace = (next: CollabAdminProject) =>
    setList((current) =>
      current.status === "ready"
        ? {
            ...current,
            items: current.items.map((item) => (item.project_id === next.project_id ? next : item)),
          }
        : current,
    );

  const change = (project: CollabAdminProject, archive: boolean) => {
    setConfirming(null);
    const id = project.project_id;
    return rows.run(id, async () => {
      setRowError((current) => (current?.id === id ? null : current));
      try {
        replace(
          archive ? await collabAdminArchiveProject(serverId, id) : await collabAdminUnarchiveProject(serverId, id),
        );
      } catch (error) {
        setRowError({ id, message: collabErrorText(error) });
      }
    });
  };

  const sortBy = (column: Column) =>
    setSorting((current) =>
      current.column === column
        ? { column, order: current.order === "asc" ? "desc" : "asc" }
        : { column, order: ASCENDING_FIRST.has(column) ? "asc" : "desc" },
    );

  const columnCount = columns.length + (canArchive ? 1 : 0);

  const renderAction = (project: CollabAdminProject) => {
    const busy = rows.busy.has(project.project_id);
    if (project.status === "archived") {
      return (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          aria-label={t(($) => $.collab.console.projects.restoreNamed, { title: project.title })}
          onClick={() => void change(project, false)}
        >
          {busy ? <Spinner /> : <ArchiveRestore aria-hidden />}
          {t(($) => $.collab.console.projects.restore)}
        </Button>
      );
    }
    return (
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="hover:bg-destructive/10 hover:text-destructive"
        disabled={busy}
        aria-label={t(($) => $.collab.console.projects.archiveNamed, { title: project.title })}
        onClick={() => setConfirming(project)}
      >
        {busy ? <Spinner /> : <Archive aria-hidden />}
        {t(($) => $.collab.console.projects.archive)}
      </Button>
    );
  };

  const renderRow = (project: CollabAdminProject) => (
    <TableRow key={project.project_id} data-testid={`console-project-${project.project_id}`}>
      <TableCell className="max-w-64">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{project.title}</span>
          <StatusBadge status={project.status} />
        </div>
      </TableCell>
      <TableCell className="max-w-48">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar person={collabPerson(project.owner)} size="sm" />
          <span className="truncate">{project.owner.display_name}</span>
          {isInactive(project.owner) ? <InactiveBadge /> : null}
        </div>
      </TableCell>
      <TableCell numeric>{formatNumber(project.member_count)}</TableCell>
      {showSize ? (
        <TableCell numeric className="whitespace-nowrap">
          {project.size_bytes === null ? null : formatBytes(project.size_bytes)}
        </TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap text-muted-foreground">
        <time dateTime={new Date(project.last_activity_at).toISOString()}>
          {formatRelativeTimeFrom(project.last_activity_at, now)}
        </time>
      </TableCell>
      {canArchive ? <TableCell className="text-right">{renderAction(project)}</TableCell> : null}
    </TableRow>
  );

  const renderList = () => {
    if (list.status === "loading" || (list.status === "failed" && list.load !== load)) {
      return <LoadingState size="compact" label={t(($) => $.collab.console.projects.loading)} />;
    }
    if (list.status === "failed") {
      return (
        <LoadFailed
          message={t(($) => $.collab.admin.loadFailed)}
          reason={list.message}
          onRetry={() => setRequest((count) => count + 1)}
        />
      );
    }
    if (list.items.length === 0) {
      const filtered = searched !== "" || filter !== "all";
      return (
        <EmptyState
          size="compact"
          className="rounded-lg border border-dashed px-4 py-6"
          title={filtered ? t(($) => $.collab.console.projects.noMatches) : t(($) => $.collab.console.projects.empty)}
        />
      );
    }
    return (
      <>
        <Table
          containerClassName={cn("rounded-lg border", refreshing && "opacity-60")}
          aria-busy={refreshing || undefined}
        >
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} numeric={NUMERIC.has(column)} aria-sort={ariaSort(sorting, column)}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="-mx-2 font-medium uppercase tracking-wide"
                    aria-label={t(($) => $.collab.console.projects.sortBy, {
                      column: t(($) => $.collab.console.projects.columns[column]),
                    })}
                    onClick={() => sortBy(column)}
                  >
                    {t(($) => $.collab.console.projects.columns[column])}
                    {sorting.column === column ? <SortArrow order={sorting.order} /> : null}
                  </Button>
                </TableHead>
              ))}
              {canArchive ? (
                <TableHead>
                  <span className="sr-only">{t(($) => $.collab.console.projects.columns.actions)}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.items.flatMap((project) => [
              renderRow(project),
              rowError?.id === project.project_id ? (
                <TableRow key={`${project.project_id}-error`}>
                  <TableCell colSpan={columnCount}>
                    <InlineAlert>{rowError.message}</InlineAlert>
                  </TableCell>
                </TableRow>
              ) : null,
            ])}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            {t(($) => $.collab.console.projects.count, {
              shown: formatNumber(list.items.length),
              total: formatNumber(list.total),
            })}
          </p>
          {list.next ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingMore || refreshing}
              onClick={() => void loadMore()}
            >
              {loadingMore ? <Spinner /> : null}
              {t(($) => $.collab.console.projects.loadMore)}
            </Button>
          ) : null}
        </div>
        {moreError ? <InlineAlert>{moreError}</InlineAlert> : null}
      </>
    );
  };

  return (
    <div className="space-y-3" data-testid="console-projects">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.console.projects.description)}</p>
      {canArchive ? null : <SettingsNote>{t(($) => $.collab.console.projects.adminOnly)}</SettingsNote>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t(($) => $.collab.console.projects.searchPlaceholder)}
            aria-label={t(($) => $.collab.console.projects.searchLabel)}
            maxLength={200}
            className="pl-8"
          />
        </div>
        <ButtonGroup aria-label={t(($) => $.collab.console.projects.filterLabel)}>
          {FILTERS.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={filter === option ? "secondary" : "outline"}
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
            >
              {t(($) => $.collab.console.projects.filter[option])}
            </Button>
          ))}
        </ButtonGroup>
        {refreshing ? <LoadingState size="compact" label={t(($) => $.collab.console.projects.loading)} /> : null}
      </div>
      {renderList()}
      <ConfirmationDialog
        open={confirming !== null}
        title={t(($) => $.collab.console.projects.archiveConfirm.title, { title: confirming?.title ?? "" })}
        description={
          archiveDays === null
            ? t(($) => $.collab.console.projects.archiveConfirm.descriptionLater)
            : t(($) => $.collab.console.projects.archiveConfirm.description, { days: formatNumber(archiveDays) })
        }
        confirmLabel={t(($) => $.collab.console.projects.archiveConfirm.confirm)}
        destructive
        onConfirm={() => {
          if (confirming) void change(confirming, true);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
