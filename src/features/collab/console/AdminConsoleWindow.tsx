import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn, ServerOff, ShieldX } from "lucide-react";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { useWindowGeometry } from "@/lib/preview-geometry";
import {
  COLLAB_SERVER_CHANGED_EVENT,
  collabServerRefresh,
  collabServersList,
  type CollabServer,
  type CollabServerChanged,
} from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { canManageServer, toServerRole } from "../roles";
import { AdminConsole } from "./AdminConsole";
import { consoleGeometryKey, readConsoleServerId } from "./open-console";

type WindowState =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly server: CollabServer | null };

const STATE_ICON_CLASS = "size-6 text-muted-foreground";

function find(listed: readonly CollabServer[], serverId: string | null): CollabServer | null {
  return listed.find((entry) => entry.server_id === serverId) ?? null;
}

async function openServer(serverId: string | null): Promise<CollabServer | null> {
  const found = find(await collabServersList(), serverId);
  if (!found?.signed_in) return found;
  return collabServerRefresh(found.server_id).catch(() => found);
}

export function AdminConsoleWindow({ search = window.location.search }: Readonly<{ search?: string }>) {
  const { t } = useTranslation(["collab"]);
  const serverId = readConsoleServerId(search);
  const [state, setState] = useState<WindowState>({ status: "loading" });
  const [request, setRequest] = useState(0);
  useWindowGeometry(serverId ? consoleGeometryKey(serverId) : null);

  useEffect(() => {
    let active = true;
    void request;
    openServer(serverId).then(
      (server) => {
        if (active) setState({ status: "ready", server });
      },
      (error: unknown) => {
        if (active) setState({ status: "failed", message: collabErrorMessage(collabErrorCode(error)) });
      },
    );
    return () => {
      active = false;
    };
  }, [serverId, request]);

  useTauriEvent<CollabServerChanged>(COLLAB_SERVER_CHANGED_EVENT, (payload) => {
    if (payload.serverId !== serverId) return;
    collabServersList().then(
      (listed) => setState({ status: "ready", server: find(listed, serverId) }),
      (error: unknown) => setState({ status: "failed", message: collabErrorMessage(collabErrorCode(error)) }),
    );
  });

  const name = state.status === "ready" ? state.server?.name : undefined;
  useEffect(() => {
    if (name) document.title = t(($) => $.collab.console.windowTitle);
  }, [name, t]);

  const renderState = () => {
    if (state.status === "loading") {
      return <LoadingState className="m-auto" label={t(($) => $.collab.console.states.loading)} />;
    }
    if (state.status === "failed") {
      return (
        <div className="m-auto p-6">
          <LoadFailed
            message={t(($) => $.collab.console.states.loadFailed)}
            reason={state.message}
            onRetry={() => setRequest((count) => count + 1)}
          />
        </div>
      );
    }
    const server = state.server;
    if (!server) {
      return (
        <EmptyState
          className="m-auto p-6"
          icon={<ServerOff aria-hidden className={STATE_ICON_CLASS} />}
          title={t(($) => $.collab.console.states.unknownTitle)}
          description={t(($) => $.collab.console.states.unknownDescription)}
        />
      );
    }
    if (!server.signed_in) {
      return (
        <EmptyState
          className="m-auto p-6"
          icon={<LogIn aria-hidden className={STATE_ICON_CLASS} />}
          title={t(($) => $.collab.console.states.signedOutTitle)}
          description={t(($) => $.collab.console.states.signedOutDescription)}
        />
      );
    }
    const role = toServerRole(server.account?.server_role);
    if (role === null || !canManageServer(role)) {
      return (
        <EmptyState
          className="m-auto p-6"
          icon={<ShieldX aria-hidden className={STATE_ICON_CLASS} />}
          title={t(($) => $.collab.console.states.refusedTitle)}
          description={t(($) => $.collab.console.states.refusedDescription, {
            role: role === null ? (server.account?.server_role ?? "") : t(($) => $.collab.roles[role]),
          })}
        />
      );
    }
    return <AdminConsole key={server.server_id} server={server} actor={role} />;
  };

  return <div className="flex h-screen w-full overflow-hidden bg-sidebar text-foreground">{renderState()}</div>;
}
