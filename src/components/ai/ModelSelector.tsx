import { useMemo, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { CheckCircle2, ChevronDown, Search } from "lucide-react";

import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { Tooltip } from "@/components/ui/tooltip";
import { useOccludeNativeWebview } from "@/lib/native-webview-occlusion";
import { cn } from "@/lib/utils";

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
  const [open, setOpen] = useState(false);
  useOccludeNativeWebview(open);
  const [query, setQuery] = useState("");

  const selectedModel = useMemo(
    () =>
      groups
        .find((group) => group.id === providerId)
        ?.models.find((model) => model.id === modelId),
    [groups, modelId, providerId],
  );

  const visibleGroups = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return groups;

    return groups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) =>
          `${group.name} ${model.name} ${model.id}`
            .toLocaleLowerCase()
            .includes(search),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [groups, query]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <Tooltip label="Switch provider or model" className="min-w-0">
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label="AI model"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "ai-model-selector-trigger flex h-9 w-full cursor-pointer items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              compact
                ? "h-6 max-w-44 border-0 bg-transparent px-1.5 py-0 text-[10px] leading-none text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
                : "w-48",
              open && "bg-accent text-foreground",
              className,
            )}
          >
            <span className="flex h-full min-w-0 items-center gap-1.5 leading-none">
              {providerId && (
                <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:block">
                  <ProviderLogo providerId={providerId} size={compact ? 14 : 16} />
                </span>
              )}
              <span className="ai-model-selector-value truncate leading-none">
                {selectedModel?.name || modelId || "Select a model"}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 self-center opacity-50" />
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={compact ? "end" : "start"}
          sideOffset={4}
          collisionPadding={12}
          className={cn(
            "z-50 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            contentClassName,
          )}
        >
          <Command
            label="Search models"
            shouldFilter={false}
            className="bg-transparent"
          >
            <div className="flex h-10 items-center gap-2 border-b px-3">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                autoFocus
                placeholder="Search models…"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
            </div>

            <Command.List className="max-h-[min(50vh,20rem)] overflow-y-auto p-1.5">
              {visibleGroups.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="text-xs font-medium">No models found</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Try a different search.
                  </p>
                </div>
              )}

              {visibleGroups.map((group) => (
                <Command.Group
                  key={group.id}
                  heading={group.name}
                  className="px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {group.models.map((model) => {
                    const selected =
                      group.id === providerId && model.id === modelId;
                    return (
                      <Command.Item
                        key={`${group.id}:${model.id}`}
                        value={JSON.stringify([group.id, model.id])}
                        onSelect={() => {
                          onChange(group.id, model.id);
                          close();
                        }}
                        className="relative flex w-full items-center gap-2 rounded-sm px-2 py-2 pr-8 text-xs font-normal normal-case tracking-normal text-foreground outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                      >
                        <ProviderLogo providerId={group.id} size={14} />
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        {selected && (
                          <CheckCircle2 className="absolute right-2 size-4 text-emerald-500" />
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
