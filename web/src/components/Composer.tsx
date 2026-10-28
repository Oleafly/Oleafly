import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type ErrorKey, failureKey } from "./errors";

export function Composer({
  label,
  placeholder,
  submitLabel,
  initial = "",
  autoFocus = false,
  compact = false,
  maxLength,
  onSubmit,
  onCancel,
}: Readonly<{
  label: string;
  placeholder?: string;
  submitLabel: string;
  initial?: string;
  autoFocus?: boolean;
  compact?: boolean;
  maxLength?: number;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}>) {
  const { t } = useTranslation(["web"]);
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  const submit = async () => {
    const message = body.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(message);
      setBody("");
    } catch (failure) {
      setError(failureKey(failure));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        ref={field}
        value={body}
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={compact ? 1 : 2}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn("resize-none text-xs", compact ? "min-h-8 py-1.5" : "min-h-14")}
      />
      {error ? (
        <p id={errorId} role="alert" className="text-[0.6875rem] text-destructive">
          {t(($) => $.web.errors[error])}
        </p>
      ) : null}
      <div className="flex justify-end gap-1.5">
        {onCancel ? (
          <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
            {t(($) => $.web.app.cancel)}
          </Button>
        ) : null}
        <Button type="button" size="xs" disabled={busy || body.trim() === ""} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
