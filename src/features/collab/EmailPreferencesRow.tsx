import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AtSign, Mail } from "lucide-react";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { collabEmailPreferences, collabSetEmailPreferences, type CollabEmailPreferences } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";
import { InlineAlert } from "./feedback";

type Choice = "shared_with_you" | "mentions";

export function EmailPreferencesRow({ serverId }: Readonly<{ serverId: string }>) {
  const { t } = useTranslation(["collab"]);
  const [preferences, setPreferences] = useState<CollabEmailPreferences | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    collabEmailPreferences(serverId).then(
      (next) => {
        if (active) setPreferences(next);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [serverId]);

  if (loadFailed) {
    return <p className="text-xs text-muted-foreground">{t(($) => $.collab.section.server.emails.loadFailed)}</p>;
  }
  if (!preferences) return null;

  const available = preferences.mail_configured && preferences.notifications;
  const description = () => {
    if (!preferences.mail_configured) return t(($) => $.collab.section.server.emails.noMail);
    if (!preferences.notifications) return t(($) => $.collab.section.server.emails.paused);
    return t(($) => $.collab.section.server.emails.description);
  };

  const change = async (choice: Choice, value: boolean) => {
    if (saving) return;
    const previous = preferences;
    setPreferences({ ...preferences, [choice]: value });
    setSaving(true);
    setError(null);
    try {
      const patch = choice === "mentions" ? { mentions: value } : { shared_with_you: value };
      setPreferences(await collabSetEmailPreferences(serverId, patch));
    } catch (error_) {
      setPreferences(previous);
      setError(collabErrorMessage(collabErrorCode(error_)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <SettingsToggleRow
        testId="collab-share-emails"
        label={t(($) => $.collab.section.server.emails.label)}
        description={description()}
        checked={available && preferences.shared_with_you}
        disabled={!available || saving}
        icon={<Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        onChange={(value) => void change("shared_with_you", value)}
      />
      {typeof preferences.mentions === "boolean" ? (
        <SettingsToggleRow
          testId="collab-mention-emails"
          label={t(($) => $.collab.section.server.emails.mentionsLabel)}
          description={t(($) => $.collab.section.server.emails.mentionsDescription)}
          checked={available && preferences.mentions}
          disabled={!available || saving}
          icon={<AtSign aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          onChange={(value) => void change("mentions", value)}
        />
      ) : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}
