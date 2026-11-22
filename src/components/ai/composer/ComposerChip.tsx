import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ComposerChip({
  icon,
  label,
  removeLabel,
  onRemove,
  testId,
  kind,
}: Readonly<{
  icon: ReactNode;
  label: string;
  removeLabel: string;
  onRemove?: () => void;
  testId: string;
  kind?: string;
}>) {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      data-testid={testId}
      data-context-kind={kind}
      aria-label={removeLabel}
      disabled={!onRemove}
      onClick={onRemove}
    >
      {icon} <span className="max-w-[14rem] truncate">{label}</span>
      {onRemove && <X className="size-3" />}
    </Button>
  );
}
