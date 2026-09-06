import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Switch } from "@/components/ui/switch";
import { skillsShareSync, skillsShareTargets, type SkillShareTarget } from "@/lib/tauri";

export function SkillShareCard() {
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
        if (!cancelled) setError(String(fetchError));
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
      setError(String(syncError));
    } finally {
      setBusy(false);
    }
  };

  const statusFor = (target: SkillShareTarget): string => {
    if (!target.supported) return "Not supported on this system";
    if (!target.detected) return "Not found on this device";
    return `${target.linked} of ${target.total} linked`;
  };

  const linkedCount = targets.filter((target) => target.detected && target.linked > 0).length;
  const summary = loading
    ? "Checking agent folders"
    : targets.length === 0
      ? "No other agent folders were found"
      : `${linkedCount} of ${targets.length} agents linked`;

  return (
    <CollapsibleSection
      id="skills-share-card"
      icon={Share2}
      headingLevel="h4"
      title="Share skills with other agents on this computer"
      description="Link your skills into the folders other coding agents on this computer already read, so you write a skill once and every agent can use it."
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
              aria-label="Share skills with other agents on this computer"
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
        <p className="text-xs text-muted-foreground">No other agent folders were found on this computer.</p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </CollapsibleSection>
  );
}
