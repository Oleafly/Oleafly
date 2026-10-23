import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AcpElicitation, AcpElicitationField } from "@/lib/acp";
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

/** The client-side check, mirroring the one Oleafly runs before sending. */
export function fieldProblem(field: AcpElicitationField, value: Value | undefined): boolean {
  const empty = value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  if (empty) return field.required;
  switch (field.kind.type) {
    case "string": {
      if (typeof value !== "string") return true;
      const length = [...value].length;
      if (field.kind.minLength !== null && length < field.kind.minLength) return true;
      if (field.kind.maxLength !== null && length > field.kind.maxLength) return true;
      if (field.kind.format === "email") return !value.includes("@") || /\s/.test(value);
      if (field.kind.format === "uri") {
        try {
          new URL(value);
        } catch {
          return true;
        }
      }
      return false;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return true;
      if (field.kind.integer && !Number.isInteger(value)) return true;
      if (field.kind.minimum !== null && value < field.kind.minimum) return true;
      return field.kind.maximum !== null && value > field.kind.maximum;
    }
    case "boolean":
      return typeof value !== "boolean";
    case "choice": {
      const known = new Set(field.kind.options.map(([id]) => id));
      return Array.isArray(value) ? value.some((item) => !known.has(item)) : !known.has(String(value));
    }
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
          {request.fields.map((field) => {
            const id = `acp-field-${request.id}-${field.name}`;
            const invalid = checked && fieldProblem(field, values[field.name]);
            const label = field.title ?? field.name;
            const value = values[field.name];
            return (
              <div key={field.name} className="space-y-1">
                <label htmlFor={id} className="flex items-center gap-1 font-medium">
                  {label}
                  {field.required && <span className="text-muted-foreground">({t(($) => $.ai.acp.elicitation.required)})</span>}
                </label>
                {field.description && <p className="text-muted-foreground">{field.description}</p>}
                {field.kind.type === "boolean" ? (
                  <Switch id={id} checked={value === true} onCheckedChange={(next) => set(field.name, next)} />
                ) : field.kind.type === "choice" && field.kind.multiple ? (
                  <div className="flex flex-col gap-1">
                    {field.kind.options.map(([option, title], index) => {
                      const list = Array.isArray(value) ? value : [];
                      return (
                        <label key={option} htmlFor={`${id}-${index}`} className="flex items-center gap-2">
                          <Checkbox
                            id={`${id}-${index}`}
                            checked={list.includes(option)}
                            onCheckedChange={(next) =>
                              set(field.name, next === true ? [...list, option] : list.filter((item) => item !== option))
                            }
                          />
                          {title}
                        </label>
                      );
                    })}
                  </div>
                ) : field.kind.type === "choice" ? (
                  <Select value={typeof value === "string" ? value : ""} onValueChange={(next) => set(field.name, next)}>
                    <SelectTrigger id={id} aria-invalid={invalid} className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent className="z-[110]">
                      {field.kind.options.map(([option, title]) => (
                        <SelectItem key={option} value={option}>{title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.kind.type === "number" ? (
                  <Input
                    id={id}
                    type="number"
                    min={field.kind.minimum ?? undefined}
                    max={field.kind.maximum ?? undefined}
                    step={field.kind.integer ? 1 : "any"}
                    aria-invalid={invalid}
                    className="h-7 text-xs"
                    value={typeof value === "number" ? String(value) : ""}
                    onChange={(event) => set(field.name, event.target.value === "" ? undefined : Number(event.target.value))}
                  />
                ) : (
                  <Input
                    id={id}
                    type={field.secret ? "password" : field.kind.format === "email" ? "email" : "text"}
                    autoComplete="off"
                    aria-invalid={invalid}
                    className="h-7 text-xs"
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                )}
                {invalid && <p role="alert" className="text-destructive">{t(($) => $.ai.acp.elicitation.invalid)}</p>}
              </div>
            );
          })}
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
