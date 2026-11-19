import { Quote, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ComposerContextItem } from "@/lib/composer-context";

export function ComposerContextChips({
  items,
  onRemove,
}: Readonly<{
  items: readonly ComposerContextItem[];
  onRemove?: (id: string) => void;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  if (items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Button
          key={item.id}
          type="button"
          variant="outline"
          size="xs"
          data-testid="composer-context-chip"
          data-context-kind={item.kind}
          aria-label={t(($) => $.ai.composer.removeContext, { label: item.label })}
          disabled={!onRemove}
          onClick={() => onRemove?.(item.id)}
        >
          <Quote className="size-3" /> <span className="max-w-[14rem] truncate">{item.label}</span>
          {onRemove && <X className="size-3" />}
        </Button>
      ))}
    </div>
  );
}
