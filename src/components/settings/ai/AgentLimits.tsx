import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentLimitsGet, agentLimitsSet, type AgentLimits } from "@/lib/tauri";
import { describeError } from "@/lib/app-error";
import { formatNumber } from "@/lib/intl";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { TONES } from "@/components/ui/tones";
import { cn } from "@/lib/utils";

export const AGENT_LIMITS_QUERY_KEY = ["agent-limits"] as const;

export const NO_AGENT_LIMITS: AgentLimits = {
  max_steps: null,
  max_output_tokens: null,
  turn_tokens: null,
};

type LimitKey = keyof AgentLimits;

const RANGES: Record<LimitKey, { min: number; max: number }> = {
  max_steps: { min: 1, max: 2_000 },
  max_output_tokens: { min: 1_024, max: 1_048_576 },
  turn_tokens: { min: 1_000, max: 100_000_000 },
};

const KEYS = Object.keys(RANGES) as LimitKey[];

export function hasAgentLimits(limits: AgentLimits | undefined): boolean {
  return KEYS.some((key) => limits?.[key] != null);
}

export function AgentLimitsSection() {
  const { t } = useTranslation(["settings"]);
  const client = useQueryClient();
  const stored = useQuery({
    queryKey: AGENT_LIMITS_QUERY_KEY,
    queryFn: agentLimitsGet,
    meta: { silent: true },
  });
  const [draft, setDraft] = useState<Partial<Record<LimitKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (next: AgentLimits) => agentLimitsSet(next),
    onSuccess: (next) => {
      client.setQueryData(AGENT_LIMITS_QUERY_KEY, next);
      setDraft({});
    },
    onError: (err) => setError(describeError(err)),
  });

  const fields: Record<LimitKey, { label: string; hint: string; placeholder: string }> = {
    max_steps: {
      label: t(($) => $.settings.ai.limits.stepsLabel),
      hint: t(($) => $.settings.ai.limits.stepsHint),
      placeholder: formatNumber(50),
    },
    max_output_tokens: {
      label: t(($) => $.settings.ai.limits.outputLabel),
      hint: t(($) => $.settings.ai.limits.outputHint),
      placeholder: t(($) => $.settings.ai.limits.modelDefault),
    },
    turn_tokens: {
      label: t(($) => $.settings.ai.limits.turnTokensLabel),
      hint: t(($) => $.settings.ai.limits.turnTokensHint),
      placeholder: t(($) => $.settings.ai.limits.noLimit),
    },
  };

  const shownValue = (key: LimitKey) => {
    const typed = draft[key];
    if (typed !== undefined) return typed;
    const value = stored.data?.[key];
    return value == null ? "" : String(value);
  };

  const submit = () => {
    if (!stored.data) return;
    const next = { ...stored.data };
    for (const key of KEYS) {
      const typed = draft[key]?.trim();
      if (typed === undefined) continue;
      const value = typed === "" ? null : Number(typed);
      const { min, max } = RANGES[key];
      if (value !== null && (!Number.isInteger(value) || value < min || value > max)) {
        setError(
          t(($) => $.settings.ai.limits.rangeError, {
            field: fields[key].label,
            min: formatNumber(min),
            max: formatNumber(max),
          }),
        );
        return;
      }
      next[key] = value;
    }
    setError(null);
    save.mutate(next);
  };

  const editing = Object.keys(draft).length > 0;

  return (
    <div className="space-y-3 border-t pt-4" data-testid="agent-limits">
      <div className="space-y-1">
        <p className="font-medium">{t(($) => $.settings.ai.limits.title)}</p>
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.ai.limits.description)}</p>
      </div>
      {KEYS.map((key) => (
        <Field key={key} id={`agent-limit-${key}`} label={fields[key].label}>
          <Input
            id={`agent-limit-${key}`}
            type="number"
            inputMode="numeric"
            min={RANGES[key].min}
            max={RANGES[key].max}
            step={1}
            placeholder={fields[key].placeholder}
            aria-describedby={`agent-limit-${key}-hint`}
            value={shownValue(key)}
            disabled={!stored.data || save.isPending}
            onChange={(event) => {
              setError(null);
              setDraft((current) => ({ ...current, [key]: event.target.value }));
            }}
            className="h-8 w-40"
          />
          <p id={`agent-limit-${key}-hint`} className="text-xs text-muted-foreground">
            {fields[key].hint}
          </p>
        </Field>
      ))}
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!stored.data || save.isPending || !editing} onClick={submit}>
          {t(($) => $.settings.ai.limits.save)}
        </Button>
        {save.isSuccess && !editing && (
          <span className={cn("text-xs", TONES.emerald.text)}>{t(($) => $.settings.ai.limits.saved)}</span>
        )}
      </div>
    </div>
  );
}
