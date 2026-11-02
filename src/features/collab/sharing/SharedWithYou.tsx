import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { FolderDown } from "@/components/icons/pack";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";
import type {
  CollabServer,
  CollabSharedWithMe,
} from "@/lib/tauri";
import {
  COLLAB_SERVER_CHANGED_EVENT,
  collabJoinProject,
  collabSharedWithMe,
} from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { collabErrorCode, collabErrorText } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { InactiveBadge, isInactive } from "../InactiveBadge";
import { JoinProgress } from "../links/JoinProgress";
import { collabPerson } from "../people";
import { useCollabStore } from "../store";

function itemKey(item: CollabSharedWithMe): string {
  return `${item.server_id}:${item.project.project_id}`;
}

const REFRESH_EVERY_MS = 30_000;
const SERVER_CHANGE_DELAY_MS = 1_000;

function serversKey(servers: readonly CollabServer[]): string {
  return servers.map((server) => `${server.server_id}:${server.signed_in ? "in" : "out"}`).join(",");
}

function hidden(): boolean {
  return document.visibilityState === "hidden";
}

const COLLAPSED_KEY = "oleafly.collab.sharedWithYou.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Without storage the section still folds; it just opens again next time.
  }
}

export function SharedWithYou() {
  const { t } = useTranslation(["collab"]);
  const titleId = useId();
  const listId = useId();
  const servers = useCollabStore((state) => serversKey(state.servers));
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [items, setItems] = useState<CollabSharedWithMe[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const serverChange = useRef<number | null>(null);

  useTauriEvent(COLLAB_SERVER_CHANGED_EVENT, () => {
    if (serverChange.current !== null) window.clearTimeout(serverChange.current);
    serverChange.current = window.setTimeout(() => {
      serverChange.current = null;
      if (!hidden()) setRequest((count) => count + 1);
    }, SERVER_CHANGE_DELAY_MS);
  });

  useEffect(() => {
    const again = () => setRequest((count) => count + 1);
    const tick = () => {
      if (!hidden()) again();
    };
    const shown = () => {
      if (!hidden()) again();
    };
    const timer = window.setInterval(tick, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", shown);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", shown);
      if (serverChange.current !== null) window.clearTimeout(serverChange.current);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void request;
    void servers;
    collabSharedWithMe().then(
      (next) => {
        if (!active) return;
        setItems(next.filter((item) => item.local_project_id === null));
        setFailure(null);
      },
      (error_: unknown) => {
        void logError("collab shared with me", error_);
        if (active) setFailure(collabErrorText(error_));
      },
    );
    return () => {
      active = false;
    };
  }, [request, servers]);

  const open = async (item: CollabSharedWithMe) => {
    const key = itemKey(item);
    setOpening(key);
    setError(null);
    try {
      const localId = item.local_project_id ?? (await collabJoinProject(item.server_id, item.project.project_id));
      const files = useFilesStore.getState();
      await files.refreshProjects();
      await files.openProject(localId);
    } catch (error_) {
      if (collabErrorCode(error_) !== "cancelled") setError({ key, message: collabErrorText(error_) });
    } finally {
      setOpening(null);
    }
  };

  if (items.length === 0 && failure !== null) {
    return (
      <section aria-labelledby={titleId} className="mb-5 space-y-2" data-testid="collab-shared-with-you">
        <h2 id={titleId} className="text-sm font-semibold">
          {t(($) => $.collab.library.sharedWithYou.title)}
        </h2>
        <LoadFailed
          message={t(($) => $.collab.library.sharedWithYou.loadFailed)}
          reason={failure}
          onRetry={() => setRequest((count) => count + 1)}
        />
      </section>
    );
  }
  if (items.length === 0) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    saveCollapsed(next);
  };

  return (
    <section aria-labelledby={titleId} className="mb-5 space-y-2" data-testid="collab-shared-with-you">
      <h2 className="text-sm font-semibold">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={toggle}
          className="-mx-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-accent/60 focus-visible:bg-accent/60"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
              !collapsed && "rotate-90",
            )}
          />
          <span id={titleId}>{t(($) => $.collab.library.sharedWithYou.title)}</span>
          <span aria-hidden className="text-xs font-normal text-muted-foreground">
            {items.length}
          </span>
        </button>
      </h2>
      <ul id={listId} hidden={collapsed} aria-labelledby={titleId} className="divide-y rounded-xl border bg-card">
        {items.map((item) => {
          const key = itemKey(item);
          const project = item.project;
          return (
            <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar person={collabPerson(project.owner)} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{project.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t(($) => $.collab.library.sharedWithYou.from, {
                    owner: project.owner.display_name,
                    server: item.server_name,
                  })}
                </p>
                {isInactive(project.owner) ? <InactiveBadge owner tone="warning" /> : null}
              </div>
              <Badge variant="muted" size="sm">
                {t(($) => $.collab.projectRoles[project.role])}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={opening !== null}
                aria-label={t(($) => $.collab.library.sharedWithYou.openNamed, { name: project.title })}
                onClick={() => void open(item)}
              >
                {opening === key ? <Spinner /> : <FolderDown aria-hidden />}
                {t(($) => $.collab.library.sharedWithYou.open)}
              </Button>
              {opening === key && item.local_project_id === null ? (
                <div className="basis-full">
                  <JoinProgress
                    target={{ serverId: item.server_id, sharedProjectId: project.project_id }}
                    name={project.title}
                  />
                </div>
              ) : null}
              {error?.key === key ? (
                <div className="basis-full">
                  <InlineAlert>{error.message}</InlineAlert>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
