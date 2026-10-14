import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/intl";
import {
  collabAdminSecurityLog,
  type CollabMember,
  type CollabProjectRole,
  type CollabSecurityEvent,
  type CollabSecurityLogKind,
} from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { toServerRole } from "./roles";
import { RUNTIME_SETTING_COPY } from "./RuntimeSettingsTab";

const KIND_KEYS = {
  setup_completed: "setupCompleted",
  sign_in: "signIn",
  sign_in_refused: "signInRefused",
  device_added: "deviceAdded",
  device_signed_out: "deviceSignedOut",
  refresh_reuse_detected: "refreshReuseDetected",
  member_added: "memberAdded",
  member_removed: "memberRemoved",
  member_suspended: "memberSuspended",
  member_reactivated: "memberReactivated",
  role_changed: "roleChanged",
  allowlist_added: "allowlistAdded",
  allowlist_removed: "allowlistRemoved",
  domain_rule_added: "domainRuleAdded",
  domain_rule_removed: "domainRuleRemoved",
  settings_changed: "settingsChanged",
  project_shared: "projectShared",
  project_access_granted: "projectAccessGranted",
  project_access_changed: "projectAccessChanged",
  project_access_removed: "projectAccessRemoved",
  project_archived: "projectArchived",
  project_unarchived: "projectUnarchived",
  project_settings_changed: "projectSettingsChanged",
  guest_invited: "guestInvited",
  guest_invitation_approved: "guestInvitationApproved",
  guest_invitation_declined: "guestInvitationDeclined",
  guest_invitation_revoked: "guestInvitationRevoked",
  guest_admission_ended: "guestAdmissionEnded",
  project_rejoin_refused: "projectRejoinRefused",
  unknown: "unknown",
} as const satisfies Record<CollabSecurityLogKind, string>;

type KindKey = (typeof KIND_KEYS)[keyof typeof KIND_KEYS];

type LabelKey =
  | KindKey
  | "projectLeft"
  | "projectLinkSharingOn"
  | "projectLinkSharingOff"
  | "projectLinkRoleChanged"
  | "projectAccessLogOn"
  | "projectAccessLogOff"
  | "projectCommentsOn"
  | "projectCommentsOff";

const SIGN_IN_KINDS: ReadonlySet<string> = new Set(["setup_completed", "sign_in", "sign_in_refused", "device_added"]);

const DEVICE_KINDS: ReadonlySet<string> = new Set(["device_added", "device_signed_out", "refresh_reuse_detected"]);

const INVITATION_KINDS: ReadonlySet<string> = new Set([
  "guest_invited",
  "guest_invitation_approved",
  "guest_invitation_declined",
  "guest_invitation_revoked",
]);

const VIA_KEYS = {
  allowlist: "allowlist",
  domain: "domain",
  setup: "setup",
  guest: "guest",
  link: "link",
  invitation: "invitation",
} as const;

const REASON_KEYS = {
  suspended: "suspended",
  not_admitted: "notAdmitted",
  setup_code_invalid: "setupCodeInvalid",
  guest_invitation_unusable: "guestInvitationUnusable",
  stopped_by_person: "stoppedByPerson",
  other_browser: "otherBrowser",
  address_of_inactive_account: "inactiveAccountAddress",
  no_projects_left: "noProjectsLeft",
} as const;

const SETTING_KEYS = {
  ...RUNTIME_SETTING_COPY,
  email_notifications: "emailNotifications",
} as const;

const PROJECT_ROLES = ["owner", "editor", "viewer"] as const satisfies readonly CollabProjectRole[];

const EMAIL_LINK_PROVIDER = "email-link";
const GITHUB_PROVIDER = "github";
const GITHUB_NAME = "GitHub";

type Detail = Readonly<Record<string, unknown>>;

function detailOf(event: CollabSecurityEvent): Detail {
  const detail = event.detail;
  return detail !== null && typeof detail === "object" && !Array.isArray(detail) ? (detail as Detail) : {};
}

