import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/intl";
import { collabAdminSecurityLog, type CollabMember, type CollabSecurityEvent } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";

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
  unknown: "unknown",
} as const satisfies Record<CollabSecurityEvent["kind"], string>;

type KindKey = (typeof KIND_KEYS)[keyof typeof KIND_KEYS];

export function eventKindKey(kind: string): KindKey {
  return Object.hasOwn(KIND_KEYS, kind) ? KIND_KEYS[kind as keyof typeof KIND_KEYS] : "unknown";
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

  useEffect(() => {
    let active = true;
    void request;
    setLoadError(null);
    collabAdminSecurityLog(serverId).then(
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
  }, [serverId, request]);

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
          const key = eventKindKey(event.kind);
          return (
            <li key={event.id} className="space-y-0.5 px-3 py-2">
              <p className="text-xs">
                <span className="font-medium">{actorName(event.actor)}</span>
                <span className="text-muted-foreground">{" · "}</span>
                <span>{t(($) => $.collab.admin.log.kinds[key])}</span>
              </p>
              <p className="text-[0.6875rem] text-muted-foreground">
                <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time>
                {event.target ? (
                  <span>
                    {" · "}
                    {t(($) => $.collab.admin.log.target, { target: names.get(event.target) ?? event.target })}
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
