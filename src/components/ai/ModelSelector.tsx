import { useMemo, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { CheckCircle2, ChevronDown, Search } from "lucide-react";

import { ProviderLogo } from "@/components/ai/ProviderLogo";
import { Tooltip } from "@/components/ui/tooltip";
import { modelCapabilityChips } from "@/lib/ai-model-state";
import type { ModelMetadata, ModelTrust } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export type ModelSelectorModel = {
  id: string;
  name: string;
  trust?: ModelTrust;
  blockedReason?: string;
  metadata?: ModelMetadata;
};

export type ModelSelectorGroup = {
  id: string;
  name: string;
  models: ModelSelectorModel[];
};

const TRUST_LABEL: Record<ModelTrust, string> = {
  verified: "Verified",
  untested: "Untested",
  blocked: "Blocked",
};

const TRUST_CLASS: Record<ModelTrust, string> = {
  verified:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  untested: "border-border bg-muted text-muted-foreground",
  blocked: "border-destructive/30 bg-destructive/10 text-destructive",
};

const TRUST_TITLE: Record<ModelTrust, string> = {
  verified: "Oleafly has run the assistant on this model",
  untested: "Not tried with the assistant yet. It is checked on first use",
  blocked: "The assistant cannot run on this model",
};

export function ModelTrustBadge({
  trust,
  reason,
  className,
}: {
  trust: ModelTrust | undefined;
  reason?: string;
  className?: string;
}) {
  if (!trust) return null;
  const badge = (
    <span
      data-testid={`ai-model-trust-${trust}`}
      data-trust={trust}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium leading-none",
        TRUST_CLASS[trust],
        className,
      )}
    >
      {TRUST_LABEL[trust]}
      {trust === "blocked" && reason ? <span className="sr-only">. {reason}</span> : null}
    </span>
  );
  const label = trust === "blocked" && reason ? reason : TRUST_TITLE[trust];
  return (
    <Tooltip label={label} side="top" className="inline-flex shrink-0">
      {badge}
    </Tooltip>
  );
}

export function ModelCapabilityChips({
  metadata,
  className,
}: {
  metadata: ModelMetadata | undefined;
  className?: string;
}) {
  const chips = modelCapabilityChips(metadata);
  if (chips.length === 0) return null;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1", className)}>
      {chips.map((chip) => (
        <span
          key={chip.id}
          data-testid={`ai-model-chip-${chip.id}`}
          title={chip.title}
          className={cn(
            "inline-flex shrink-0 items-center rounded px-1 py-px text-[10px] leading-none",
            chip.id === "deprecated"
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          <span aria-hidden="true">{chip.label}</span>
          <span className="sr-only">{chip.title}</span>
        </span>
      ))}
    </span>
  );
}

export function ModelSelector({
  providerId,
  modelId,
  groups,
  onChange,
  disabled,
  compact,
  className,
  contentClassName,
  open: controlledOpen,
  onOpenChange,
}: {
  providerId: string;
  modelId: string;
  groups: ModelSelectorGroup[];
  onChange: (providerId: string, modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [query, setQuery] = useState("");

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

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
      <Tooltip
        label={`${selectedModel?.name || modelId || "Select a model"}. Switch provider or model`}
        className="min-w-0"
      >
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
            <ChevronDown className="ai-model-selector-chevron size-4 shrink-0 self-center opacity-50" />
          </button>
        </PopoverPrimitive.Trigger>
      </Tooltip>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={compact ? "end" : "start"}
          sideOffset={4}
          collisionPadding={12}
          className={cn(
            "z-[80] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
                    const blocked = model.trust === "blocked";
                    const details = Boolean(model.trust) || modelCapabilityChips(model.metadata).length > 0;
                    return (
                      <Command.Item
                        key={`${group.id}:${model.id}`}
                        value={JSON.stringify([group.id, model.id])}
                        disabled={blocked}
                        data-testid={`ai-model-option-${group.id}-${model.id}`}
                        onSelect={() => {
                          if (blocked) return;
                          onChange(group.id, model.id);
                          close();
                        }}
                        className={cn(
                          "relative flex w-full items-start gap-2 rounded-sm px-2 py-2 pr-8 text-xs font-normal normal-case tracking-normal text-foreground outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
                          blocked && "cursor-not-allowed opacity-60",
                        )}
                      >
                        <span className="mt-px shrink-0">
                          <ProviderLogo providerId={group.id} size={14} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="min-w-0 truncate">{model.name}</span>
                          {details && (
                            <span className="flex min-w-0 flex-wrap items-center gap-1">
                              <ModelTrustBadge trust={model.trust} reason={model.blockedReason} />
                              <ModelCapabilityChips metadata={model.metadata} />
                            </span>
                          )}
                        </span>
                        {selected && (
                          <CheckCircle2 className="absolute right-2 top-2 size-4 text-emerald-500" />
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
