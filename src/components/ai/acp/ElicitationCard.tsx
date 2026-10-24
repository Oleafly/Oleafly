import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AcpElicitation, AcpElicitationField, AcpFieldKind } from "@/lib/acp";
import { openInSystemBrowser } from "@/lib/system-browser";

type Value = string | number | boolean | string[];
type Action = "accept" | "decline" | "cancel";

function initialValue(field: AcpElicitationField): Value | undefined {
  if (field.secret) return undefined;
  const value = field.default;
  switch (field.kind.type) {
    case "boolean":
      return typeof value === "boolean" ? value : false;
    case "number":
      return typeof value === "number" ? value : undefined;
    case "choice":
      if (field.kind.multiple) return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      return typeof value === "string" ? value : undefined;
    default:
      return typeof value === "string" ? value : undefined;
  }
}

type StringKind = Extract<AcpFieldKind, { type: "string" }>;
type NumberKind = Extract<AcpFieldKind, { type: "number" }>;
type ChoiceKind = Extract<AcpFieldKind, { type: "choice" }>;

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function stringProblem(kind: StringKind, value: Value): boolean {
  if (typeof value !== "string") return true;
  const length = [...value].length;
  if (kind.minLength !== null && length < kind.minLength) return true;
  if (kind.maxLength !== null && length > kind.maxLength) return true;
  if (kind.format === "email") return !value.includes("@") || /\s/.test(value);
  if (kind.format === "uri") return !isUrl(value);
  return false;
}

function numberProblem(kind: NumberKind, value: Value): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return true;
  if (kind.integer && !Number.isInteger(value)) return true;
  if (kind.minimum !== null && value < kind.minimum) return true;
  return kind.maximum !== null && value > kind.maximum;
}

function choiceProblem(kind: ChoiceKind, value: Value): boolean {
  const known = new Set(kind.options.map(([id]) => id));
  return Array.isArray(value) ? value.some((item) => !known.has(item)) : !known.has(String(value));
}

/** The client-side check, mirroring the one Oleafly runs before sending. */
export function fieldProblem(field: AcpElicitationField, value: Value | undefined): boolean {
  const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) return field.required;
  const { kind } = field;
  switch (kind.type) {
    case "string":
      return stringProblem(kind, value);
    case "number":
      return numberProblem(kind, value);
    case "boolean":
      return typeof value !== "boolean";
    case "choice":
      return choiceProblem(kind, value);
  }
}

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function textInputType(secret: boolean, format: string | null): "password" | "email" | "text" {
  if (secret) return "password";
  return format === "email" ? "email" : "text";
}

/** One checkbox per option, for a choice the agent lets the user pick several of. */
function MultiChoice({
  id,
  options,
  value,
  onChange,
}: Readonly<{ id: string; options: [string, string][]; value: Value | undefined; onChange(next: string[]): void }>) {
  const list = Array.isArray(value) ? value : [];
  return (
    <div className="flex flex-col gap-1">
      {options.map(([option, title], index) => (
        <label key={option} htmlFor={`${id}-${index}`} className="flex items-center gap-2">
          <Checkbox
            id={`${id}-${index}`}
            checked={list.includes(option)}
            onCheckedChange={(next) => onChange(next === true ? [...list, option] : list.filter((item) => item !== option))}
          />
          {title}
        </label>
      ))}
    </div>
  );
}

