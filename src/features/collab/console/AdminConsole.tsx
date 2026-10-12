import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Server, ShieldCheck } from "lucide-react";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { NavItem } from "@/components/ui/nav-item";
import { SectionHeading } from "@/components/ui/section-heading";
import type { CollabServer } from "@/lib/tauri";
import { AllowlistTab } from "../AllowlistTab";
import { DomainRulesTab } from "../DomainRulesTab";
import { EmailTab } from "../EmailTab";
import { MembersTab } from "../MembersTab";
import { serverRoleAllows, type ServerRole } from "../roles";
import { RuntimeSettingsTab } from "../RuntimeSettingsTab";
import { SecurityLogTab } from "../SecurityLogTab";
import { useServerMembers } from "../use-server-members";
import { ChecksSection } from "./ChecksSection";
import { OverviewSection } from "./OverviewSection";
import { ProjectsSection } from "./ProjectsSection";
import { SECTION_ICONS, visibleConsoleSections, type ConsoleSection } from "./sections";
import { useAdminOverview, type OverviewState } from "./use-admin-overview";

type Health = "checking" | "ok" | "warning" | "unreachable";

const HEALTH_BADGE = {
  checking: "muted",
  ok: "success",
  warning: "warning",
  unreachable: "destructive",
} as const satisfies Record<Health, BadgeVariant>;

const NAV_KEYS: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

function healthOf(state: OverviewState): Health | null {
  if (state.status === "loading") return "checking";
  if (state.status === "ready") return state.overview.health.status === "ok" ? "ok" : "warning";
  return state.code === "unreachable" || state.code === "server" ? "unreachable" : null;
}

function ConsoleNav({
  sections,
  current,
  onSelect,
}: Readonly<{
  sections: readonly ConsoleSection[];
  current: ConsoleSection;
  onSelect: (section: ConsoleSection) => void;
}>) {
  const { t } = useTranslation(["collab"]);
  const items = useRef(new Map<ConsoleSection, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = NAV_KEYS[event.key];
    if (!step) return;
    event.preventDefault();
    const next = sections[step(sections.indexOf(current), sections.length)];
    onSelect(next);
    items.current.get(next)?.focus();
  };

  return (
    <nav
      aria-label={t(($) => $.collab.console.sectionsLabel)}
      className="flex shrink-0 flex-col border-sidebar-border bg-sidebar text-sidebar-foreground max-md:border-b md:w-52 md:border-r"
    >
      <SidebarPanelHeader icon={ShieldCheck} title={t(($) => $.collab.console.title)} className="max-md:hidden" />
      <div
        className="flex gap-0.5 p-2 no-scrollbar max-md:overflow-x-auto md:flex-col md:p-3"
      >
        {sections.map((section) => (
          <NavItem
            key={section}
            ref={(node) => {
              if (node) items.current.set(section, node);
              else items.current.delete(section);
            }}
            icon={SECTION_ICONS[section]}
            label={t(($) => $.collab.console.sections[section])}
            active={section === current}
            tabIndex={section === current ? 0 : -1}
            data-testid={`console-section-${section}`}
            className="max-md:shrink-0"
            onClick={() => onSelect(section)}
            onKeyDown={onKeyDown}
          />
        ))}
      </div>
    </nav>
  );
}

function ConsoleHeader({
  server,
  actor,
  health,
}: Readonly<{ server: CollabServer; actor: ServerRole; health: Health | null }>) {
  const { t } = useTranslation(["collab"]);
  const healthText = health ? t(($) => $.collab.console.health[health]) : "";
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Server aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{server.name}</h1>
        <p className="select-text truncate text-xs text-muted-foreground">{server.url}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="muted" size="sm">
          {t(($) => $.collab.section.server.role, { role: t(($) => $.collab.roles[actor]) })}
        </Badge>
        {health ? (
          <Badge
            role="status"
            aria-label={t(($) => $.collab.console.health.label, { status: healthText })}
            variant={HEALTH_BADGE[health]}
            size="sm"
          >
            {healthText}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}

export function AdminConsole({ server, actor }: Readonly<{ server: CollabServer; actor: ServerRole }>) {
  const { t } = useTranslation(["collab"]);
  const serverId = server.server_id;
  const sections = visibleConsoleSections(actor);
  const [section, setSection] = useState<ConsoleSection>("overview");
  const { state: overview, reload } = useAdminOverview(serverId);
  const members = useServerMembers(serverId);
  const headingId = useId();
  const ready = overview.status === "ready" ? overview.overview : null;

  const select = (next: ConsoleSection) => {
    if (next === "overview" && section !== "overview") reload();
    setSection(next);
  };

  const renderSection = () => {
    switch (section) {
      case "overview":
        return <OverviewSection state={overview} onNavigate={select} onRetry={reload} />;
      case "people":
        return (
          <MembersTab
            serverId={serverId}
            actor={actor}
            selfId={server.account?.account_id ?? null}
            members={members.members}
            loadError={members.loadError}
            onRetry={members.retry}
            onMembersChange={members.update}
            onAddPeople={serverRoleAllows(actor, "manageMembers") ? () => select("access") : undefined}
          />
        );
      case "access":
        return (
          <div className="space-y-8">
            <section className="space-y-2">
              <SectionHeading>{t(($) => $.collab.admin.tabs.allowlist)}</SectionHeading>
              <AllowlistTab serverId={serverId} actor={actor} providers={ready?.providers ?? []} />
            </section>
            {serverRoleAllows(actor, "manageDomainRules") ? (
              <section className="space-y-2">
                <SectionHeading>{t(($) => $.collab.admin.tabs.domains)}</SectionHeading>
                <DomainRulesTab serverId={serverId} actor={actor} />
              </section>
            ) : null}
          </div>
        );
      case "projects":
        return (
          <ProjectsSection
            serverId={serverId}
            actor={actor}
            archiveDays={ready && ready.archive_days > 0 ? ready.archive_days : null}
            now={ready?.now ?? Date.now()}
          />
        );
      case "settings":
        return <RuntimeSettingsTab serverId={serverId} actor={actor} />;
      case "email":
        return <EmailTab server={server} actor={actor} />;
      case "log":
        return <SecurityLogTab serverId={serverId} members={members.members ?? []} />;
      case "checks":
        return <ChecksSection url={server.url} />;
    }
  };

  return (
    <div
      data-testid="admin-console"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-sidebar text-sm text-foreground md:flex-row"
    >
      <ConsoleNav sections={sections} current={section} onSelect={select} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConsoleHeader server={server} actor={actor} health={healthOf(overview)} />
        <main aria-labelledby={headingId} className="min-h-0 flex-1 overflow-auto p-5">
          <h2 id={headingId} className="mb-4 text-base font-semibold">
            {t(($) => $.collab.console.sections[section])}
          </h2>
          {renderSection()}
        </main>
      </div>
    </div>
  );
}
