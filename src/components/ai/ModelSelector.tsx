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
  // Callers rendering inside a higher-stacked surface (e.g. the Settings
  // modal at z-[80]) pass a z bump here or the dropdown opens behind it.
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
      <SelectTrigger
        aria-label="AI model"
        title="Switch provider or model"
        className={cn(
          compact
            ? "h-6 max-w-44 border-0 bg-transparent px-1.5 text-[10px] text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
            : "w-48",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={cn("max-h-[60vh] min-w-56", contentClassName)}>
        {groups.map((group) => (
          <SelectGroup key={group.id}>
            <SelectLabel className="text-[10px] uppercase tracking-wide">{group.name}</SelectLabel>
            {group.models.map((model) => (
              <SelectItem
                key={model.id}
                value={JSON.stringify([group.id, model.id])}
                icon={<ProviderLogo providerId={group.id} size={14} />}
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
