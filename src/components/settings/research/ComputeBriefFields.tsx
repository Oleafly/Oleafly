import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/empty";
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
  COMPUTE_SANDBOX_CHANGED,
  COMPUTE_TARGETS_CHANGED,
  computeSettings,
  executorFor,
  formatSlurmTime,
  isSlurmName,
  parseCount,
  parseMemory,
  parseSlurmTime,
  sandboxStatus,
  targetSummary,
  type ComputeResources,
  type ComputeTarget,
  type ComputeView,
  type SandboxStatus,
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

/**
 * The Slurm fields of a task. Text that is not valid stays in its field with a
 * message, the brief keeps the last valid value, and `onProblemChange` tells
 * the composer so it doesn't submit that older value.
 */
function SlurmResources({
  id,
  resources,
  onChange,
  onProblemChange,
  disabled,
}: Readonly<{
  id: string;
  resources: ComputeResources;
  onChange: (next: ComputeResources) => void;
  onProblemChange?: (problem: boolean) => void;
  disabled?: boolean;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const [time, setTime] = useState(() => formatSlurmTime(resources.timeMinutes));
  const [partition, setPartition] = useState(() => resources.partition ?? "");
  const [gpus, setGpus] = useState(() => resources.gpus?.toString() ?? "");
  const [cpus, setCpus] = useState(() => resources.cpus?.toString() ?? "");
  const [memory, setMemory] = useState(() => (resources.memoryGb ? String(resources.memoryGb) : ""));
  const blank = (text: string) => text.trim() === "";
  const timeInvalid = !blank(time) && parseSlurmTime(time) === null;
  const partitionInvalid = !blank(partition) && !isSlurmName(partition.trim());
  const gpusInvalid = !blank(gpus) && parseCount(gpus, 0, 64) === null;
  const cpusInvalid = !blank(cpus) && parseCount(cpus, 1, 1024) === null;
  const memoryInvalid = !blank(memory) && parseMemory(memory) === null;
  const problem = timeInvalid || partitionInvalid || gpusInvalid || cpusInvalid || memoryInvalid;

  useEffect(() => {
    onProblemChange?.(problem);
  }, [problem, onProblemChange]);
  useEffect(() => () => onProblemChange?.(false), [onProblemChange]);

  const field = <T,>(text: string, parse: (text: string) => T | null, apply: (value: T | null) => ComputeResources) => {
    const parsed = blank(text) ? null : parse(text);
    // Only a value that reads, or an emptied field, reaches the brief.
    if (blank(text) || parsed !== null) onChange(apply(parsed));
  };
  const message = (invalid: boolean, text: string) =>
    invalid ? <span className="text-destructive">{text}</span> : null;
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
            field(event.target.value, parseSlurmTime, (timeMinutes) => ({ ...resources, timeMinutes }));
          }}
        />
        {message(timeInvalid, t(($) => $.researchTools.compute.form.errors.time))}
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-partition`}>
        {t(($) => $.researchTools.compute.form.partition)}
        <Input
          id={`${id}-partition`}
          value={partition}
          maxLength={64}
          aria-invalid={partitionInvalid || undefined}
          onChange={(event) => {
            setPartition(event.target.value);
            field(
              event.target.value,
              (text) => (isSlurmName(text.trim()) ? text.trim() : null),
              (value) => ({ ...resources, partition: value }),
            );
          }}
        />
        {message(partitionInvalid, t(($) => $.researchTools.compute.form.errors.name))}
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-gpus`}>
        {t(($) => $.researchTools.compute.form.gpus)}
        <Input
          id={`${id}-gpus`}
          inputMode="numeric"
          maxLength={8}
          value={gpus}
          aria-invalid={gpusInvalid || undefined}
          onChange={(event) => {
            setGpus(event.target.value);
            field(event.target.value, (text) => parseCount(text, 0, 64), (value) => ({ ...resources, gpus: value }));
          }}
        />
        {message(gpusInvalid, t(($) => $.researchTools.compute.form.errors.count))}
      </label>
      <label className="grid gap-1 text-xs" htmlFor={`${id}-cpus`}>
        {t(($) => $.researchTools.compute.form.cpus)}
        <Input
          id={`${id}-cpus`}
          inputMode="numeric"
          maxLength={8}
          value={cpus}
          aria-invalid={cpusInvalid || undefined}
          onChange={(event) => {
            setCpus(event.target.value);
            field(event.target.value, (text) => parseCount(text, 1, 1024), (value) => ({ ...resources, cpus: value }));
          }}
        />
        {message(cpusInvalid, t(($) => $.researchTools.compute.form.errors.count))}
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
            field(event.target.value, parseMemory, (value) => ({ ...resources, memoryGb: value }));
          }}
        />
        {message(memoryInvalid, t(($) => $.researchTools.compute.form.errors.mem))}
      </label>
    </fieldset>
  );
}

