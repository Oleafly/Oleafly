import { Quote } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComposerContextItem } from "@/lib/composer-context";
import { ComposerChip } from "./ComposerChip";

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
        <ComposerChip
          key={item.id}
          icon={<Quote className="size-3" />}
          label={item.label}
          removeLabel={t(($) => $.ai.composer.removeContext, { label: item.label })}
          onRemove={onRemove ? () => onRemove(item.id) : undefined}
          testId="composer-context-chip"
          kind={item.kind}
        />
      ))}
    </div>
  );
}
