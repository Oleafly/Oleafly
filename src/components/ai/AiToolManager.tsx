import { useMemo } from "react";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import type { AvailableToolGroup } from "@/lib/ai-tool-availability";
import {
  isToolEnabled,
  useAiToolSettingsStore,
} from "@/store/ai-tool-settings";
import { AI_TOOLS } from "./AiToolsList";

const nativeDescriptions = new Map(AI_TOOLS.map((tool) => [tool.name, tool.desc]));

function toolDescription(
  group: AvailableToolGroup,
  name: string,
  description: string,
): string {
  const nativeDescription =
    group.label === "Project tools" ? nativeDescriptions.get(name) : undefined;
  return (
    (nativeDescription ?? description.split("\n", 1)[0]?.trim()) ||
    "No description provided."
  );
}

function groupHeading(group: AvailableToolGroup): string {
  return group.server ? `${group.label} ${group.server}` : group.label;
}

export function AiToolManager({
  groups,
  onOpen,
}: {
  groups: readonly AvailableToolGroup[];
  onOpen?: () => void;
}) {
  const enabledByName = useAiToolSettingsStore((state) => state.enabledByName);
  const setToolEnabled = useAiToolSettingsStore((state) => state.setToolEnabled);
  const setToolsEnabled = useAiToolSettingsStore((state) => state.setToolsEnabled);
  const toolNames = useMemo(
    () => Array.from(new Set(groups.flatMap((group) => group.tools.map((tool) => tool.name)))),
    [groups],
  );
  const enabledCount = toolNames.filter((name) =>
    isToolEnabled(enabledByName, name),
  ).length;

  return (
    <Tooltip label="Tools">
      <Popover
        align="right"
        ariaLabel="Manage agent tools"
        contentAriaLabel="Tools"
        closeOnClick={false}
        onOpenChange={(open) => {
          if (open) onOpen?.();
        }}
        className="z-[80] w-[min(28rem,calc(100vw-1.5rem))] overflow-hidden p-0"
        trigger={<Wrench aria-hidden="true" />}
      >
        <div data-testid="ai-tool-manager">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2.5">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Tools</h2>
              <p
                aria-atomic="true"
                aria-live="polite"
                className="text-[11px] text-muted-foreground"
              >
                {enabledCount} of {toolNames.length} enabled
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={toolNames.length === 0 || enabledCount === toolNames.length}
                onClick={() => setToolsEnabled(toolNames, true)}
              >
                Enable all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={toolNames.length === 0 || enabledCount === 0}
                onClick={() => setToolsEnabled(toolNames, false)}
              >
                Disable all
              </Button>
            </div>
          </div>

          <div className="max-h-[min(32rem,calc(100vh-6rem))] overflow-y-auto overscroll-contain">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                No tools are available in this context.
              </p>
            ) : (
              groups.map((group) => {
                const heading = groupHeading(group);
                return (
                  <section key={group.id} aria-label={heading} className="border-b last:border-b-0">
                    <h3
                      aria-label={heading}
                      className="flex items-baseline gap-1.5 bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      <span>{group.label}</span>
                      {group.server && (
                        <span className="normal-case tracking-normal text-foreground/70">
                          {group.server}
                        </span>
                      )}
                    </h3>
                    <div className="divide-y">
                      {group.tools.map((tool) => {
                        const enabled = isToolEnabled(enabledByName, tool.name);
                        return (
                          <div
                            key={tool.name}
                            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
                          >
                            <div className="min-w-0">
                              <code
                                title={tool.name}
                                className="block break-all font-mono text-[11px] font-medium text-foreground"
                              >
                                {tool.name}
                              </code>
                              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                                {toolDescription(group, tool.name, tool.description)}
                              </p>
                            </div>
                            <Switch
                              aria-label={`Enable ${tool.name}`}
                              checked={enabled}
                              onCheckedChange={(checked) =>
                                setToolEnabled(tool.name, checked)
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </Popover>
    </Tooltip>
  );
}
