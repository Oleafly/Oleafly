import type { ReactNode } from "react";
import { Info } from "lucide-react";

export function SettingsNote({
  children,
  testId,
}: Readonly<{ children: ReactNode; testId?: string }>) {
  return (
    <div
      data-testid={testId}
      className="flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <Info aria-hidden className="mt-px size-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
