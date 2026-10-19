import { Fragment, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { ExternalLink, GitBranch, Lock } from "lucide-react";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { hostLabel } from "@/lib/forge";
import { forgeListRepos, type ForgeAccount, type ForgeRepo } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { useForgeAccountsStore } from "@/store/forge-accounts";

/** Rows per account in the menu; the rest are one click away in the dialog. */
const MENU_REPOS = 30;

/** How long the menu shows the repositories it listed before it asks the
 * hosts again; opening the submenu again within it costs no request. */
const MENU_REPOS_FRESH_MS = 5 * 60_000;

function menuReposQuery(account: ForgeAccount) {
  return {
    queryKey: ["forge", "menu-repos", account.base, account.login] as const,
    queryFn: async () => (await forgeListRepos(account.base, 1, null)).repos.slice(0, MENU_REPOS),
    staleTime: MENU_REPOS_FRESH_MS,
    // The menu offers its own retry.
    retry: false,
  };
}

/** The import menu's "Git repository" submenu: each connected account with
 * its most recent repositories, then "More repositories" and "Clone from
 * address", which open the import dialog. */
export function GitRepoMenuItems({
  onImport,
  onMore,
  onClone,
  onOpenSettings,
}: Readonly<{
  onImport: (account: ForgeAccount, repo: ForgeRepo) => void;
  onMore: () => void;
  onClone: () => void;
  onOpenSettings: () => void;
}>) {
  const { t } = useTranslation(["library"]);
  const accounts = useForgeAccountsStore((s) => s.accounts);
  const status = useForgeAccountsStore((s) => s.status);
  // Each account's list is kept for a few minutes, so opening the submenu
  // again does not ask every host again.
  const repoQueries = useQueries({ queries: accounts.map(menuReposQuery) });
  // Radix decides an item is selected from its own pointer handling. The
  // external-link button raises this flag and the item refuses to import
  // while it is set.
  const openingExternalRef = useRef(false);

  useEffect(() => {
    void useForgeAccountsStore.getState().ensureLoaded();
  }, []);

  const openRepository = (repo: ForgeRepo) => {
    openExternal(repo.webUrl).catch((error) => {
      notifyError("open repository", error);
    });
  };

  const renderRepos = (account: ForgeAccount, query: UseQueryResult<ForgeRepo[]>) => {
    const host = hostLabel(account.base);
    if (query.isError && !query.isFetching) {
      return (
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void query.refetch();
          }}
        >
          {t(($) => $.library.import.menu.repositoriesRetry)}
        </DropdownMenuItem>
      );
    }
    if (!query.data) {
      return (
        <DropdownMenuItem disabled>
          <Spinner size="sm" /> {t(($) => $.library.import.loadingRepositories)}
        </DropdownMenuItem>
      );
    }
    if (query.data.length === 0) {
      return <DropdownMenuItem disabled>{t(($) => $.library.import.noRepositories)}</DropdownMenuItem>;
    }
    return query.data.map((repo) => (
      <DropdownMenuItem
        key={repo.id || repo.fullName}
        data-testid={`import-git-repository-${repo.fullName}`}
        onSelect={(event) => {
          if (openingExternalRef.current) {
            openingExternalRef.current = false;
            event.preventDefault();
            return;
          }
          onImport(account, repo);
        }}
        className="group gap-2"
      >
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
        {repo.private ? (
          <Tooltip label={t(($) => $.library.import.privateRepository)} side="top">
            <span role="img" aria-label={t(($) => $.library.import.privateRepository)} className="inline-flex shrink-0">
              <Lock aria-hidden className="size-3 text-muted-foreground" />
            </span>
          </Tooltip>
        ) : null}
        <Tooltip label={t(($) => $.library.import.openOnHost, { host })} side="top">
          <button
            type="button"
            aria-label={t(($) => $.library.import.openRepositoryOnHost, { name: repo.fullName, host })}
            // Selecting the item closes the menu and unmounts this button, so
            // a click handler is not guaranteed to run: open the page on
            // pointerdown and stop the item from importing.
            onPointerDown={(event) => {
              openingExternalRef.current = true;
              event.stopPropagation();
              openRepository(repo);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              if (event.repeat) return;
              openRepository(repo);
            }}
            className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:bg-accent/60 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </Tooltip>
      </DropdownMenuItem>
    ));
  };

  if (accounts.length === 0) {
    if (status !== "ready" && status !== "error") {
      return (
        <DropdownMenuItem disabled>
          <Spinner size="sm" /> {t(($) => $.library.import.loadingRepositories)}
        </DropdownMenuItem>
      );
    }
    return (
      <>
        <DropdownMenuItem data-testid="import-git-connect" onSelect={onOpenSettings}>
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          {t(($) => $.library.import.connectGitHosting)}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="import-clone" onSelect={onClone}>
          {t(($) => $.library.import.menu.clone)}
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <>
      {accounts.map((account, index) => (
        <Fragment key={account.base}>
          <DropdownMenuLabel className="truncate">
            {`${hostLabel(account.base)} · ${account.login}`}
          </DropdownMenuLabel>
          {renderRepos(account, repoQueries[index])}
        </Fragment>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="import-git-more" onSelect={onMore}>
        {t(($) => $.library.import.menu.more)}
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="import-clone" onSelect={onClone}>
        {t(($) => $.library.import.menu.clone)}
      </DropdownMenuItem>
    </>
  );
}
