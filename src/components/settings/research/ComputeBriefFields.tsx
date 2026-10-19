import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ResearchBrief } from "@/lib/research-tasks";
import { useSettingsStore } from "@/store/settings";
import {
  COMPUTE_TARGETS_CHANGED,
  computeSettings,
  executorFor,
  formatSlurmTime,
  parseMemory,
  parseSlurmTime,
  sandboxStatus,
  targetSummary,
  type ComputeResources,
  type ComputeTarget,
  type ComputeView,
} from "./compute-api";

type BriefCompute = ResearchBrief["compute"];

const LOCAL = "local";

/** Every resource field, missing ones as `null`. */
export function fullResources(partial?: Partial<ComputeResources> | null): ComputeResources {
  return {
    timeMinutes: partial?.timeMinutes ?? null,
    partition: partial?.partition ?? null,
    gpus: partial?.gpus ?? null,
    cpus: partial?.cpus ?? null,
    memoryGb: partial?.memoryGb ?? null,
    account: partial?.account ?? null,
    qos: partial?.qos ?? null,
  };
}

/** The brief's compute choice after picking `target` (this computer when `null`). */
export function computeFor(target: ComputeTarget | null): BriefCompute {
  if (!target) return { executor: "local", target: null, resources: null };
  return {
    executor: executorFor(target),
    target: target.id,
    resources: target.kind === "slurm" ? fullResources(target.defaults) : null,
  };
}

function SlurmResources({
  id,
  resources,
  onChange,
  disabled,
}: Readonly<{
  id: string;
  resources: ComputeResources;
  onChange: (next: ComputeResources) => void;
  disabled?: boolean;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const [time, setTime] = useState(() => formatSlurmTime(resources.timeMinutes));
  const [memory, setMemory] = useState(() => (resources.memoryGb ? String(resources.memoryGb) : ""));
  const timeInvalid = time.trim() !== "" && parseSlurmTime(time) === null;
  const memoryInvalid = memory.trim() !== "" && parseMemory(memory) === null;
  const count = (value: string, max: number) => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const number = Number(trimmed);
    return number <= max ? number : null;
  };
  return (
    <fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2" disabled={disabled}>
      <legend className="px-1 text-xs font-medium">{t(($) => $.researchTools.compute.brief.resources)}</legend>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-time`}>
        {t(($) => $.researchTools.compute.form.time)}
        <Input
          id={`${id}-time`}
          value={time}
          placeholder={t(($) => $.researchTools.compute.form.timeHint)}
          aria-invalid={timeInvalid || undefined}
          onChange={(event) => {
            setTime(event.target.value);
            const minutes = event.target.value.trim() === "" ? null : parseSlurmTime(event.target.value);
            if (event.target.value.trim() === "" || minutes !== null) onChange({ ...resources, timeMinutes: minutes });
          }}
        />
        {timeInvalid ? (
          <span className="text-destructive">{t(($) => $.researchTools.compute.form.errors.time)}</span>
        ) : null}
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-partition`}>
        {t(($) => $.researchTools.compute.form.partition)}
        <Input
          id={`${id}-partition`}
          value={resources.partition ?? ""}
          maxLength={64}
          onChange={(event) => onChange({ ...resources, partition: event.target.value.trim() || null })}
        />
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-gpus`}>
        {t(($) => $.researchTools.compute.form.gpus)}
        <Input
          id={`${id}-gpus`}
          inputMode="numeric"
          maxLength={2}
          value={resources.gpus ?? ""}
          onChange={(event) => onChange({ ...resources, gpus: count(event.target.value, 64) })}
        />
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-cpus`}>
        {t(($) => $.researchTools.compute.form.cpus)}
        <Input
          id={`${id}-cpus`}
          inputMode="numeric"
          maxLength={4}
          value={resources.cpus ?? ""}
          onChange={(event) => onChange({ ...resources, cpus: count(event.target.value, 1024) })}
        />
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-mem`}>
        {t(($) => $.researchTools.compute.form.mem)}
        <Input
          id={`${id}-mem`}
          value={memory}
          maxLength={8}
          aria-invalid={memoryInvalid || undefined}
          onChange={(event) => {
            setMemory(event.target.value);
            const gigabytes = event.target.value.trim() === "" ? null : parseMemory(event.target.value);
            if (event.target.value.trim() === "" || gigabytes !== null) onChange({ ...resources, memoryGb: gigabytes });
          }}
        />
        {memoryInvalid ? (
          <span className="text-destructive">{t(($) => $.researchTools.compute.form.errors.mem)}</span>
        ) : null}
      </label>
    </fieldset>
  );
}

/** Where a task's runs execute: this computer or a target from Settings, with Slurm resources. */
export function ComputeBriefFields({
  id,
  value,
  onChange,
  disabled = false,
}: Readonly<{
  id?: string;
  value: BriefCompute;
  onChange: (next: BriefCompute) => void;
  disabled?: boolean;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [view, setView] = useState<ComputeView | null>(null);
  const [windowsOff, setWindowsOff] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => {
      void computeSettings()
        .then((next) => {
          if (live) setView(next);
        })
        .catch(() => {
          if (live) setView((current) => current ?? { platform: "other", targets: [], tested: {}, sshAvailable: false, rsyncAvailable: false, cuaAvailable: false });
        });
    };
    load();
    window.addEventListener(COMPUTE_TARGETS_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(COMPUTE_TARGETS_CHANGED, load);
    };
  }, []);

  const local = value.target === null;
  const platform = view?.platform;
  useEffect(() => {
    if (!local || platform !== "windows") {
      setWindowsOff(false);
      return;
    }
    let live = true;
    void sandboxStatus(false)
      .then((status) => {
        if (live) setWindowsOff(status.windowsEnabled !== true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [local, platform]);

  const selected = value.target ? view?.targets.find((target) => target.id === value.target) : undefined;
  const missing = Boolean(value.target && view && !selected);
  const tested = selected ? view?.tested[selected.id] : undefined;

  return (
    <div className="grid gap-2" data-testid="compute-brief-fields">
      <Select
        value={missing ? "" : (value.target ?? LOCAL)}
        disabled={disabled || !view}
        onValueChange={(chosen) =>
          onChange(computeFor(view?.targets.find((target) => target.id === chosen) ?? null))
        }
      >
        <SelectTrigger id={fieldId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={LOCAL}>{t(($) => $.researchTools.compute.targets.local)}</SelectItem>
          {view?.targets.map((target) => (
            <SelectItem key={target.id} value={target.id}>
              {target.label} · {t(($) => $.researchTools.compute.kind[target.kind])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {missing ? (
        <p role="alert" className="text-xs text-destructive">
          {t(($) => $.researchTools.compute.brief.missing)}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="compute-brief-runs-on">
          {selected
            ? t(($) => $.researchTools.compute.brief.runsOn, { target: targetSummary(selected, tested?.resolved) })
            : t(($) => $.researchTools.compute.brief.runsLocal)}
        </p>
      )}
      {selected?.kind === "slurm" ? (
        <SlurmResources
          key={selected.id}
          id={`${fieldId}-slurm`}
          resources={fullResources(value.resources ?? selected.defaults)}
          disabled={disabled}
          onChange={(resources) => onChange({ ...value, resources })}
        />
      ) : null}
      {selected?.kind === "cuaSpace" && tested?.relay ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">{t(($) => $.researchTools.compute.notes.relay)}</p>
      ) : null}
      {local && windowsOff ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t(($) => $.researchTools.compute.brief.windowsOff)}</span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => useSettingsStore.getState().openSettingsAt("research")}
          >
            {t(($) => $.researchTools.compute.brief.openSettings)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
