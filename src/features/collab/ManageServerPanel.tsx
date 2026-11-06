import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { AppWindow } from "@/components/icons/pack";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CollabProvider, CollabServer } from "@/lib/tauri";
import { collabServerProbe } from "@/lib/tauri-collab";
import { AllowlistTab } from "./AllowlistTab";
import { openAdminConsole } from "./console/open-console";
import { DomainRulesTab } from "./DomainRulesTab";
import { EmailTab } from "./EmailTab";
import { MembersTab } from "./MembersTab";
import { serverRoleAllows, toServerRole, type ServerAction, type ServerRole } from "./roles";
import { RuntimeSettingsTab } from "./RuntimeSettingsTab";
import { SecurityLogTab } from "./SecurityLogTab";
import { useServerMembers } from "./use-server-members";

export const MANAGE_TABS = ["members", "allowlist", "domains", "settings", "email", "log"] as const;

export type ManageTab = (typeof MANAGE_TABS)[number];

const TAB_ACTION: Readonly<Record<ManageTab, ServerAction>> = {
  members: "manageMembers",
  allowlist: "manageMembers",
  domains: "manageDomainRules",
  settings: "manageMembers",
  email: "manageMembers",
  log: "readSecurityLog",
};

export function visibleManageTabs(role: ServerRole): ManageTab[] {
  return MANAGE_TABS.filter((tab) => serverRoleAllows(role, TAB_ACTION[tab]));
}

export function ManageServerPanel({ server, onBack }: Readonly<{ server: CollabServer; onBack: () => void }>) {
  const { t } = useTranslation(["collab"]);
  const serverId = server.server_id;
  const role = server.signed_in ? toServerRole(server.account?.server_role) : null;
  const { members, loadError: membersError, retry: retryMembers, update: updateMembers } = useServerMembers(serverId);
  const [providers, setProviders] = useState<CollabProvider[]>([]);

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

  if (role === null) return null;
  const tabs = visibleManageTabs(role);
  const selfId = server.account?.account_id ?? null;

  return (
    <div className="space-y-4 text-sm" data-testid="collab-manage-server">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft aria-hidden />
        {t(($) => $.collab.admin.back)}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t(($) => $.collab.admin.title, { name: server.name })}</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => void openAdminConsole(server)}>
          <AppWindow aria-hidden />
          {t(($) => $.collab.console.open)}
        </Button>
      </div>
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
                onRetry={retryMembers}
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
          {tabs.includes("email") ? (
            <TabsContent value="email">
              <EmailTab server={server} actor={role} />
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