function text(detail: Detail, key: string): string | null {
  const value = detail[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function flag(detail: Detail, key: string): boolean | null {
  const value = detail[key];
  return typeof value === "boolean" ? value : null;
}

function known<T extends string>(keys: Readonly<Record<T, unknown>>, value: string | null): value is T {
  return value !== null && Object.hasOwn(keys, value);
}

function projectRole(value: string | null): CollabProjectRole | null {
  return PROJECT_ROLES.find((role) => role === value) ?? null;
}

function isProjectKind(kind: string): boolean {
  return kind.startsWith("project_") || kind.startsWith("guest_");
}

export function eventKindKey(kind: string): KindKey {
  return Object.hasOwn(KIND_KEYS, kind) ? KIND_KEYS[kind as keyof typeof KIND_KEYS] : "unknown";
}

function projectSettingsLabel(detail: Detail): LabelKey | null {
  const accessLog = flag(detail, "access_log");
  if (accessLog !== null) return accessLog ? "projectAccessLogOn" : "projectAccessLogOff";
  const comments = flag(detail, "comments_enabled");
  if (comments !== null) return comments ? "projectCommentsOn" : "projectCommentsOff";
  return null;
}

function projectAccessLabel(detail: Detail): LabelKey | null {
  if (Object.hasOwn(detail, "project")) return null;
  const linkSharing = flag(detail, "link_sharing");
  if (linkSharing !== null) return linkSharing ? "projectLinkSharingOn" : "projectLinkSharingOff";
  return text(detail, "link_role") === null ? null : "projectLinkRoleChanged";
}

function labelKey(event: CollabSecurityEvent, detail: Detail): LabelKey {
  const key = eventKindKey(event.kind);
  if (key === "projectSettingsChanged") return projectSettingsLabel(detail) ?? key;
  if (key === "projectAccessChanged") return projectAccessLabel(detail) ?? key;
  if (key === "projectAccessRemoved" && flag(detail, "left") === true) return "projectLeft";
  return key;
}

function projectTitle(event: CollabSecurityEvent, detail: Detail): string | null {
  return event.project_title || text(detail, "title");
}

function useEventDescription(names: ReadonlyMap<string, string>) {
  const { t } = useTranslation(["collab"]);

  const providerFact = (detail: Detail): string | null => {
    const provider = text(detail, "provider");
    if (provider === null) return null;
    if (provider === EMAIL_LINK_PROVIDER) return t(($) => $.collab.admin.log.details.providerEmailLink);
    return t(($) => $.collab.admin.log.details.provider, {
      provider: provider === GITHUB_PROVIDER ? GITHUB_NAME : provider,
    });
  };

  const viaFact = (detail: Detail): string | null => {
    const via = text(detail, "via");
    return known(VIA_KEYS, via) ? t(($) => $.collab.admin.log.details.via[VIA_KEYS[via]]) : null;
  };

  const reasonFact = (detail: Detail): string | null => {
    const reason = text(detail, "reason");
    if (reason === "locked_out") {
      return text(detail, "limit") === "address"
        ? t(($) => $.collab.admin.log.details.reasons.lockedOutAddress)
        : t(($) => $.collab.admin.log.details.reasons.lockedOutIp);
    }
    return known(REASON_KEYS, reason) ? t(($) => $.collab.admin.log.details.reasons[REASON_KEYS[reason]]) : null;
  };

  const signInFacts = (detail: Detail): (string | null)[] => {
    const name = text(detail, "name");
    const usedCode = flag(detail, "device_code") === true || text(detail, "flow") === "device_code";
    return [
      providerFact(detail),
      name ? t(($) => $.collab.admin.log.details.device, { name }) : null,
      usedCode ? t(($) => $.collab.admin.log.details.signInCode) : null,
      viaFact(detail),
      flag(detail, "new_account") === true ? t(($) => $.collab.admin.log.details.newAccount) : null,
      flag(detail, "reactivated") === true ? t(($) => $.collab.admin.log.details.reactivated) : null,
      reasonFact(detail),
    ];
  };

  const projectFacts = (event: CollabSecurityEvent, detail: Detail): (string | null)[] => {
    const title = projectTitle(event, detail);
    const role = projectRole(text(detail, "role") ?? text(detail, "link_role"));
    return [
      title ? t(($) => $.collab.admin.log.details.project, { title }) : null,
      role ? t(($) => $.collab.admin.log.details.role, { role: t(($) => $.collab.projectRoles[role]) }) : null,
      viaFact(detail),
      reasonFact(detail),
      flag(detail, "by_admin") === true ? t(($) => $.collab.admin.log.details.byAdmin) : null,
    ];
  };

  const roleChangeFacts = (detail: Detail): (string | null)[] => {
    const from = toServerRole(text(detail, "from"));
    const to = toServerRole(text(detail, "to"));
    if (!from || !to) return [];
    return [
      t(($) => $.collab.admin.log.details.roleChange, {
        from: t(($) => $.collab.roles[from]),
        to: t(($) => $.collab.roles[to]),
      }),
    ];
  };

  const settingFacts = (detail: Detail): (string | null)[] =>
    Object.entries(detail).map(([field, change]) => {
      if (!known(SETTING_KEYS, field) || change === null || typeof change !== "object") return null;
      const value = (change as Detail).to;
      if (typeof value !== "boolean") return null;
      const setting = t(($) => $.collab.admin.settings[SETTING_KEYS[field]].label);
      return value
        ? t(($) => $.collab.admin.log.details.settingOn, { setting })
        : t(($) => $.collab.admin.log.details.settingOff, { setting });
    });

  const factsOf = (event: CollabSecurityEvent, detail: Detail): string[] => {
    let facts: (string | null)[] = [];
    if (SIGN_IN_KINDS.has(event.kind)) facts = signInFacts(detail);
    else if (event.kind === "role_changed") facts = roleChangeFacts(detail);
    else if (event.kind === "settings_changed") facts = settingFacts(detail);
    else if (isProjectKind(event.kind)) facts = projectFacts(event, detail);
    return facts.filter((fact): fact is string => fact !== null);
  };

  const allowlistTarget = (detail: Detail): string | null => {
    const email = text(detail, "email");
    const login = text(detail, "login");
    const provider = text(detail, "provider");
    if (email) return email;
    if (login && provider) return t(($) => $.collab.admin.allowlist.loginEntry, { login, provider });
    return null;
  };

  const ruleTarget = (event: CollabSecurityEvent, detail: Detail): string | null => {
    if (event.kind === "allowlist_added" || event.kind === "allowlist_removed") return allowlistTarget(detail);
    if (event.kind === "domain_rule_added" || event.kind === "domain_rule_removed") return text(detail, "domain");
    return null;
  };

  const accountTarget = (event: CollabSecurityEvent, detail: Detail): string | null => {
    const target = event.target;
    if (target === null) return null;
    const aboutProject = isProjectKind(event.kind) && !Object.hasOwn(detail, "project");
    if (aboutProject && projectTitle(event, detail)) return null;
    const removedName = event.kind === "member_removed" ? text(detail, "display_name") : null;
    return names.get(target) ?? removedName ?? target;
  };

  const targetOf = (event: CollabSecurityEvent, detail: Detail): string | null => {
    if (INVITATION_KINDS.has(event.kind)) return text(detail, "email");
    const rule = ruleTarget(event, detail);
    if (rule !== null) return rule;
    if (DEVICE_KINDS.has(event.kind)) return text(detail, "name") ? null : (event.device_name ?? null);
    return accountTarget(event, detail);
  };

  return (event: CollabSecurityEvent) => {
    const detail = detailOf(event);
    return {
      label: t(($) => $.collab.admin.log.kinds[labelKey(event, detail)]),
      facts: factsOf(event, detail),
      target: targetOf(event, detail),
    };
  };
}

export function SecurityLogTab({
  serverId,
  members,
}: Readonly<{ serverId: string; members: readonly CollabMember[] }>) {
  const { t } = useTranslation(["collab"]);
  const [events, setEvents] = useState<CollabSecurityEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [request, setRequest] = useState(0);
  const names = useMemo(
    () => new Map(members.map((member) => [member.account.account_id, member.account.display_name])),
    [members],
  );
  const describe = useEventDescription(names);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    collabAdminSecurityLog(load.serverId).then(
      (page) => {
        if (!active) return;
        setEvents(page.items);
        setCursor(page.next_cursor ?? null);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorMessage(collabErrorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await collabAdminSecurityLog(serverId, cursor);
      setEvents((current) => [...(current ?? []), ...page.items]);
      setCursor(page.next_cursor ?? null);
    } catch (error) {
      setMoreError(collabErrorMessage(collabErrorCode(error)));
    } finally {
      setLoadingMore(false);
    }
  };

  const actorName = (actor: string | null) =>
    actor === null
      ? t(($) => $.collab.admin.log.server)
      : (names.get(actor) ?? t(($) => $.collab.admin.log.unknownAccount));

  const renderEvents = () => {
    if (loadError) {
      return (
        <LoadFailed
          message={t(($) => $.collab.admin.loadFailed)}
          reason={loadError}
          onRetry={() => setRequest((count) => count + 1)}
        />
      );
    }
    if (!events) return <LoadingState size="compact" label={t(($) => $.collab.admin.log.loading)} />;
    if (events.length === 0) {
      return (
        <EmptyState
          size="compact"
          className="rounded-lg border border-dashed px-4 py-6"
          title={t(($) => $.collab.admin.log.empty)}
        />
      );
    }
    return (
      <ol className="divide-y rounded-lg border bg-card">
        {events.map((event) => {
          const { label, facts, target } = describe(event);
          return (
            <li key={event.id} className="space-y-0.5 px-3 py-2">
              <p className="text-xs">
                <span className="font-medium">{actorName(event.actor)}</span>
                <span className="text-muted-foreground">{" · "}</span>
                <span>{label}</span>
              </p>
              {facts.length > 0 ? <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p> : null}
              <p className="text-[0.6875rem] text-muted-foreground">
                <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time>
                {target ? (
                  <span>
                    {" · "}
                    {t(($) => $.collab.admin.log.target, { target })}
                  </span>
                ) : null}
                {event.ip ? (
                  <span>
                    {" · "}
                    {t(($) => $.collab.admin.log.ip, { ip: event.ip })}
                  </span>
                ) : null}
              </p>
            </li>
          );
        })}
      </ol>
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.log.description)}</p>
      {renderEvents()}
      {cursor && !loadError ? (
        <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? <Spinner /> : null}
          {t(($) => $.collab.admin.log.loadMore)}
        </Button>
      ) : null}
      {moreError ? <InlineAlert>{moreError}</InlineAlert> : null}
    </div>
  );
}
