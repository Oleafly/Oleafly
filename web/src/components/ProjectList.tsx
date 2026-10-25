import { FolderOpen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import type { WebApi, WebProjectSummary } from "../api";
import { navigate, projectHref } from "./navigation";

type Listing = { status: "loading" } | { status: "failed" } | { status: "ready"; projects: WebProjectSummary[] };

export function ProjectList({ api }: Readonly<{ api: WebApi }>) {
  const { t } = useTranslation(["web"]);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const load = useCallback(() => {
    setListing({ status: "loading" });
    api.projects().then(
      (projects) => setListing({ status: "ready", projects }),
      () => setListing({ status: "failed" }),
    );
  }, [api]);
  useEffect(load, [load]);

  let body: ReactNode;
  if (listing.status === "loading") {
    body = <LoadingState label={t(($) => $.web.app.loading)} />;
  } else if (listing.status === "failed") {
    body = (
      <ErrorState message={t(($) => $.web.projects.loadFailed)}>
        <Button type="button" size="sm" variant="outline" onClick={load}>
          {t(($) => $.web.app.retry)}
        </Button>
      </ErrorState>
    );
  } else if (listing.projects.length === 0) {
    body = (
      <EmptyState
        className="py-16"
        icon={<FolderOpen aria-hidden className="size-8 text-muted-foreground" />}
        title={t(($) => $.web.projects.emptyTitle)}
        description={t(($) => $.web.projects.emptyDescription)}
      />
    );
  } else {
    body = (
      <ul aria-label={t(($) => $.web.projects.list)} className="divide-y rounded-lg border bg-card">
        {listing.projects.map((project) => (
          <li key={project.projectId}>
            <a
              href={projectHref(project.projectId)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                navigate(project.projectId);
              }}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{project.title || t(($) => $.web.projects.untitled)}</p>
                {project.owner?.name ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {t(($) => $.web.projects.ownedBy, { name: project.owner.name })}
                  </p>
                ) : null}
              </div>
              <Badge variant="muted" size="sm">
                {t(($) => $.web.roles[project.role])}
              </Badge>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">{t(($) => $.web.projects.title)}</h1>
      {body}
    </main>
  );
}
