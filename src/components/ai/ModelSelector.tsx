import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { Tooltip } from "@/components/ui/tooltip";

export type ModelSelectorGroup = {
  id: string;
  name: string;
  models: { id: string; name: string }[];
};

export function ModelSelector({
  providerId,
  modelId,
  groups,
  onChange,
  disabled,
  compact,
  className,
  contentClassName,
}: {
  providerId: string;
  modelId: string;
  groups: ModelSelectorGroup[];
  onChange: (providerId: string, modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const value = JSON.stringify([providerId, modelId]);
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const [nextProvider, nextModel] = JSON.parse(next) as [string, string];
        onChange(nextProvider, nextModel);
      }}
    >
      <Tooltip label="Switch provider or model" className="min-w-0">
        <SelectTrigger
          aria-label="AI model"
          className={cn(
            "ai-model-selector-trigger",
            compact
              ? "h-6 max-w-44 border-0 bg-transparent px-1.5 text-[10px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
              : "w-48",
            className,
          )}
        >
          <span className="!flex min-w-0 items-center gap-1.5">
            {providerId && <ProviderLogo providerId={providerId} size={compact ? 12 : 14} />}
            <span className="ai-model-selector-value truncate">
              <SelectValue />
            </span>
          </span>
        </SelectTrigger>
      </Tooltip>
      <SelectContent className={cn("max-h-[60vh] min-w-56", contentClassName)}>
        {groups.map((group) => (
          <SelectGroup key={group.id}>
            <SelectLabel className="text-[10px] uppercase tracking-wide">{group.name}</SelectLabel>
            {group.models.map((model) => (
              <SelectItem
                key={model.id}
                value={JSON.stringify([group.id, model.id])}
                icon={<ProviderLogo providerId={group.id} size={14} />}
                indicator="right-circle"
              >
                {model.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
