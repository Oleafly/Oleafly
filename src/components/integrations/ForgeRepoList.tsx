import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Lock, Search } from "@/components/icons/pack";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { ForgeBrandIcon } from "@/components/settings/git-hosting/ForgeBrandIcon";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import { logError } from "@/lib/log";
import { forgeListRepos, type ForgeAccount, type ForgeRepo } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 300;

export function ForgeRepoList({
  account,
  selectedId = null,
  onSelect,
  disabled = false,
  renderTrailing,
  rowTestIdPrefix,
}: Readonly<{
  account: ForgeAccount;
  selectedId?: string | null;
  onSelect: (repo: ForgeRepo) => void;
  disabled?: boolean;
  renderTrailing?: (repo: ForgeRepo) => ReactNode;
  rowTestIdPrefix?: string;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const serverSearch = account.kind === "gitlab";
  const [query, setQuery] = useState("");
  const serverQuery = useDebouncedValue(serverSearch ? query.trim() : "", SEARCH_DEBOUNCE_MS);
  const [repos, setRepos] = useState<ForgeRepo[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<false | "first" | "more">(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const listRef = useScrollTopOnChange(query);

  const load = useCallback(
    async (page: number, append: boolean) => {
      const id = ++request.current;
      setLoading(true);
      setFailed(false);
      try {
        const result = await forgeListRepos(account.base, page, serverSearch ? serverQuery || null : null);
        if (id !== request.current) return;
        setRepos((previous) => (append ? [...previous, ...result.repos] : result.repos));
        setNextPage(result.nextPage);
        setSearched(result.searched);
      } catch (error) {
        if (id !== request.current) return;
        void logError("forge list repos", error);
        setFailed(append ? "more" : "first");
      } finally {
        if (id === request.current) setLoading(false);
      }
    },
    [account.base, serverSearch, serverQuery],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the retry counter explicitly starts another request.
  useEffect(() => {
    setRepos([]);
    setNextPage(null);
    void load(1, false);
    return () => {
      request.current += 1;
    };
  }, [load, attempt]);

  const needle = query.trim().toLowerCase();
  const filteringLoaded = !searched && needle !== "";
  const visible = filteringLoaded ? repos.filter((repo) => repo.fullName.toLowerCase().includes(needle)) : repos;

  const renderRows = () => {
    if (failed === "first") {
      return (
        <ErrorState
          size="compact"
          className="items-center p-4 text-center"
          message={t(($) => $.library.import.repositoriesFailed)}
        >
          <Button size="xs" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            {t(($) => $.library.import.tryAgain)}
          </Button>
        </ErrorState>
      );
    }
    if (loading && repos.length === 0) {
      return (
        <LoadingState size="compact" className="justify-center p-6" label={t(($) => $.common.state.loading)} />
      );
    }
    if (visible.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="p-6"
          description={
            filteringLoaded && nextPage
              ? t(($) => $.library.import.noMatchLoaded)
              : t(($) => $.library.github.noRepositories)
          }
        />
      );
    }
    return visible.map((repo) => (
      <div
        key={repo.id || repo.fullName}
        className={cn(
          "group flex items-center border-b last:border-0 hover:bg-accent/60",
          selectedId === repo.id && "bg-accent",
        )}
      >
        <button
          type="button"
          disabled={disabled}
          data-testid={rowTestIdPrefix ? `${rowTestIdPrefix}${repo.fullName}` : undefined}
          onClick={() => onSelect(repo)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs focus-visible:bg-accent disabled:opacity-60"
        >
          <ForgeBrandIcon
            base={account.base}
            kind={account.kind}
            flavor={account.flavor}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate font-mono">{repo.fullName}</span>
          {repo.private ? (
            <Tooltip label={t(($) => $.library.import.privateRepository)} side="top">
              <span role="img" aria-label={t(($) => $.library.import.privateRepository)} className="inline-flex shrink-0">
                <Lock aria-hidden className="size-3 text-muted-foreground" />
              </span>
            </Tooltip>
          ) : null}
          {selectedId === repo.id ? <Check className="size-3.5 shrink-0 text-emerald-500" /> : null}
        </button>
        {renderTrailing ? <span className="shrink-0 pr-2">{renderTrailing(repo)}</span> : null}
      </div>
    ));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border px-3 transition-colors focus-within:border-ring">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(($) => $.library.github.searchPlaceholder)}
          aria-label={t(($) => $.library.github.searchRepositories)}
          className="h-10 flex-1 rounded-none border-0 bg-transparent px-0 text-xs shadow-none"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto rounded-md border">
        {renderRows()}
        {failed === "more" && nextPage ? (
          <ErrorState
            size="compact"
            className="items-center border-t p-3 text-center"
            message={t(($) => $.library.import.repositoriesFailed)}
          >
            <Button size="xs" variant="outline" onClick={() => void load(nextPage, true)}>
              {t(($) => $.library.import.tryAgain)}
            </Button>
          </ErrorState>
        ) : null}
        {nextPage && !failed ? (
          <div className="flex justify-center border-t p-2">
            <Button
              size="xs"
              variant="ghost"
              data-testid="forge-repo-load-more"
              disabled={loading}
              onClick={() => void load(nextPage, true)}
            >
              {loading ? <Spinner size="sm" /> : null}
              {t(($) => $.library.import.loadMore)}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