/** The control that fits the field's kind: a switch, checkboxes, a select or an input. */
function FieldControl({
  field,
  id,
  value,
  invalid,
  onChange,
}: Readonly<{
  field: AcpElicitationField;
  id: string;
  value: Value | undefined;
  invalid: boolean;
  onChange(next: Value | undefined): void;
}>) {
  const { kind } = field;
  if (kind.type === "boolean") {
    return <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
  }
  if (kind.type === "choice" && kind.multiple) {
    return <MultiChoice id={id} options={kind.options} value={value} onChange={onChange} />;
  }
  if (kind.type === "choice") {
    return (
      <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
        <SelectTrigger id={id} aria-invalid={invalid} className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent className="z-[110]">
          {kind.options.map(([option, title]) => (
            <SelectItem key={option} value={option}>{title}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (kind.type === "number") {
    return (
      <Input
        id={id}
        type="number"
        min={kind.minimum ?? undefined}
        max={kind.maximum ?? undefined}
        step={kind.integer ? 1 : "any"}
        aria-invalid={invalid}
        className="h-7 text-xs"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    );
  }
  return (
    <Input
      id={id}
      type={textInputType(field.secret, kind.format)}
      autoComplete="off"
      aria-invalid={invalid}
      className="h-7 text-xs"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** A field of the form: its label, its description, its control and, once checked, what is wrong. */
function FieldRow({
  field,
  requestId,
  value,
  checked,
  onChange,
}: Readonly<{
  field: AcpElicitationField;
  requestId: string;
  value: Value | undefined;
  /** Set once the user has tried to submit; only then are the fields marked. */
  checked: boolean;
  onChange(name: string, next: Value | undefined): void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const id = `acp-field-${requestId}-${field.name}`;
  const invalid = checked && fieldProblem(field, value);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center gap-1 font-medium">
        {field.title ?? field.name}
        {field.required && <span className="text-muted-foreground">({t(($) => $.ai.acp.elicitation.required)})</span>}
      </label>
      {field.description && <p className="text-muted-foreground">{field.description}</p>}
      <FieldControl field={field} id={id} value={value} invalid={invalid} onChange={(next) => onChange(field.name, next)} />
      {invalid && <p role="alert" className="text-destructive">{t(($) => $.ai.acp.elicitation.invalid)}</p>}
    </div>
  );
}

/** A question from the agent: a form to fill in, or a site to finish a step on. */
export function ElicitationCard({
  request,
  agentName,
  onRespond,
}: Readonly<{
  request: AcpElicitation;
  agentName: string;
  onRespond(action: Action, content?: Record<string, unknown>): Promise<void>;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const initial = useMemo(
    () => Object.fromEntries(request.fields.map((field) => [field.name, initialValue(field)])),
    [request.fields],
  );
  const [values, setValues] = useState<Record<string, Value | undefined>>(initial);
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const set = (name: string, value: Value | undefined) => setValues((current) => ({ ...current, [name]: value }));
  const problems = request.fields.filter((field) => fieldProblem(field, values[field.name]));

  const respond = (action: Action, content?: Record<string, unknown>) => {
    setSending(true);
    void onRespond(action, content).finally(() => setSending(false));
  };
  const submit = () => {
    setChecked(true);
    if (problems.length > 0) return;
    const content: Record<string, unknown> = {};
    for (const field of request.fields) {
      const value = values[field.name];
      if (value !== undefined && value !== "") content[field.name] = value;
    }
    respond("accept", content);
  };
  const openLink = async () => {
    setConfirming(false);
    if (!request.url) return;
    // Opened first: when no browser opens, the agent is not told it was.
    if (!(await openInSystemBrowser(request.url))) {
      setLinkFailed(true);
      return;
    }
    setLinkFailed(false);
    setWaiting(true);
    respond("accept");
  };

  return (
    <fieldset
      data-testid="acp-elicitation"
      aria-label={t(($) => $.ai.acp.elicitation.ariaLabel)}
      className="space-y-2 rounded-lg border bg-card p-3 text-xs"
    >
      <legend className="sr-only">{t(($) => $.ai.acp.elicitation.ariaLabel)}</legend>
      <p className="font-medium text-foreground">{t(($) => $.ai.acp.elicitation.from, { agent: agentName })}</p>
      {request.message && <p className="whitespace-pre-wrap text-muted-foreground">{request.message}</p>}
      {request.mode === "url" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">{hostOf(request.url)}</span>
          {waiting ? (
            <span className="text-muted-foreground">{t(($) => $.ai.acp.elicitation.waiting)}</span>
          ) : (
            <Button type="button" size="sm" disabled={sending} onClick={() => setConfirming(true)}>
              <ExternalLink className="size-3.5" /> {t(($) => $.ai.acp.elicitation.openUrl)}
            </Button>
          )}
        </div>
      ) : (
        <form
          className="space-y-2"
          // The fields are checked by fieldProblem, which marks each one. The
          // browser's own check would stop the submit first, with its own message.
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {request.fields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              requestId={request.id}
              value={values[field.name]}
              checked={checked}
              onChange={set}
            />
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" size="sm" disabled={sending}>{t(($) => $.ai.acp.elicitation.submit)}</Button>
            <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => respond("decline")}>
              {t(($) => $.ai.acp.elicitation.decline)}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={() => respond("cancel")}>
              {t(($) => $.ai.acp.elicitation.cancel)}
            </Button>
          </div>
        </form>
      )}
      {linkFailed && (
        <p role="alert" className="text-destructive">{t(($) => $.ai.acp.elicitation.openFailed)}</p>
      )}
      {request.mode === "url" && !waiting && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => respond("decline")}>
            {t(($) => $.ai.acp.elicitation.decline)}
          </Button>
        </div>
      )}
      <ConfirmationDialog
        open={confirming}
        title={t(($) => $.ai.acp.elicitation.confirmTitle, { host: hostOf(request.url) })}
        description={t(($) => $.ai.acp.elicitation.confirmDescription)}
        confirmLabel={t(($) => $.ai.acp.elicitation.openUrl)}
        onConfirm={() => void openLink()}
        onCancel={() => setConfirming(false)}
      />
    </fieldset>
  );
}
