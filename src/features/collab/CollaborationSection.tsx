import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { COLLAB_SERVER_CHANGED_EVENT } from "@/lib/tauri";
import { AddServerDialog } from "./AddServerDialog";
import { collabErrorMessage } from "./errors";
import { LoadFailed } from "./feedback";
import { ManageServerPanel } from "./ManageServerPanel";
import { canManageServer, toServerRole } from "./roles";
import { ServerCard } from "./ServerCard";
import { useCollabStore } from "./store";

export function CollaborationSection() {
  const { t } = useTranslation(["collab"]);
  const servers = useCollabStore((state) => state.servers);
  const status = useCollabStore((state) => state.status);
  const loadError = useCollabStore((state) => state.loadError);
  const load = useCollabStore((state) => state.load);
  const refreshAccounts = useCollabStore((state) => state.refreshAccounts);
  const [adding, setAdding] = useState<{ url: string | null } | null>(null);
  const [managing, setManaging] = useState<string | null>(null);

  useEffect(() => {
    void load().then(refreshAccounts);
  }, [load, refreshAccounts]);

  useTauriEvent(COLLAB_SERVER_CHANGED_EVENT, () => {
    void load();
  });

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
      {renderServers()}
      <AddServerDialog open={adding !== null} initialUrl={adding?.url ?? null} onClose={() => setAdding(null)} />
    </div>
  );
}
