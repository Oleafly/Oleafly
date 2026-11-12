import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { lazy } from "@/lib/preloadable";
import { useTranslation } from "react-i18next";
import { useBookColorLabels } from "@/components/library/Book";
import { Button } from "@/components/ui/button";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { Input } from "@/components/ui/input";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NOTE_COLORS } from "./note-file";
import { LINE_ICON_PREFIX, LINE_ICONS, NOTE_COLOR_HEX, NOTE_COLOR_LABELS, noteColorStyle } from "./note-icons";
import type { NoteColor } from "./types";

const EmojiGrid = lazy(() => import("./EmojiGrid"), { warm: true });

const CELL =
  "flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent";
const SELECTED = "note-chip hover:text-current";
const DEFAULT_LINE_ICON = `${LINE_ICON_PREFIX}notebook-pen`;

interface IconPickerProps {
  trigger: ReactNode;
  triggerClassName?: string;
  value?: string;
  hasIcon: boolean;
  onChange: (icon: string | undefined) => void;
  color?: NoteColor;
  onColorChange?: (color: NoteColor) => void;
}

function revealSelected(element: HTMLButtonElement | null) {
  element?.scrollIntoView({ block: "nearest" });
}

const LINE_COLUMNS = 8;

function gridStep(key: string, index: number, count: number, columns: number = LINE_COLUMNS): number | null {
  if (key === "ArrowRight") return Math.min(count - 1, index + 1);
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowDown") return Math.min(count - 1, index + columns);
  if (key === "ArrowUp") return Math.max(0, index - columns);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function LineIconGrid({ selected, onSelect }: Readonly<{ selected: string | undefined; onSelect: (icon: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const cells = useRef(new Map<string, HTMLButtonElement>());
  const needle = query.trim().toLocaleLowerCase();
  const icons = useMemo(
    () =>
      Object.entries(LINE_ICONS)
        .map(([id, entry]) => ({ id, ...entry, label: t(($) => $.notes.icons.names[entry.name]) }))
        .filter((entry) => !needle || entry.label.toLocaleLowerCase().includes(needle) || entry.id.includes(needle)),
    [needle, t],
  );
  const selectedId = selected?.startsWith(LINE_ICON_PREFIX) ? selected.slice(LINE_ICON_PREFIX.length) : null;
  useEffect(() => {
    if (selectedId) revealSelected(cells.current.get(selectedId) ?? null);
  }, [selectedId]);
  const stop = icons.find((icon) => icon.id === focused)?.id ?? icons.find((icon) => icon.id === selectedId)?.id ?? icons[0]?.id;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = icons.findIndex((icon) => icon.id === stop);
    const next = index < 0 ? null : gridStep(event.key, index, icons.length);
    if (next === null) return;
    event.preventDefault();
    const id = icons[next].id;
    setFocused(id);
    cells.current.get(id)?.focus();
  };
  return (
    <div className="flex h-72 flex-col gap-2">
      <Input
        autoFocus
        aria-label={t(($) => $.notes.icons.search)}
        placeholder={t(($) => $.notes.icons.search)}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-8"
      />
      {icons.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{t(($) => $.notes.icons.noIcons)}</p>
      ) : (
        <fieldset
          aria-label={t(($) => $.notes.icons.lines)}
          className="m-0 grid min-w-0 grid-cols-8 content-start gap-0.5 overflow-y-auto border-0 p-0"
        >
          {icons.map(({ id, icon: Icon, label }) => {
            const value = `${LINE_ICON_PREFIX}${id}`;
            const current = value === selected;
            return (
              <Tooltip key={id} label={label}>
                <button
                  ref={(element) => {
                    if (element) cells.current.set(id, element);
                    else cells.current.delete(id);
                  }}
                  type="button"
                  aria-label={label}
                  aria-pressed={current}
                  tabIndex={id === stop ? 0 : -1}
                  className={cn(CELL, current && SELECTED)}
                  onFocus={() => setFocused(id)}
                  onKeyDown={onKeyDown}
                  onClick={() => onSelect(value)}
                >
                  <Icon aria-hidden className="size-4" />
                </button>
              </Tooltip>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}

export function IconPicker({
  trigger,
  triggerClassName,
  value,
  hasIcon,
  onChange,
  color,
  onColorChange,
}: Readonly<IconPickerProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const colorLabels = useBookColorLabels();
  const selected = value ?? DEFAULT_LINE_ICON;
  const lineIcon = selected.startsWith(LINE_ICON_PREFIX);
  const [tab, setTab] = useState<"emoji" | "lines">(lineIcon ? "lines" : "emoji");
  const closeRef = useRef<HTMLButtonElement>(null);
  const choose = (icon: string | undefined) => {
    onChange(icon);
    closeRef.current?.click();
  };

  return (
    <Popover
      trigger={trigger}
      ariaLabel={t(($) => $.notes.icons.choose)}
      contentAriaLabel={t(($) => $.notes.icons.dialog)}
      closeOnClick={false}
      onOpenChange={(open) => {
        if (open) setTab(lineIcon ? "lines" : "emoji");
      }}
      triggerClassName={triggerClassName}
      className="w-[20rem] min-w-0 p-2"
    >
      <div style={noteColorStyle(color)}>
        <PopoverClose ref={closeRef} hidden tabIndex={-1} />
        <div className="mb-2 flex items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(value) => setTab(value === "lines" ? "lines" : "emoji")}>
            <TabsList size="sm">
              <TabsTrigger value="emoji">{t(($) => $.notes.icons.emoji)}</TabsTrigger>
              <TabsTrigger value="lines">{t(($) => $.notes.icons.lines)}</TabsTrigger>
            </TabsList>
          </Tabs>
          {hasIcon && (
            <Button variant="ghost" size="xs" onClick={() => choose(undefined)}>
              {t(($) => $.common.actions.remove)}
            </Button>
          )}
        </div>
        {onColorChange && (
          <div data-note-colors className="mb-2 flex items-center justify-between px-1">
            {NOTE_COLORS.map((option) => (
              <ColorSwatch
                key={option}
                size="sm"
                color={NOTE_COLOR_HEX[option]}
                name={colorLabels[NOTE_COLOR_LABELS[option]]}
                pressed={option === color}
                checkClassName={option === "blue" ? undefined : "text-black/70"}
                data-note-swatch={option}
                onClick={() => onColorChange(option)}
              />
            ))}
          </div>
        )}
        {tab === "emoji" ? (
          <Suspense
            fallback={
              <div className="flex h-72 items-center justify-center">
                <Spinner size="sm" />
              </div>
            }
          >
            <EmojiGrid selected={lineIcon ? undefined : selected} onSelect={choose} />
          </Suspense>
        ) : (
          <LineIconGrid selected={selected} onSelect={choose} />
        )}
      </div>
    </Popover>
  );
}
