import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nextProvider, useTranslation } from "react-i18next";
import { Package, Search } from "lucide-react";
import { create } from "zustand";
import { i18n } from "@/i18n";
import { ModalShell } from "@/components/ui/modal-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/empty";
import { describeError } from "@/lib/app-error";
import { formatDate } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

const MAX_ROWS = 100;
const NO_PACKAGES: readonly never[] = [];

const CHIP =
  "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors hover:bg-accent focus-visible:bg-accent";
const CHIP_ACTIVE = "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 focus-visible:bg-primary/20";

export interface PackageList<P> {
  readonly packages: readonly P[];
  readonly fetchedAt: number | null;
  readonly stale: boolean;
  readonly partial?: boolean;
}

export interface PackagesDialogLabels {
  title(): string;
  close(): string;
  searchLabel(): string;
  searchPlaceholder(): string;
  categories?(): string;
  allCategories?(): string;
  loading(): string;
  empty(): string;
  results(count: number): string;
  resultsCapped(shown: number, count: number): string;
  stale(date: string): string;
  staleOffline(date: string): string;
  partial?(offline: boolean): string;
}

export interface PackagesProvider<P, C> {
  readonly id: string;
  readonly labels: PackagesDialogLabels;
  load(options: { offline: boolean; refresh: boolean }): Promise<PackageList<P>>;
  key(pkg: P): string;
  search(packages: readonly P[], query: string, category: string | null): P[];
  categories?(packages: readonly P[]): string[];
  useRowContext(open: boolean, onClose: () => void): C;
  renderNotice?(context: C): ReactNode;
  renderRow(pkg: P, context: C): ReactNode;
  renderFooter?(context: C): ReactNode;
}

type ListState<P> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly list: PackageList<P> }
  | { readonly status: "error"; readonly message: string };

function listNotice<P>(
  labels: PackagesDialogLabels,
  list: PackageList<P>,
  offline: boolean,
): string | null {
  if (list.partial && labels.partial) return labels.partial(offline);
  if (!list.stale || list.fetchedAt === null) return null;
  const date = formatDate(list.fetchedAt, { dateStyle: "medium" });
  return offline ? labels.staleOffline(date) : labels.stale(date);
}

export function PackagesDialog<P, C>({
  provider,
  open,
  onClose,
}: Readonly<{ provider: PackagesProvider<P, C>; open: boolean; onClose: () => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  const offline = useSettingsStore((state) => state.offline);
  const [listState, setListState] = useState<ListState<P>>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const request = useRef(0);
  const context = provider.useRowContext(open, onClose);
  const { labels } = provider;
  const titleId = `${provider.id}-packages-title`;

  const load = useCallback(
    (refresh: boolean) => {
      const current = ++request.current;
      setListState({ status: "loading" });
      provider.load({ offline, refresh }).then(
        (list) => {
          if (current === request.current) setListState({ status: "ready", list });
        },
        (failure: unknown) => {
          if (current === request.current) setListState({ status: "error", message: describeError(failure) });
        },
      );
    },
    [offline, provider],
  );

  useEffect(() => {
    if (!open) return;
    load(false);
    return () => {
      request.current += 1;
    };
  }, [open, load]);

  const packages: readonly P[] = listState.status === "ready" ? listState.list.packages : NO_PACKAGES;
  const categories = useMemo(() => provider.categories?.(packages) ?? [], [provider, packages]);
  const results = useMemo(() => provider.search(packages, query, category), [provider, packages, query, category]);

  const summary =
    results.length > MAX_ROWS ? labels.resultsCapped(MAX_ROWS, results.length) : labels.results(results.length);
  const notice = listState.status === "ready" ? listNotice(labels, listState.list, offline) : null;
  const providerNotice = provider.renderNotice?.(context);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeLabel={labels.close()}
      align="top"
      portal
      labelledBy={titleId}
      className="flex max-h-[75vh] w-[40rem] max-w-[92vw] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Package aria-hidden="true" className="size-4 text-muted-foreground" />
        <span id={titleId} className="text-sm font-semibold">
          {labels.title()}
        </span>
      </div>
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center gap-2 rounded-md bg-muted/30 py-1 pl-2.5 pr-1 dark:bg-background">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <Input
            data-modal-initial-focus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder()}
            aria-label={labels.searchLabel()}
            maxLength={128}
            className="h-8 w-full border-0 bg-transparent text-sm shadow-none placeholder:text-muted-foreground"
          />
        </div>
        {categories.length > 0 && (
          <fieldset className="flex flex-wrap gap-1">
            <legend className="sr-only">{labels.categories?.()}</legend>
            <button
              type="button"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
              className={cn(CHIP, category === null && CHIP_ACTIVE)}
            >
              {labels.allCategories?.()}
            </button>
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(category === name ? null : name)}
                className={cn(CHIP, category === name && CHIP_ACTIVE)}
              >
                {name}
              </button>
            ))}
          </fieldset>
        )}
      </div>
      {providerNotice && <div className="flex flex-col gap-1.5 border-b px-3 py-2">{providerNotice}</div>}
      <div className="min-h-0 flex-1 overflow-auto">
        {listState.status === "loading" && <LoadingState className="p-3" label={labels.loading()} />}
        {listState.status === "error" && (
          <ErrorState className="p-3" message={listState.message}>
            <Button type="button" size="sm" variant="outline" onClick={() => load(true)}>
              {t(($) => $.common.actions.retry)}
            </Button>
          </ErrorState>
        )}
        {listState.status === "ready" && (
          <>
            <div className="flex flex-col gap-0.5 px-3 pt-2.5 pb-1.5">
              <p className="text-xs text-muted-foreground">{summary}</p>
              {notice && <p className="text-[11px] text-muted-foreground">{notice}</p>}
            </div>
            {results.length === 0 ? (
              <p className="px-3 pb-3 text-xs text-muted-foreground">{labels.empty()}</p>
            ) : (
              results.slice(0, MAX_ROWS).map((pkg) => (
                <Fragment key={provider.key(pkg)}>{provider.renderRow(pkg, context)}</Fragment>
              ))
            )}
          </>
        )}
      </div>
      {provider.renderFooter?.(context)}
    </ModalShell>
  );
}

type AnyPackagesProvider = PackagesProvider<unknown, unknown>;

const useDialogState = create<{ provider: AnyPackagesProvider | null; open: boolean }>(() => ({
  provider: null,
  open: false,
}));

function closeDialog(): void {
  useDialogState.setState({ open: false });
}

function PackagesDialogHost() {
  const provider = useDialogState((state) => state.provider);
  const open = useDialogState((state) => state.open);
  if (!provider) return null;
  return <PackagesDialog key={provider.id} provider={provider} open={open} onClose={closeDialog} />;
}

let root: Root | null = null;

export function showPackagesDialog<P, C>(provider: PackagesProvider<P, C>): void {
  if (!root) {
    const container = document.createElement("div");
    container.dataset.packagesDialog = "";
    document.body.append(container);
    root = createRoot(container);
    root.render(
      <I18nextProvider i18n={i18n}>
        <PackagesDialogHost />
      </I18nextProvider>,
    );
  }
  useDialogState.setState({ provider: provider as unknown as AnyPackagesProvider, open: true });
}
