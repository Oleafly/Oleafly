import type { ComponentType, ReactNode } from "react";

/** A card in Settings, Research: an icon, a title and an optional line under it, then the card's rows. */
export function ResearchCard({
  id,
  icon: Icon,
  title,
  description,
  testId,
  children,
}: Readonly<{
  /** The id of the title, which names the card for screen readers. */
  id: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  testId?: string;
  children: ReactNode;
}>) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-xl border bg-card/60" data-testid={testId}>
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="font-medium">
            {title}
          </h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <div className="space-y-3 px-4 py-4">{children}</div>
    </section>
  );
}
