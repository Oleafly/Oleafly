import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Server } from "lucide-react";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useFilesStore } from "@/store/files";
import { COLLAB_PRESENCE_OPTIONS, type CollabPresence, useSettingsStore } from "@/store/settings";
import { AddServerDialog } from "./AddServerDialog";
import { collabErrorMessage } from "./errors";
import { LoadFailed } from "./feedback";
import { useAddServerRequest } from "./links/add-server-request";
import { ManageServerPanel } from "./ManageServerPanel";
import { canManageServer, toServerRole } from "./roles";
import { ServerCard } from "./ServerCard";
import { useCollabStore, watchServers } from "./store";

// After Remove, the shared projects that server held stay as ordinary
// projects, renamed as local copies. Name each and the name it has now, so
// nobody wonders where their sync went or looks for the old name.
function DetachedProjects() {
  const { t } = useTranslation(["collab", "common", "native"]);
  const detached = useCollabStore((state) => state.detached);
  const dismiss = useCollabStore((state) => state.dismissDetached);
  const library = useFilesStore((state) => state.projects);
  if (detached.length === 0) return null;
  const nameNow = (project: { project_id: string; name: string }) => {
    const current = library.find((entry) => entry.id === project.project_id)?.name;
    return current && current !== project.name ? current : t(($) => $.native.collab.localCopy, { name: project.name });
  };
  return (
    <div role="status" className="space-y-2 rounded-lg border bg-card px-3 py-2.5 text-xs">
      {detached.map((notice) => (
        <div key={notice.server} className="space-y-1.5">
          <p>{t(($) => $.collab.section.server.detached, { server: notice.server })}</p>
          <ul className="max-h-28 select-text space-y-1 overflow-y-auto">
            {notice.projects.map((project) => (
              <li key={project.project_id} className="min-w-0">
                <p className="truncate font-medium">{project.name}</p>
                <p className="truncate text-muted-foreground">
                  {t(($) => $.collab.section.server.unsent.staysAs, { name: nameNow(project) })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={dismiss}>
        {t(($) => $.common.actions.ok)}
      </Button>
    </div>
  );
}

function PresenceChoice() {
  const { t } = useTranslation(["collab"]);
  const id = useId();
  const presence = useSettingsStore((state) => state.collabPresence);
  const setPresence = useSettingsStore((state) => state.setCollabPresence);
  return (
    <SettingsRow
      testId="settings-row-collab-presence"
      label={<span id={`${id}-label`}>{t(($) => $.collab.section.presence.label)}</span>}
      description={t(($) => $.collab.section.presence.description)}
      details={
        <RadioGroup
          value={presence}
          onValueChange={(value) => setPresence(value as CollabPresence)}
          aria-labelledby={`${id}-label`}
          className="mt-2.5 gap-2"
        >
          {COLLAB_PRESENCE_OPTIONS.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${option}`} value={option} />
              <label htmlFor={`${id}-${option}`} className="cursor-pointer text-sm">
                {t(($) => $.collab.section.presence.options[option])}
              </label>
            </div>
          ))}
        </RadioGroup>
      }
    />
  );
}

export function CollaborationSection() {
  const { t } = useTranslation(["collab"]);
  const servers = useCollabStore((state) => state.servers);
  const status = useCollabStore((state) => state.status);
  const loadError = useCollabStore((state) => state.loadError);
  const load = useCollabStore((state) => state.load);
  const refreshAccounts = useCollabStore((state) => state.refreshAccounts);
  const [adding, setAdding] = useState<{ url: string | null } | null>(null);
  const [managing, setManaging] = useState<string | null>(null);
  const requestedUrl = useAddServerRequest((state) => state.url);

  useEffect(() => {
    void load().then(refreshAccounts);
  }, [load, refreshAccounts]);

  useEffect(() => {
    if (requestedUrl === null) return;
    const url = useAddServerRequest.getState().take();
    if (url !== null) setAdding({ url });
  }, [requestedUrl]);

  useEffect(() => watchServers(), []);
  // What a Remove left behind is news only while Settings stays open.
  useEffect(() => () => useCollabStore.getState().dismissDetached(), []);

  const managed = managing === null ? null : (servers.find((entry) => entry.server_id === managing) ?? null);
  if (managed?.signed_in && canManageServer(toServerRole(managed.account?.server_role))) {
    return <ManageServerPanel server={managed} onBack={() => setManaging(null)} />;
  }

  const renderServers = () => {
    if (servers.length > 0) {
      return (
        <div className="space-y-2">
          {servers.map((entry) => (
            <ServerCard
              key={entry.server_id}
              server={entry}
              defaultOpen={servers.length === 1}
              onSignIn={() => setAdding({ url: entry.url })}
              onManage={() => setManaging(entry.server_id)}
            />
          ))}
        </div>
      );
    }
    if (status === "failed") return null;
    if (status === "ready") {
      return (
        <EmptyState
          className="rounded-lg border border-dashed bg-card px-4 py-6"
          icon={<Server aria-hidden className="size-5 text-muted-foreground" />}
          title={t(($) => $.collab.section.servers.empty.title)}
          description={t(($) => $.collab.section.servers.empty.description)}
        />
      );
    }
    return <LoadingState size="compact" label={t(($) => $.collab.section.servers.loading)} />;
  };

  return (
    <div className="space-y-3 text-sm" data-testid="collaboration-section">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.section.intro)}</p>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{t(($) => $.collab.section.servers.title)}</h3>
        <Button type="button" size="sm" onClick={() => setAdding({ url: null })}>
          <Plus aria-hidden />
          {t(($) => $.collab.section.servers.add)}
        </Button>
      </div>
      {status === "failed" ? (
        <LoadFailed
          message={t(($) => $.collab.section.servers.loadFailed)}
          reason={collabErrorMessage(loadError ?? "internal")}
          onRetry={() => void load()}
        />
      ) : null}
      <DetachedProjects />
      {renderServers()}
      <PresenceChoice />
      <AddServerDialog open={adding !== null} initialUrl={adding?.url ?? null} onClose={() => setAdding(null)} />
    </div>
  );
}
