import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { File, Folder } from "lucide-react";
import { mentionInsertText, normalizeMentionPath } from "@/lib/composer-tokens";
import { cn } from "@/lib/utils";

export interface MentionEntry {
  path: string;
  isDir: boolean;
}

export interface MentionSelection extends MentionEntry {
  text: string;
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
  onSelect: (selection: MentionSelection) => void;
  onClose: () => void;
  onActiveEntryChange?: (path: string | null) => void;
}

export const MENTION_MENU_LIMIT = 12;

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

export const MentionMenu = forwardRef<MentionMenuHandle, MentionMenuProps>(
  ({ entries, onSelect, onClose, onActiveEntryChange }, ref) => {
    const [activePath, setActivePath] = useState<string | null>(null);
    const selectedIndex = activePath
      ? entries.findIndex((entry) => entry.path === activePath)
      : 0;
    const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const activeEntry = entries[activeIndex] ?? null;

    useEffect(() => {
      onActiveEntryChange?.(activeEntry?.path ?? null);
    }, [activeEntry?.path, onActiveEntryChange]);

    const select = useCallback(
      (entry: MentionEntry) => {
        onSelect({ ...entry, text: mentionInsertText(entry.path, entry.isDir) });
      },
      [onSelect],
    );

    useImperativeHandle(
      ref,
      () => ({
        handleKeyDown: (event) => {
          if (entries.length === 0) return false;
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
            const nextIndex = (activeIndex + direction + entries.length) % entries.length;
            setActivePath(entries[nextIndex]?.path ?? null);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            if (!activeEntry) return false;
            event.preventDefault();
            select(activeEntry);
            return true;
          }
          return false;
        },
      }),
      [activeEntry, activeIndex, entries, onClose, select],
    );

    if (entries.length === 0) return null;

    return (
      <div
        id="ai-mention-menu"
        role="listbox"
        aria-label="Project files"
        className="absolute bottom-full left-0 z-50 mb-2 max-h-72 w-full overflow-y-auto rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
      >
        {entries.map((entry, index) => {
          const selected = index === activeIndex;
          const basename = mentionBasename(entry.path);
          const directory = entry.path.slice(0, entry.path.length - basename.length);
          const Icon = entry.isDir ? Folder : File;
          return (
            <button
              id={`ai-mention-${entry.path}`}
              key={entry.path}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onMouseEnter={() => setActivePath(entry.path)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(entry)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors",
                selected && "bg-accent text-accent-foreground",
              )}
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
          );
        })}
      </div>
    );
  },
);

MentionMenu.displayName = "MentionMenu";
