import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { LoadingState } from "@/components/ui/empty";
import type {
  CollabRuntimeSettings,
  CollabRuntimeSettingsPatch,
} from "@/lib/tauri";
import {
  collabAdminPatchSettings,
  collabAdminSettings,
} from "@/lib/tauri-collab";
import { collabErrorText } from "./errors";
import { InlineAlert, LoadFailed } from "./feedback";
import { serverRoleAllows, type ServerRole } from "./roles";

export const RUNTIME_SETTING_FIELDS = [
  "directory_visible",
  "directory_shows_email",
  "link_sharing_allowed",
  "access_logs_allowed",
  "comments_allowed",
  "email_link_sign_in",
  "guests_enabled",
  "guest_approval_required",
] as const satisfies readonly (keyof CollabRuntimeSettings)[];

export type RuntimeSettingField = (typeof RUNTIME_SETTING_FIELDS)[number];

export const RUNTIME_SETTING_COPY = {
  directory_visible: "directoryVisible",
  directory_shows_email: "directoryShowsEmail",
  link_sharing_allowed: "linkSharingAllowed",
  access_logs_allowed: "accessLogsAllowed",
  comments_allowed: "commentsAllowed",
  email_link_sign_in: "emailLinkSignIn",
  guests_enabled: "guestsEnabled",
  guest_approval_required: "guestApprovalRequired",
} as const satisfies Record<RuntimeSettingField, string>;

const REQUIRES: Readonly<Partial<Record<RuntimeSettingField, RuntimeSettingField>>> = {
  directory_shows_email: "directory_visible",
  guest_approval_required: "guests_enabled",
};

export function RuntimeSettingsTab({ serverId, actor }: Readonly<{ serverId: string; actor: ServerRole }>) {
  const { t } = useTranslation(["collab"]);
  const editable = serverRoleAllows(actor, "changeSettings");
  const [settings, setSettings] = useState<CollabRuntimeSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [request, setRequest] = useState(0);

  const load = useMemo(() => ({ serverId, request }), [serverId, request]);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    collabAdminSettings(load.serverId).then(
      (next) => {
        if (active) setSettings(next);
      },
      (error: unknown) => {
        if (active) setLoadError(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const change = async (field: RuntimeSettingField, value: boolean) => {
    if (!settings || saving) return;
    const previous = settings;
    const optimistic = { ...settings };
    optimistic[field] = value;
    const patch: CollabRuntimeSettingsPatch = {};
    patch[field] = value;
    setSettings(optimistic);
    setSaving(true);
    setSaveError(null);
    try {
      setSettings(await collabAdminPatchSettings(serverId, patch));
    } catch (error) {
      setSettings(previous);
      setSaveError(collabErrorText(error));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <LoadFailed
        message={t(($) => $.collab.admin.loadFailed)}
        reason={loadError}
        onRetry={() => setRequest((count) => count + 1)}
      />
    );
  }
  if (!settings) return <LoadingState size="compact" label={t(($) => $.collab.admin.settings.loading)} />;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.admin.settings.description)}</p>
      {editable ? null : <SettingsNote>{t(($) => $.collab.admin.settings.adminOnly)}</SettingsNote>}
      {RUNTIME_SETTING_FIELDS.map((field) => {
        const key = RUNTIME_SETTING_COPY[field];
        const parent = REQUIRES[field];
        return (
          <SettingsToggleRow
            key={field}
            testId={`collab-setting-${field}`}
            label={t(($) => $.collab.admin.settings[key].label)}
            description={t(($) => $.collab.admin.settings[key].description)}
            checked={settings[field] ?? false}
            disabled={!editable || saving || (parent !== undefined && !settings[parent])}
            onChange={(value) => void change(field, value)}
          />
        );
      })}
      {saveError ? <InlineAlert>{saveError}</InlineAlert> : null}
    </div>
  );
}
