import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function OfferCardAction({
  tone = "secondary",
  busy = false,
  className,
  children,
  ...props
}: Readonly<ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary"; busy?: boolean }>) {
  return (
    <Button
      type="button"
      size="sm"
      variant={tone === "primary" ? "default" : "outline"}
      className={cn("h-7 gap-1.5 px-2.5 text-xs", className)}
      {...props}
    >
      {busy ? <Spinner size="sm" /> : null}
      {children}
    </Button>
  );
}

export function OfferCard({
  icon: Icon,
  titleId,
  title,
  message,
  failed = false,
  busy = false,
  onClose,
  testId,
  children,
}: Readonly<{
  icon: LucideIcon;
  titleId: string;
  title: ReactNode;
  message: ReactNode;
  failed?: boolean;
  busy?: boolean;
  onClose: () => void;
  testId?: string;
  children?: ReactNode;
}>) {
  const { t } = useTranslation(["common"]);
  return (
    <section
      aria-labelledby={titleId}
      data-testid={testId}
      className="fixed bottom-4 right-4 z-[70] flex w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <h2 id={titleId} className="text-sm font-medium">
            {title}
          </h2>
          <output
            role={failed ? "alert" : undefined}
            aria-live={failed ? undefined : "polite"}
            className="block text-xs leading-relaxed text-muted-foreground"
          >
            {message}
          </output>
        </div>
        {children}
      </div>
      <button
        type="button"
        aria-label={t(($) => $.common.actions.close)}
        disabled={busy}
        onClick={onClose}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:opacity-50"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </section>
  );
}
