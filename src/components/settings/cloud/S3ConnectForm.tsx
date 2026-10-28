import { CloudProviderLogo } from "@/components/settings/cloud/CloudProviderLogo";
import { IntegrationError } from "@/components/settings/IntegrationCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { useCloudStore } from "@/store/cloud";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";

const ENDPOINT_PLACEHOLDER = "https://s3.us-east-1.amazonaws.com";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

function Field({
  id,
  label,
  note,
  className,
  children,
}: Readonly<{ id: string; label: string; note?: string; className?: string; children: ReactNode }>) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-xs font-medium text-foreground">
        {label}
        {note ? <span className="font-normal text-muted-foreground">{note}</span> : null}
      </label>
      {children}
    </div>
  );
}

/** The keys and bucket for S3-compatible storage. Connect stays off until the
 * required fields are filled in and the endpoint is an http(s) URL. */
export function S3ConnectForm({ onCancel }: Readonly<{ onCancel: () => void }>) {
  const { t } = useTranslation(["common", "cloud"]);
  const id = useId();
  const busy = useCloudStore((s) => s.connectBusy && s.connectProvider === "s3");
  const error = useCloudStore((s) => (s.connectProvider === "s3" ? s.connectError : null));
  const connectWithCredentials = useCloudStore((s) => s.connectWithCredentials);
  const [endpoint, setEndpoint] = useState("");
  const [endpointLeft, setEndpointLeft] = useState(false);
  const [region, setRegion] = useState("us-east-1");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("oleafly");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [pathStyle, setPathStyle] = useState(true);

  const endpointValid = isHttpUrl(endpoint.trim());
  const endpointWrong = endpointLeft && endpoint.trim() !== "" && !endpointValid;
  const ready =
    endpointValid &&
    [region, bucket, accessKeyId, secretAccessKey].every((value) => value.trim() !== "");

  const submit = () => {
    if (!ready || busy) return;
    void connectWithCredentials(
      "s3",
      {
        endpoint: endpoint.trim(),
        region: region.trim(),
        bucket: bucket.trim(),
        prefix: prefix.trim(),
        pathStyle,
      },
      accessKeyId.trim(),
      secretAccessKey.trim(),
    );
  };

  return (
    <form
      data-testid="cloud-s3-form"
      aria-labelledby={`${id}-title`}
      noValidate
      className="space-y-4 rounded-lg border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex items-start gap-3">
        <CloudProviderLogo kind="s3" size="sm" />
        <div className="min-w-0">
          <h4 id={`${id}-title`} className="text-sm font-semibold text-foreground">
            {t(($) => $.cloud.s3.title)}
          </h4>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(($) => $.cloud.s3.hint)}</p>
        </div>
      </div>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
        <Field id={`${id}-endpoint`} label={t(($) => $.cloud.s3.endpoint)} className="sm:col-span-2">
          <Input
            id={`${id}-endpoint`}
            type="url"
            value={endpoint}
            placeholder={ENDPOINT_PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={endpointWrong || undefined}
            aria-describedby={endpointWrong ? `${id}-endpoint-error` : undefined}
            onChange={(event) => setEndpoint(event.target.value)}
            onBlur={() => setEndpointLeft(true)}
            className={cn("h-8", endpointWrong && "border-destructive focus-visible:border-destructive")}
          />
          {endpointWrong ? (
            <p id={`${id}-endpoint-error`} className="text-xs text-destructive">
              {t(($) => $.cloud.s3.endpointInvalid)}
            </p>
          ) : null}
        </Field>
        <Field id={`${id}-region`} label={t(($) => $.cloud.s3.region)}>
          <Input
            id={`${id}-region`}
            value={region}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setRegion(event.target.value)}
            className="h-8"
          />
        </Field>
        <Field id={`${id}-bucket`} label={t(($) => $.cloud.s3.bucket)}>
          <Input
            id={`${id}-bucket`}
            value={bucket}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setBucket(event.target.value)}
            className="h-8"
          />
        </Field>
        <Field
          id={`${id}-prefix`}
          label={t(($) => $.cloud.s3.prefix)}
          note={t(($) => $.cloud.s3.optional)}
          className="sm:col-span-2"
        >
          <Input
            id={`${id}-prefix`}
            value={prefix}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setPrefix(event.target.value)}
            className="h-8"
          />
        </Field>
        <Field id={`${id}-key`} label={t(($) => $.cloud.s3.accessKeyId)}>
          <Input
            id={`${id}-key`}
            value={accessKeyId}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setAccessKeyId(event.target.value)}
            className="h-8"
          />
        </Field>
        <Field id={`${id}-secret`} label={t(($) => $.cloud.s3.secretAccessKey)}>
          <Input
            id={`${id}-secret`}
            type="password"
            value={secretAccessKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setSecretAccessKey(event.target.value)}
            className="h-8"
          />
        </Field>
        <div className="flex items-start gap-2 sm:col-span-2">
          <Checkbox
            id={`${id}-path-style`}
            checked={pathStyle}
            aria-describedby={`${id}-path-style-hint`}
            onCheckedChange={(checked) => setPathStyle(checked === true)}
            className="mt-0.5"
          />
          <div className="min-w-0 text-xs leading-relaxed">
            <label htmlFor={`${id}-path-style`} className="block font-medium text-foreground">
              {t(($) => $.cloud.s3.pathStyle)}
            </label>
            <p id={`${id}-path-style-hint`} className="text-muted-foreground">
              {t(($) => $.cloud.s3.pathStyleHint)}
            </p>
          </div>
        </div>
      </fieldset>
      {error ? <IntegrationError>{describeError(error)}</IntegrationError> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!ready || busy} data-testid="cloud-s3-connect">
          {busy ? <Spinner /> : null}
          {t(($) => $.cloud.connect)}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          {t(($) => $.common.actions.cancel)}
        </Button>
      </div>
    </form>
  );
}
