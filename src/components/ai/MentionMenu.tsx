import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Bot, File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DelegationTarget } from "@/lib/agent-mentions";
import { mentionInsertText, normalizeMentionPath } from "@/lib/composer-tokens";
import { cn } from "@/lib/utils";

export interface MentionEntry {
  path: string;
  isDir: boolean;
}

export interface FileMentionSelection extends MentionEntry {
  kind: "file";
  text: string;
}

export interface AgentMentionSelection {
  kind: "agent";
  target: DelegationTarget;
  text: string;
}

export type MentionSelection = FileMentionSelection | AgentMentionSelection;

type MentionItem =
  | { kind: "file"; key: string; entry: MentionEntry }
  | { kind: "agent"; key: string; target: DelegationTarget };

export function agentMentionKey(target: DelegationTarget): string {
  return `agent:${target.id}`;
}

interface MentionKeyEvent {
  key: string;
  shiftKey?: boolean;
  nativeEvent?: { isComposing?: boolean };
  preventDefault: () => void;
}

export interface MentionMenuHandle {
  handleKeyDown: (event: MentionKeyEvent) => boolean;
}

interface MentionMenuProps {
  entries: readonly MentionEntry[];
  agents?: readonly DelegationTarget[];
  onSelect: (selection: MentionSelection) => void;
  onClose: () => void;
  onActiveEntryChange?: (key: string | null) => void;
}

export const MENTION_MENU_LIMIT = 12;
export const AGENT_MENTION_LIMIT = 8;

const SKIPPED_SEGMENTS = new Set([".git", ".oleafly", "node_modules", ".DS_Store"]);

export function buildMentionEntries(
  tree: readonly { path: string; is_dir: boolean }[],
): MentionEntry[] {
  const entries: MentionEntry[] = [];
  for (const entry of tree) {
    const path = normalizeMentionPath(entry.path);
    if (!path) continue;
    if (path.split("/").some((segment) => SKIPPED_SEGMENTS.has(segment))) continue;
    entries.push({ path, isDir: entry.is_dir });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

export function mentionBasename(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? path : path.slice(index + 1);
}

function isSubsequence(haystack: string, needle: string): boolean {
  let cursor = 0;
  for (const character of needle) {
    cursor = haystack.indexOf(character, cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return true;
}

export function filterMentionEntries(
  entries: readonly MentionEntry[],
  query: string,
  limit = MENTION_MENU_LIMIT,
): MentionEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const ranked: { entry: MentionEntry; rank: number }[] = [];
  for (const entry of entries) {
    const path = entry.path.toLocaleLowerCase();
    if (needle) {
      if (!isSubsequence(path, needle)) continue;
      ranked.push({
        entry,
        rank: mentionBasename(path).startsWith(needle) ? 0 : 1,
      });
      continue;
    }
    ranked.push({ entry, rank: 0 });
  }
  ranked.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.entry.path.length !== right.entry.path.length) {
      return left.entry.path.length - right.entry.path.length;
    }
    return left.entry.path.localeCompare(right.entry.path);
  });
  return ranked.slice(0, limit).map((item) => item.entry);
}

export function filterAgentTargets(
  targets: readonly DelegationTarget[],
  query: string,
  limit = AGENT_MENTION_LIMIT,
): DelegationTarget[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? targets.filter((target) =>
        `${target.id} ${target.label} ${target.detail}`.toLocaleLowerCase().includes(needle),
      )
    : [...targets];
  return matches.slice(0, limit);
}

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(
  ({ entries, agents = [], onSelect, onClose, onActiveEntryChange }, ref) => {
    const { t } = useTranslation(["common", "ai"]);
    const items = useMemo<MentionItem[]>(
      () => [
        ...agents.map((target) => ({ kind: "agent" as const, key: agentMentionKey(target), target })),
        ...entries.map((entry) => ({ kind: "file" as const, key: entry.path, entry })),
      ],
      [agents, entries],
    );
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const selectedIndex = activeKey ? items.findIndex((item) => item.key === activeKey) : 0;
    const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const activeItem = items[activeIndex] ?? null;
    const activeItemKey = activeItem?.key ?? null;

    useEffect(() => {
      onActiveEntryChange?.(activeItemKey);
    }, [activeItemKey, onActiveEntryChange]);

    const select = useCallback(
      (item: MentionItem) => {
        if (item.kind === "agent") {
          onSelect({ kind: "agent", target: item.target, text: `@${item.target.id} ` });
          return;
        }
        onSelect({
          kind: "file",
          ...item.entry,
          text: mentionInsertText(item.entry.path, item.entry.isDir),
        });
      },
      [onSelect],
    );

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (event) => {
          if (items.length === 0) return false;
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
            const direction = event.key === "ArrowDown" ? 1 : -1;
            const nextIndex = (activeIndex + direction + items.length) % items.length;
            setActiveKey(items[nextIndex]?.key ?? null);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            if (!activeItem) return false;
            event.preventDefault();
            select(activeItem);
            return true;
          }
          return false;
        },
      }),
      [activeItem, activeIndex, items, onClose, select],
    );

    if (items.length === 0) return null;

    const optionClass = (selected: boolean) =>
      cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors",
        selected && "bg-accent text-accent-foreground",
      );
    const showHeadings = agents.length > 0 && entries.length > 0;

    return (
      <div
        id="ai-mention-menu"
        role="listbox"
        aria-label={
          agents.length > 0
            ? t(($) => $.ai.composer.mentionMenuAgentsAndFiles)
            : t(($) => $.ai.composer.mentionMenuFiles)
        }
        className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
      >
        {items.map((item, index) => {
          const selected = index === activeIndex;
          if (item.kind === "agent") {
            const { target } = item;
            return (
              <div key={item.key}>
                {showHeadings && index === 0 && (
                  <p className="px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(($) => $.ai.composer.mentionHeadingAgents)}
                  </p>
                )}
                <button
                  id={`ai-mention-${item.key}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveKey(item.key)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => select(item)}
                  className={optionClass(selected)}
                >
                  <Bot className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-xs leading-snug">
                    <span className="font-medium">{target.label}</span>
                    <span className="text-muted-foreground"> · {target.detail}</span>
                  </span>
                </button>
              </div>
            );
          }
          const { entry } = item;
          const basename = mentionBasename(entry.path);
          const directory = entry.path.slice(0, entry.path.length - basename.length);
          const Icon = entry.isDir ? Folder : File;
          return (
            <div key={item.key}>
              {showHeadings && index === agents.length && (
                <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t(($) => $.ai.composer.mentionHeadingFiles)}
                </p>
              )}
              <button
                id={`ai-mention-${entry.path}`}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onMouseEnter={() => setActiveKey(item.key)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(item)}
                className={optionClass(selected)}
              >
                <Icon className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-xs leading-snug">
                  {directory && (
                    <span className="text-muted-foreground">{directory}</span>
                  )}
                  <span className="font-medium">{basename}</span>
                  {entry.isDir && <span className="text-muted-foreground">/</span>}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    );
  },
);

MentionMenu.displayName = "MentionMenu";
