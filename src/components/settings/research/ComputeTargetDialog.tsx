import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { appModalCoordinator } from "@/components/ui/use-modal-accessibility";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import {
  formatSlurmTime,
  parseMemory,
  parseSlurmTime,
  validateTarget,
  type ComputeTarget,
  type GpuFlag,
  type TargetError,
  type TargetField,
} from "./compute-api";

/** What the form edits: numbers stay text until saving. */
export interface Draft {
  label: string;
  host: string;
  user: string;
  port: string;
  remoteRoot: string;
  prelude: string;
  time: string;
  partition: string;
  account: string;
  qos: string;
  gpus: string;
  cpus: string;
  mem: string;
  gpuFlag: GpuFlag;
  space: string;
  perTask: boolean;
  image: string;
}

export function draftOf(target: ComputeTarget): Draft {
  const text = (value: string | number | null | undefined) => (value === null || value === undefined ? "" : String(value));
  const base: Draft = {
    label: target.label,
    host: "",
    user: "",
    port: "",
    remoteRoot: "",
    prelude: "",
    time: "",
    partition: "",
    account: "",
    qos: "",
    gpus: "",
    cpus: "",
    mem: "",
    gpuFlag: "gres",
    space: "",
    perTask: false,
    image: "",
  };
  if (target.kind === "cuaSpace") {
    return { ...base, space: target.space, perTask: target.perTask, image: text(target.image) };
  }
  const remote = {
    ...base,
    host: target.host,
    user: text(target.user),
    port: text(target.port),
    remoteRoot: text(target.remoteRoot),
    prelude: target.prelude,
  };
  if (target.kind === "ssh") return remote;
  const defaults = target.defaults;
  return {
    ...remote,
    time: formatSlurmTime(defaults.timeMinutes),
    partition: text(defaults.partition),
    account: text(defaults.account),
    qos: text(defaults.qos),
    gpus: text(defaults.gpus),
    cpus: text(defaults.cpus),
    mem: text(defaults.memoryGb),
    gpuFlag: target.gpuFlag,
  };
}

const optional = (value: string) => (value.trim() === "" ? null : value.trim());

