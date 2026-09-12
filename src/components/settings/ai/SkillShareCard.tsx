import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/app-error";
import { formatNumber } from "@/lib/intl";
import { skillsShareSync, skillsShareTargets, type SkillShareTarget } from "@/lib/tauri";

export function SkillShareCard() {
  const { t } = useTranslation(["common", "settings"]);
  const [targets, setTargets] = useState<SkillShareTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void skillsShareTargets()
      .then((result) => {
        if (cancelled) return;
        setTargets(result);
        if (result.length > 0) setEnabled(result.every((target) => target.enabled));
        setLoaded(true);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(describeError(fetchError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    setError(null);
    try {
      const result = await skillsShareSync(next);
      setTargets(result);
    } catch (syncError) {
      setEnabled(previous);
      setError(describeError(syncError));
    } finally {
      setBusy(false);
    }
  };

  const statusFor = (target: SkillShareTarget): string => {
    if (!target.supported) return t(($) => $.settings.ai.skills.share.status.unsupported);
    if (!target.detected) return t(($) => $.settings.ai.skills.share.status.undetected);
    return t(($) => $.settings.ai.skills.share.status.linked, {
      linked: formatNumber(target.linked),
      total: formatNumber(target.total),
    });
  };

  const linkedCount = targets.filter((target) => target.detected && target.linked > 0).length;
  const summaryFor = (): string => {
    if (loading) return t(($) => $.settings.ai.skills.share.summary.checking);
    if (targets.length === 0) return t(($) => $.settings.ai.skills.share.summary.none);
    return t(($) => $.settings.ai.skills.share.summary.linked, {
      linked: formatNumber(linkedCount),
      count: targets.length,
    });
  };
  const summary = summaryFor();

  return (
    <CollapsibleSection
      id="skills-share-card"
      headingLevel="h4"
      title={t(($) => $.settings.ai.skills.share.title)}
      description={t(($) => $.settings.ai.skills.share.description)}
      trailing={
        <>
          <span data-testid="skills-share-summary" className="hidden text-[11px] text-muted-foreground sm:inline">
            {summary}
          </span>
          {loading ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              data-testid="skills-share-toggle"
              checked={enabled}
              disabled={busy || !loaded}
              aria-label={t(($) => $.settings.ai.skills.share.title)}
              onCheckedChange={(checked) => void toggle(checked)}
            />
          )}
        </>
      }
    >
      {!loading && targets.length > 0 ? (
        <ul className="space-y-1">
          {targets.map((target) => (
            <li
              key={target.agent}
              data-testid={`skills-share-target-${target.agent}`}
              className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <span className="font-medium">{target.label}</span>
                <span className="ml-1.5 text-muted-foreground">{target.root}</span>
              </div>
              <span className="shrink-0 text-muted-foreground">{statusFor(target)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && targets.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.ai.skills.share.emptyBody)}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </CollapsibleSection>
  );
}
