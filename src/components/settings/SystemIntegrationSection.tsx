import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSwitchIndicator } from "@/components/settings/SettingsToggleRow";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { SectionHeading } from "@/components/ui/section-heading";
import { logError } from "@/lib/log";
import {
  setSystemIntegration,
  systemIntegrationStatus,
  type SystemIntegrationAttention,
  type SystemIntegrationItem,
  type SystemIntegrationItemId,
  type SystemIntegrationState,
  type SystemIntegrationStatus,
} from "@/lib/tauri";
import { Spinner } from "@/components/ui/spinner";

type Change = "install" | "remove";

const COPY = {
  quick_action: "quickAction",
  explorer_menu: "explorerMenu",
  dolphin: "dolphin",
  nemo: "nemo",
  nautilus: "nautilus",
  folder_open_with: "folderOpenWith",
} as const satisfies Record<SystemIntegrationItemId, string>;

const ATTENTION = {
  outdated: "outdated",
  elsewhere: "elsewhere",
  moved: "moved",
  no_default_file_manager: "noDefaultFileManager",
} as const satisfies Record<SystemIntegrationAttention, string>;

const STATE = {
  installed: "installed",
  not_installed: "notInstalled",
  needs_attention: "needsAttention",
} as const satisfies Record<SystemIntegrationState, string>;

const STATE_TONE: Record<SystemIntegrationState, BadgeVariant> = {
  installed: "success",
  not_installed: "muted",
  needs_attention: "warning",
};

const ACTION =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50";

function StateBadge({ state }: Readonly<{ state: SystemIntegrationState }>) {
  const { t } = useTranslation(["settings"]);
  return (
    <Badge variant={STATE_TONE[state]} size="sm">
      {t(($) => $.settings.systemIntegration.state[STATE[state]])}
    </Badge>
  );
}

function ActionButton({
  busy,
  disabled,
  label,
  onClick,
}: Readonly<{ busy: boolean; disabled: boolean; label: string; onClick: () => void }>) {
  return (
    <button type="button" className={ACTION} disabled={disabled} onClick={onClick}>
      {busy ? <Spinner size="sm" /> : null}
      {label}
    </button>
  );
}

function RowControls({
  item,
  busy,
  onChange,
}: Readonly<{
  item: SystemIntegrationItem;
  busy: Change | null;
  onChange: (change: Change) => void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  if (item.packaged) return null;
  const working = busy !== null;
  const repair =
    item.state === "needs_attention" && item.attention !== "no_default_file_manager" ? (
      <ActionButton
        busy={busy === "install"}
        disabled={working}
        label={t(($) => $.settings.systemIntegration.actions.repair)}
        onClick={() => onChange("install")}
      />
    ) : null;
  if (item.id === "explorer_menu") {
    const on = item.state !== "not_installed";
    return (
      <div className="flex shrink-0 items-center gap-2">
        {repair}
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t(($) => $.settings.systemIntegration.explorerMenu.toggle)}
          disabled={working}
          onClick={() => onChange(on ? "remove" : "install")}
          className="-m-1 rounded-full p-1 transition-colors hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
        >
          <SettingsSwitchIndicator checked={on} />
        </button>
      </div>
    );
  }
  const remove = (
    <ActionButton
      busy={busy === "remove"}
      disabled={working}
      label={t(($) => $.common.actions.remove)}
      onClick={() => onChange("remove")}
    />
  );
  if (item.state === "not_installed") {
    return (
      <ActionButton
        busy={busy === "install"}
        disabled={working}
        label={t(($) => $.settings.systemIntegration.actions.install)}
        onClick={() => onChange("install")}
      />
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      {repair}
      {remove}
    </div>
  );
}

function showsQuickActionsHint(item: SystemIntegrationItem): boolean {
  return (
    item.id === "quick_action" && item.state === "installed" && item.quick_actions_menu === false
  );
}

function QuickActionsMenuHint({ title }: Readonly<{ title: string | null }>) {
  const { t } = useTranslation(["settings", "native"]);
  return (
    <p data-testid="system-integration-quick-actions-hint" className="text-xs text-muted-foreground">
      {t(($) => $.settings.systemIntegration.quickAction.menuHint, {
        title: title ?? t(($) => $.native.systemIntegration.openInOleafly),
      })}
    </p>
  );
}

function IntegrationRow({
  item,
  busy,
  failure,
  onChange,
}: Readonly<{
  item: SystemIntegrationItem;
  busy: Change | null;
  failure: Change | null;
  onChange: (change: Change) => void;
}>) {
  const { t } = useTranslation(["settings"]);
  const copy = COPY[item.id];
  const attention = item.attention;
  return (
    <SettingsRow
      testId={`system-integration-${item.id}`}
      aria-busy={busy !== null}
      label={t(($) => $.settings.systemIntegration[copy].label)}
      adornment={<StateBadge state={item.state} />}
      description={t(($) => $.settings.systemIntegration[copy].description)}
      details={
        <>
          {item.packaged ? (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.settings.systemIntegration.packaged)}
            </p>
          ) : null}
          {showsQuickActionsHint(item) ? <QuickActionsMenuHint title={item.menu_title} /> : null}
          {attention ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t(($) => $.settings.systemIntegration.attention[ATTENTION[attention]])}
            </p>
          ) : null}
          {failure ? (
            <p role="alert" className="text-xs text-destructive">
              {failure === "install"
                ? t(($) => $.settings.systemIntegration.failed.install)
                : t(($) => $.settings.systemIntegration.failed.remove)}
            </p>
          ) : null}
        </>
      }
      control={<RowControls item={item} busy={busy} onChange={onChange} />}
    />
  );
}