/** A whole number, `null` when empty, `NaN` when it is not one. */
function count(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

type ParseErrors = Partial<Record<TargetField, TargetError>>;

function cuaSpaceFromDraft(id: string, draft: Draft): ComputeTarget {
  return {
    kind: "cuaSpace",
    id,
    label: draft.label.trim(),
    space: draft.perTask ? "" : draft.space.trim(),
    perTask: draft.perTask,
    image: optional(draft.image),
  };
}

/** The fields an SSH host and a Slurm cluster share. */
function remoteFromDraft(id: string, draft: Draft, parseErrors: ParseErrors) {
  const port = count(draft.port);
  if (Number.isNaN(port)) parseErrors.port = "port";
  return {
    id,
    label: draft.label.trim(),
    host: draft.host.trim(),
    user: optional(draft.user),
    port: Number.isNaN(port) ? null : port,
    remoteRoot: optional(draft.remoteRoot),
    prelude: draft.prelude,
  };
}

function slurmDefaultsFromDraft(draft: Draft, parseErrors: ParseErrors): Extract<ComputeTarget, { kind: "slurm" }>["defaults"] {
  const timeMinutes = draft.time.trim() === "" ? null : parseSlurmTime(draft.time);
  if (draft.time.trim() !== "" && timeMinutes === null) parseErrors.time = "time";
  const memoryGb = draft.mem.trim() === "" ? null : parseMemory(draft.mem);
  if (draft.mem.trim() !== "" && memoryGb === null) parseErrors.mem = "mem";
  const gpus = count(draft.gpus);
  if (Number.isNaN(gpus)) parseErrors.gpus = "count";
  const cpus = count(draft.cpus);
  if (Number.isNaN(cpus)) parseErrors.cpus = "count";
  return {
    timeMinutes,
    partition: optional(draft.partition),
    account: optional(draft.account),
    qos: optional(draft.qos),
    gpus: Number.isNaN(gpus) ? null : gpus,
    cpus: Number.isNaN(cpus) ? null : cpus,
    memoryGb,
  };
}

/** The target the draft describes, and the errors the form shows. */
export function targetFromDraft(
  original: ComputeTarget,
  draft: Draft,
): { target: ComputeTarget; errors: Partial<Record<TargetField, TargetError>> } {
  const parseErrors: ParseErrors = {};
  let target: ComputeTarget;
  if (original.kind === "cuaSpace") {
    target = cuaSpaceFromDraft(original.id, draft);
  } else if (original.kind === "ssh") {
    target = { kind: "ssh", ...remoteFromDraft(original.id, draft, parseErrors) };
  } else {
    target = {
      kind: "slurm",
      ...remoteFromDraft(original.id, draft, parseErrors),
      defaults: slurmDefaultsFromDraft(draft, parseErrors),
      gpuFlag: draft.gpuFlag,
    };
  }
  return { target, errors: { ...validateTarget(target), ...parseErrors } };
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: Readonly<{ id: string; label: string; hint?: string; error?: string; children: ReactNode }>) {
  // An error replaces the hint.
  const note = error || hint;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {note ? (
        <p id={`${id}-message`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function ComputeTargetDialog({
  target,
  onClose,
  onSave,
}: Readonly<{
  target: ComputeTarget;
  onClose: () => void;
  onSave: (target: ComputeTarget) => Promise<void>;
}>) {
  const { t } = useTranslation(["researchTools"]);
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(target));
  const [errors, setErrors] = useState<Partial<Record<TargetField, TargetError>>>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modalId = appModalCoordinator.add(opener);
    return () => {
      appModalCoordinator.remove(modalId)?.focus({ preventScroll: true });
    };
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const id = (field: string) => `${prefix}-${field}`;
  const message = (field: TargetField) => {
    const key = errors[field];
    return key ? t(($) => $.researchTools.compute.form.errors[key]) : undefined;
  };
  const invalid = (field: TargetField) =>
    errors[field] ? { "aria-invalid": true, "aria-describedby": `${id(field)}-message` } : {};

  const submit = async () => {
    const result = targetFromDraft(target, draft);
    setErrors(result.errors);
    if (Object.keys(result.errors).length > 0) return;
    setSaving(true);
    setFailure(null);
    try {
      await onSave(result.target);
      onClose();
    } catch (error) {
      setFailure(t(($) => $.researchTools.compute.targets.saveFailed, { message: describeError(error) }));
      setSaving(false);
    }
  };

  const kindLabel = t(($) => $.researchTools.compute.kind[target.kind]);
  const title = target.id
    ? t(($) => $.researchTools.compute.form.editTitle, { label: target.label })
    : t(($) => $.researchTools.compute.form.addTitle, { kind: kindLabel });

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        closeDisabled={saving}
        onEscapeKeyDown={(event) => saving && event.preventDefault()}
        onPointerDownOutside={(event) => saving && event.preventDefault()}
        className="z-[120] max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg"
        overlayClassName="z-[120]"
        data-testid="compute-target-dialog"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{kindLabel}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field id={id("label")} label={t(($) => $.researchTools.compute.form.label)} error={message("label")}>
            <Input
              id={id("label")}
              value={draft.label}
              maxLength={80}
              onChange={(event) => set("label", event.target.value)}
              {...invalid("label")}
            />
          </Field>

          {target.kind === "cuaSpace" ? (
            <>
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium">{t(($) => $.researchTools.compute.form.spaceMode)}</legend>
                <RadioGroup
                  value={draft.perTask ? "perTask" : "named"}
                  onValueChange={(value) => set("perTask", value === "perTask")}
                >
                  <label htmlFor={id("named")} className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem id={id("named")} value="named" />
                    {t(($) => $.researchTools.compute.form.spaceNamed)}
                  </label>
                  <label htmlFor={id("perTask")} className="flex cursor-pointer items-center gap-2 text-sm">
                    <RadioGroupItem id={id("perTask")} value="perTask" />
                    {t(($) => $.researchTools.compute.form.spacePerTask)}
                  </label>
                </RadioGroup>
              </fieldset>
              {draft.perTask ? null : (
                <Field id={id("space")} label={t(($) => $.researchTools.compute.form.space)} error={message("space")}>
                  <Input
                    id={id("space")}
                    value={draft.space}
                    maxLength={63}
                    spellCheck={false}
                    onChange={(event) => set("space", event.target.value)}
                    {...invalid("space")}
                  />
                </Field>
              )}
              <Field id={id("image")} label={t(($) => $.researchTools.compute.form.image)} error={message("image")}>
                <Input
                  id={id("image")}
                  value={draft.image}
                  maxLength={200}
                  spellCheck={false}
                  onChange={(event) => set("image", event.target.value)}
                  {...invalid("image")}
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                id={id("host")}
                label={t(($) => $.researchTools.compute.form.host)}
                hint={t(($) => $.researchTools.compute.form.hostHint)}
                error={message("host")}
              >
                <Input
                  id={id("host")}
                  value={draft.host}
                  maxLength={253}
                  spellCheck={false}
                  autoCapitalize="off"
                  onChange={(event) => set("host", event.target.value)}
                  {...invalid("host")}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <Field
                  id={id("user")}
                  label={t(($) => $.researchTools.compute.form.user)}
                  hint={t(($) => $.researchTools.compute.form.userHint)}
                  error={message("user")}
                >
                  <Input
                    id={id("user")}
                    value={draft.user}
                    maxLength={64}
                    spellCheck={false}
                    autoCapitalize="off"
                    onChange={(event) => set("user", event.target.value)}
                    {...invalid("user")}
                  />
                </Field>
                <Field id={id("port")} label={t(($) => $.researchTools.compute.form.port)} error={message("port")}>
                  <Input
                    id={id("port")}
                    value={draft.port}
                    inputMode="numeric"
                    maxLength={5}
                    placeholder={"22"}
                    onChange={(event) => set("port", event.target.value)}
                    {...invalid("port")}
                  />
                </Field>
              </div>
              <Field
                id={id("remoteRoot")}
                label={t(($) => $.researchTools.compute.form.remoteRoot)}
                hint={t(($) => $.researchTools.compute.form.remoteRootHint)}
                error={message("remoteRoot")}
              >
                <Input
                  id={id("remoteRoot")}
                  value={draft.remoteRoot}
                  maxLength={200}
                  spellCheck={false}
                  placeholder={".oleafly-runs"}
                  onChange={(event) => set("remoteRoot", event.target.value)}
                  {...invalid("remoteRoot")}
                />
              </Field>
              {target.kind === "slurm" ? (
                <fieldset className="space-y-3 rounded-lg border p-3">
                  <legend className="px-1 text-xs font-medium">
                    {t(($) => $.researchTools.compute.brief.resources)}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      id={id("time")}
                      label={t(($) => $.researchTools.compute.form.time)}
                      hint={t(($) => $.researchTools.compute.form.timeHint)}
                      error={message("time")}
                    >
                      <Input
                        id={id("time")}
                        value={draft.time}
                        maxLength={16}
                        spellCheck={false}
                        onChange={(event) => set("time", event.target.value)}
                        {...invalid("time")}
                      />
                    </Field>
                    <Field
                      id={id("partition")}
                      label={t(($) => $.researchTools.compute.form.partition)}
                      error={message("partition")}
                    >
                      <Input
                        id={id("partition")}
                        value={draft.partition}
                        maxLength={64}
                        spellCheck={false}
                        onChange={(event) => set("partition", event.target.value)}
                        {...invalid("partition")}
                      />
                    </Field>
                    <Field
                      id={id("account")}
                      label={t(($) => $.researchTools.compute.form.account)}
                      error={message("account")}
                    >
                      <Input
                        id={id("account")}
                        value={draft.account}
                        maxLength={64}
                        spellCheck={false}
                        onChange={(event) => set("account", event.target.value)}
                        {...invalid("account")}
                      />
                    </Field>
                    <Field id={id("qos")} label={t(($) => $.researchTools.compute.form.qos)} error={message("qos")}>
                      <Input
                        id={id("qos")}
                        value={draft.qos}
                        maxLength={64}
                        spellCheck={false}
                        onChange={(event) => set("qos", event.target.value)}
                        {...invalid("qos")}
                      />
                    </Field>
                    <Field id={id("gpus")} label={t(($) => $.researchTools.compute.form.gpus)} error={message("gpus")}>
                      <Input
                        id={id("gpus")}
                        value={draft.gpus}
                        inputMode="numeric"
                        maxLength={2}
                        onChange={(event) => set("gpus", event.target.value)}
                        {...invalid("gpus")}
                      />
                    </Field>
                    <Field id={id("cpus")} label={t(($) => $.researchTools.compute.form.cpus)} error={message("cpus")}>
                      <Input
                        id={id("cpus")}
                        value={draft.cpus}
                        inputMode="numeric"
                        maxLength={4}
                        onChange={(event) => set("cpus", event.target.value)}
                        {...invalid("cpus")}
                      />
                    </Field>
                    <Field
                      id={id("mem")}
                      label={t(($) => $.researchTools.compute.form.mem)}
                      hint={t(($) => $.researchTools.compute.form.memHint)}
                      error={message("mem")}
                    >
                      <Input
                        id={id("mem")}
                        value={draft.mem}
                        maxLength={8}
                        onChange={(event) => set("mem", event.target.value)}
                        {...invalid("mem")}
                      />
                    </Field>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-medium">{t(($) => $.researchTools.compute.form.gpuFlag)}</legend>
                    <RadioGroup value={draft.gpuFlag} onValueChange={(value) => set("gpuFlag", value as GpuFlag)}>
                      <label htmlFor={id("gres")} className="flex cursor-pointer items-center gap-2 text-sm">
                        <RadioGroupItem id={id("gres")} value="gres" />
                        <code className="text-xs">{"--gres=gpu:N"}</code>
                      </label>
                      <label htmlFor={id("gpusFlag")} className="flex cursor-pointer items-center gap-2 text-sm">
                        <RadioGroupItem id={id("gpusFlag")} value="gpus" />
                        <code className="text-xs">{"--gpus=N"}</code>
                      </label>
                    </RadioGroup>
                  </fieldset>
                </fieldset>
              ) : null}
              <Field
                id={id("prelude")}
                label={t(($) => $.researchTools.compute.form.prelude)}
                hint={t(($) => $.researchTools.compute.form.preludeHint)}
              >
                <Textarea
                  id={id("prelude")}
                  value={draft.prelude}
                  rows={4}
                  maxLength={4096}
                  spellCheck={false}
                  className="font-mono text-xs"
                  onChange={(event) => set("prelude", event.target.value)}
                />
              </Field>
            </>
          )}

          {failure ? (
            <p role="alert" className="select-text rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {failure}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t(($) => $.researchTools.compute.form.cancel)}
            </Button>
            <Button type="submit" disabled={saving} data-testid="compute-target-save">
              {saving ? <Spinner size="sm" aria-hidden /> : null}
              {t(($) => $.researchTools.compute.form.save)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
