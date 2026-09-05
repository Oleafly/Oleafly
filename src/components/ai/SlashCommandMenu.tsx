import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import type { ComposerCommand } from "./composer-command-registry";
import { cn } from "@/lib/utils";

interface SlashCommandKeyEvent {
  key: string;
  shiftKey?: boolean;
  nativeEvent?: { isComposing?: boolean };
  preventDefault: () => void;
}

export interface SlashCommandMenuHandle {
  handleKeyDown: (event: SlashCommandKeyEvent) => boolean;
}

interface SlashCommandMenuProps {
  commands: ComposerCommand[];
  query: string;
  onSelect: (command: ComposerCommand) => void;
  onClose: () => void;
  onActiveCommandChange?: (commandId: string | null) => void;
}

export function isSlashCommandInput(value: string): boolean {
  return value.startsWith("/") && !value.includes("\n");
}

export function slashCommandQuery(value: string): string {
  return isSlashCommandInput(value) ? value.slice(1).trim() : "";
}

export function filterSlashCommands(
  commands: readonly ComposerCommand[],
  query: string,
): ComposerCommand[] {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...commands];
  return commands.filter((command) => {
    const searchable =
      `${command.label} ${command.description} ${command.keywords ?? ""}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export const SlashCommandMenu = forwardRef<SlashCommandMenuHandle, SlashCommandMenuProps>(
  ({ commands, query, onSelect, onClose, onActiveCommandChange }, ref) => {
    const filteredCommands = useMemo(
      () => filterSlashCommands(commands, query),
      [commands, query],
    );
    const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
    const selectedIndex = activeCommandId
      ? filteredCommands.findIndex((command) => command.id === activeCommandId)
      : 0;
    const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const activeCommand = filteredCommands[activeIndex] ?? null;

    useEffect(() => {
      onActiveCommandChange?.(activeCommand?.id ?? null);
    }, [activeCommand?.id, onActiveCommandChange]);

    const select = useCallback(
      (command: ComposerCommand) => {
        command.action();
        onSelect(command);
      },
      [onSelect],
    );

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (event) => {
          if (filteredCommands.length === 0) return false;
          if (
            event.nativeEvent?.isComposing ||
            (event.key === "Enter" && event.shiftKey)
          ) {
            return false;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return true;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (filteredCommands.length > 0) {
              const direction = event.key === "ArrowDown" ? 1 : -1;
              const nextIndex =
                (activeIndex + direction + filteredCommands.length) % filteredCommands.length;
              setActiveCommandId(filteredCommands[nextIndex]?.id ?? null);
            }
            return true;
          }
          if (event.key === "Enter") {
            if (!activeCommand) return false;
            event.preventDefault();
            select(activeCommand);
            return true;
          }
          return false;
        },
      }),
      [activeCommand, activeIndex, filteredCommands, onClose, select],
    );

    if (filteredCommands.length === 0) return null;

    return (
      <div
        id="ai-slash-command-menu"
        role="listbox"
        aria-label="Slash commands"
        className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
      >
        {filteredCommands.map((command, index) => {
            const selected = index === activeIndex;
            const group = command.group ?? "";
            const heading =
              group && group !== (filteredCommands[index - 1]?.group ?? "") ? group : null;
            return (
              <Fragment key={command.id}>
                {heading && (
                  <span className="mt-1 block border-t px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {heading}
                  </span>
                )}
                <button
                  id={`ai-slash-command-${command.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveCommandId(command.id)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(command)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
                    selected && "bg-accent text-accent-foreground",
                  )}
                >
                  <command.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium leading-snug">{command.label}</span>
                    <span className="line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                      {command.description}
                    </span>
                  </span>
                </button>
              </Fragment>
            );
        })}
      </div>
    );
  },
);

SlashCommandMenu.displayName = "SlashCommandMenu";
