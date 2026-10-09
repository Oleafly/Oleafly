import type { ReactNode } from "react";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { CheckBadge } from "@/components/ui/check-badge";

export function integrationLink(href: string) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
      <span />
    </a>
  );
}

export function ConnectedBadge({ label }: Readonly<{ label: string }>) {
  return (
    <Badge variant="success" size="sm">
      {label}
    </Badge>
  );
}

export function IntegrationError({
  id,
  children,
}: Readonly<{ id?: string; children: ReactNode }>) {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive"
    >
      <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function IntegrationConnected({
  testId,
  children,
}: Readonly<{ testId?: string; children: ReactNode }>) {
  return (
    <p
      data-testid={testId}
      className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"
    >
      <CheckBadge tone="success" className="mt-px" />
      {children}
    </p>
  );
}

export function IntegrationBusyButton({
  busy,
  disabled,
  variant,
  testId,
  onClick,
  children,
}: Readonly<{
  busy: boolean;
  disabled?: boolean;
  variant?: "default" | "outline";
  testId?: string;
  onClick: () => void;
  children: ReactNode;
}>) {
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      data-testid={testId}
      disabled={busy || disabled}
      onClick={onClick}
    >
      {busy && <Spinner />}
      {children}
    </Button>
  );
}

export function IntegrationKeyField({
  type = "password",
  value,
  onChange,
  label,
  placeholder,
  busy,
  submitLabel,
  onSubmit,
  inputTestId,
  submitTestId,
}: Readonly<{
  type?: "password" | "email";
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  inputTestId?: string;
  submitTestId?: string;
}>) {
  return (
    <div className="mt-4 flex max-w-md gap-2">
      <Input
        type={type}
        data-testid={inputTestId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? label}
        aria-label={label}
        className="h-9"
      />
      <IntegrationBusyButton
        busy={busy}
        disabled={!value.trim()}
        testId={submitTestId}
        onClick={onSubmit}
      >
        {submitLabel}
      </IntegrationBusyButton>
    </div>
  );
}

export function IntegrationCard({
  testId,
  framed = false,
  icon,
  title,
  badge,
  description,
  hint,
  docs,
  actions,
  children,
}: Readonly<{
  testId?: string;
  framed?: boolean;
  icon?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  description?: ReactNode;
  hint?: ReactNode;
  docs?: { href: string; label: string };
  actions?: ReactNode;
  children?: ReactNode;
}>) {
  const Root = framed ? "section" : "div";
  const Heading = framed ? "h4" : "h3";
  return (
    <Root
      data-testid={testId}
      className={framed ? "rounded-lg border bg-background p-4" : "space-y-2"}
    >
      <div
        className={cn(
          "flex justify-between gap-3",
          framed ? "flex-wrap items-start" : "items-center",
        )}
      >
        <div className={framed ? "max-w-md" : undefined}>
          <div className="flex items-center gap-2">
            {icon}
            <Heading className="text-sm font-medium">{title}</Heading>
            {badge}
          </div>
          {description ? (
            <p
              className={cn(
                "text-xs text-muted-foreground",
                framed && "mt-2 leading-relaxed",
              )}
            >
              {description}
            </p>
          ) : null}
          {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
          {docs ? (
            <a
              href={docs.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {docs.label}
              <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : null}
        </div>
        {actions}
      </div>
      {children}
    </Root>
  );
}
