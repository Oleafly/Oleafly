import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderDown } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { logError } from "@/lib/log";
import {
  COLLAB_SERVER_CHANGED_EVENT,
  collabJoinProject,
  collabSharedWithMe,
  type CollabSharedWithMe,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { collabErrorText } from "../errors";
import { InlineAlert } from "../feedback";
import { collabPerson } from "../people";
import { useCollabStore } from "../store";

function itemKey(item: CollabSharedWithMe): string {
  return `${item.server_id}:${item.project.project_id}`;
}

const REFRESH_EVERY_MS = 30_000;

export function SharedWithYou() {
  const { t } = useTranslation(["collab"]);
  const titleId = useId();
  const servers = useCollabStore((state) => state.servers);
  const [items, setItems] = useState<CollabSharedWithMe[]>([]);
  const [request, setRequest] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  useTauriEvent(COLLAB_SERVER_CHANGED_EVENT, () => setRequest((count) => count + 1));

  useEffect(() => {
    const again = () => setRequest((count) => count + 1);
    const timer = window.setInterval(again, REFRESH_EVERY_MS);
    window.addEventListener("focus", again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", again);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void request;
    void servers;
    collabSharedWithMe().then(
      (next) => {
        if (active) setItems(next.filter((item) => item.local_project_id === null));
      },
      (error_: unknown) => {
        void logError("collab shared with me", error_);
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
      setError({ key, message: collabErrorText(error_) });
    } finally {
      setOpening(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className="mb-5 space-y-2" data-testid="collab-shared-with-you">
      <h2 id={titleId} className="text-sm font-semibold">
        {t(($) => $.collab.library.sharedWithYou.title)}
      </h2>
      <ul aria-labelledby={titleId} className="divide-y rounded-xl border bg-card">
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
