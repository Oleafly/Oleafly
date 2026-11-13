import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ComposerCommand } from "./composer-command-registry";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import { Listbox, ListboxHeading, ListboxOption } from "@/components/ui/listbox";

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
    const { t } = useTranslation(["common", "ai"]);
    const filteredCommands = useMemo(
      () => filterSlashCommands(commands, query),
      [commands, query],
    );
    const listRef = useScrollTopOnChange(query);
    const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
    const selectedIndex = activeCommandId
      ? filteredCommands.findIndex((command) => command.id === activeCommandId)
      : 0;
    const activeIndex = Math.max(selectedIndex, 0);
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
      <Listbox
        ref={listRef}
        id="ai-slash-command-menu"
        aria-label={t(($) => $.ai.composer.slashMenuAriaLabel)}
        className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-full"
      >
        {filteredCommands.map((command, index) => {
          const group = command.group ?? "";
          const heading = group && group !== (filteredCommands[index - 1]?.group ?? "") ? group : null;
          return (
            <Fragment key={command.id}>
              {heading && <ListboxHeading separated>{heading}</ListboxHeading>}
              <ListboxOption
                id={`ai-slash-command-${command.id}`}
                selected={index === activeIndex}
                onHighlight={() => setActiveCommandId(command.id)}
                onChoose={() => select(command)}
                className="items-start gap-2.5 py-2"
              >
                <command.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium leading-snug">{command.label}</span>
                  <span className="line-clamp-2 block text-[0.6875rem] leading-snug text-muted-foreground">
                    {command.description}
                  </span>
                </span>
              </ListboxOption>
            </Fragment>
          );
        })}
      </Listbox>
    );
  },
);

SlashCommandMenu.displayName = "SlashCommandMenu";
