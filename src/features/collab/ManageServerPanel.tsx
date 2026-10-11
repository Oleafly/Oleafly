import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  collabAdminMembers,
  collabServerProbe,
  type CollabMember,
  type CollabProvider,
  type CollabServer,
} from "@/lib/tauri";
import { AllowlistTab } from "./AllowlistTab";
import { DomainRulesTab } from "./DomainRulesTab";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { MembersTab, type MembersUpdate } from "./MembersTab";
import { serverRoleAllows, toServerRole, type ServerAction, type ServerRole } from "./roles";
import { RuntimeSettingsTab } from "./RuntimeSettingsTab";
import { SecurityLogTab } from "./SecurityLogTab";

export const MANAGE_TABS = ["members", "allowlist", "domains", "settings", "log"] as const;

export type ManageTab = (typeof MANAGE_TABS)[number];

const TAB_ACTION: Readonly<Record<ManageTab, ServerAction>> = {
  members: "manageMembers",
  allowlist: "manageMembers",
  domains: "manageDomainRules",
  settings: "manageMembers",
  log: "readSecurityLog",
};

export function visibleManageTabs(role: ServerRole): ManageTab[] {
  return MANAGE_TABS.filter((tab) => serverRoleAllows(role, TAB_ACTION[tab]));
}

export function ManageServerPanel({ server, onBack }: Readonly<{ server: CollabServer; onBack: () => void }>) {
  const { t } = useTranslation(["collab"]);
  const serverId = server.server_id;
  const role = server.signed_in ? toServerRole(server.account?.server_role) : null;
  const [members, setMembers] = useState<CollabMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersRequest, setMembersRequest] = useState(0);
  const [providers, setProviders] = useState<CollabProvider[]>([]);

  useEffect(() => {
    let active = true;
    void membersRequest;
    setMembersError(null);
    collabAdminMembers(serverId).then(
      (next) => {
        if (active) setMembers(next);
      },
      (error: unknown) => {
        if (active) setMembersError(collabErrorMessage(collabErrorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [serverId, membersRequest]);

  useEffect(() => {
    let active = true;
    collabServerProbe(server.url).then(
      (capabilities) => {
        if (active) setProviders(capabilities.providers);
      },
      () => {
        if (active) setProviders([]);
      },
    );
    return () => {
      active = false;
    };
  }, [server.url]);

  const updateMembers: MembersUpdate = (update) =>
    setMembers((current) => (current === null ? current : update(current)));

  if (role === null) return null;
  const tabs = visibleManageTabs(role);
  const selfId = server.account?.account_id ?? null;

  return (
    <div className="space-y-4 text-sm" data-testid="collab-manage-server">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden />
        {t(($) => $.collab.admin.back)}
      </Button>
      <h3 className="text-sm font-semibold">{t(($) => $.collab.admin.title, { name: server.name })}</h3>
      {tabs.length > 0 ? (
        <Tabs defaultValue={tabs[0]} className="space-y-3">
          <TabsList scrollable>
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab} data-testid={`collab-admin-tab-${tab}`}>
                {t(($) => $.collab.admin.tabs[tab])}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.includes("members") ? (
            <TabsContent value="members">
              <MembersTab
                serverId={serverId}
                actor={role}
                selfId={selfId}
                members={members}
                loadError={membersError}
                onRetry={() => setMembersRequest((count) => count + 1)}
                onMembersChange={updateMembers}
              />
            </TabsContent>
          ) : null}
          {tabs.includes("allowlist") ? (
            <TabsContent value="allowlist">
              <AllowlistTab serverId={serverId} actor={role} providers={providers} />
            </TabsContent>
          ) : null}
          {tabs.includes("domains") ? (
            <TabsContent value="domains">
              <DomainRulesTab serverId={serverId} actor={role} />
            </TabsContent>
          ) : null}
          {tabs.includes("settings") ? (
            <TabsContent value="settings">
              <RuntimeSettingsTab serverId={serverId} actor={role} />
            </TabsContent>
          ) : null}
          {tabs.includes("log") ? (
            <TabsContent value="log">
              <SecurityLogTab serverId={serverId} members={members ?? []} />
            </TabsContent>
          ) : null}
        </Tabs>
      ) : null}
    </div>
  );
}