/** Where a task's runs execute: this computer or a target from Settings, with Slurm resources. */
export function ComputeBriefFields({
  id,
  value,
  onChange,
  onProblemChange,
  onOpenSettings,
  disabled = false,
}: Readonly<{
  id?: string;
  value: BriefCompute;
  onChange: (next: BriefCompute) => void;
  /** Tells the composer whether this choice can't be saved: a removed target or a field that doesn't read. */
  onProblemChange?: (problem: boolean) => void;
  /** Opens Settings; the composer closes first, since Settings can't open inside it. */
  onOpenSettings?: (open: () => void) => void;
  disabled?: boolean;
}>) {
  const { t } = useTranslation(["common", "researchTools"]);
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [view, setView] = useState<ComputeView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [resourceProblem, setResourceProblem] = useState(false);
  const [windowsOff, setWindowsOff] = useState(false);

  const mounted = useRef(true);

  const load = useCallback(() => {
    void computeSettings()
      .then((next) => {
        if (!mounted.current) return;
        setView(next);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!mounted.current) return;
        setLoadFailed(true);
        setView((current) => current ?? { platform: "other", targets: [], tested: {}, sshAvailable: false, rsyncAvailable: false, cuaAvailable: false });
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    window.addEventListener(COMPUTE_TARGETS_CHANGED, load);
    return () => {
      mounted.current = false;
      window.removeEventListener(COMPUTE_TARGETS_CHANGED, load);
    };
  }, [load]);

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
    // Turning the sandbox on in Settings clears the note at once.
    const changed = (event: Event) => {
      const status = (event as CustomEvent<SandboxStatus | undefined>).detail;
      if (live && status) setWindowsOff(status.windowsEnabled !== true);
    };
    window.addEventListener(COMPUTE_SANDBOX_CHANGED, changed);
    return () => {
      live = false;
      window.removeEventListener(COMPUTE_SANDBOX_CHANGED, changed);
    };
  }, [local, platform]);

  const selected = value.target ? view?.targets.find((target) => target.id === value.target) : undefined;
  // A list that failed to load says nothing about whether the target still exists.
  const missing = Boolean(value.target && view && !loadFailed && !selected);
  const tested = selected ? view?.tested[selected.id] : undefined;
  const problem = missing || resourceProblem;
  useEffect(() => {
    onProblemChange?.(problem);
  }, [problem, onProblemChange]);

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
      {loadFailed ? (
        <ErrorState size="compact" message={t(($) => $.researchTools.compute.brief.loadFailed)}>
          <Button size="xs" variant="outline" onClick={load}>
            {t(($) => $.common.actions.retry)}
          </Button>
        </ErrorState>
      ) : null}
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
          onProblemChange={setResourceProblem}
        />
      ) : null}
      {selected?.kind === "cuaSpace" && tested?.relay ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.compute.notes.relay)}</p>
      ) : null}
      {local && windowsOff ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t(($) => $.researchTools.compute.brief.windowsOff)}</span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              const open = () => useSettingsStore.getState().openSettingsAt("research");
              if (onOpenSettings) onOpenSettings(open);
              else open();
            }}
          >
            {t(($) => $.researchTools.compute.brief.openSettings)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