function isSystemIntegrationStatus(value: unknown): value is SystemIntegrationStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items)
  );
}

export function SystemIntegrationSection({
  shellCommandRow = null,
}: Readonly<{ shellCommandRow?: ReactNode }>) {
  const { t } = useTranslation(["settings"]);
  const [status, setStatus] = useState<SystemIntegrationStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<Partial<Record<SystemIntegrationItemId, Change>>>({});
  const [failures, setFailures] = useState<Partial<Record<SystemIntegrationItemId, Change>>>({});
  const revision = useRef(0);
  const mounted = useRef(false);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const started = revision.current;
    try {
      const next: unknown = await systemIntegrationStatus();
      if (!isSystemIntegrationStatus(next)) {
        throw new Error("unexpected file manager integration status");
      }
      if (!mounted.current || revision.current !== started) return;
      loaded.current = true;
      setStatus(next);
      setLoadFailed(false);
    } catch (error) {
      void logError("check the file manager integration", error);
      if (mounted.current && !loaded.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const awaitingQuickActions = status?.items.some(showsQuickActionsHint) ?? false;

  useEffect(() => {
    if (!awaitingQuickActions) return;
    const onFocus = () => void load();
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [awaitingQuickActions, load]);

  const change = useCallback(async (id: SystemIntegrationItemId, next: Change) => {
    revision.current += 1;
    setBusy((current) => ({ ...current, [id]: next }));
    setFailures((current) => ({ ...current, [id]: undefined }));
    try {
      const item = await setSystemIntegration(id, next === "install");
      setStatus((current) =>
        current
          ? {
              ...current,
              items: current.items.map((existing) => (existing.id === id ? item : existing)),
            }
          : current,
      );
    } catch (error) {
      void logError(`${next} the ${id} file manager integration`, error);
      setFailures((current) => ({ ...current, [id]: next }));
    } finally {
      revision.current += 1;
      setBusy((current) => ({ ...current, [id]: undefined }));
    }
  }, []);

  if (status?.items.length === 0 && !shellCommandRow) return null;

  return (
    <section
      aria-labelledby="settings-system-integration-title"
      data-testid="settings-system-integration"
      className="space-y-2 pt-3"
    >
      <div>
        <SectionHeading id="settings-system-integration-title">
          {t(($) => $.settings.systemIntegration.title)}
        </SectionHeading>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t(($) => $.settings.systemIntegration.description)}
        </p>
      </div>
      {status === null && !loadFailed ? (
        <output
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground"
        >
          <Spinner size="sm" />
          {t(($) => $.settings.systemIntegration.checking)}
        </output>
      ) : null}
      {loadFailed ? (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t(($) => $.settings.systemIntegration.loadFailed)}
        </div>
      ) : null}
      {status?.items.map((item) => (
        <IntegrationRow
          key={item.id}
          item={item}
          busy={busy[item.id] ?? null}
          failure={failures[item.id] ?? null}
          onChange={(next) => void change(item.id, next)}
        />
      ))}
      {shellCommandRow}
    </section>
  );
}
