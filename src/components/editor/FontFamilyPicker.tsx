import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { fontFamilyName, matchingFamilies, sourceKinds } from "@/lib/font-families";
import type { TypstFontEntry, TypstFontSourceKind } from "@/lib/typst-options";
import { cn } from "@/lib/utils";

const PICKER_FONT: CSSProperties = { fontFamily: "var(--font-sans-default)" };

export type FontFamilies =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly families: readonly TypstFontEntry[] };

interface FontChoice {
  name: string;
  kinds: TypstFontSourceKind[];
}

export interface FontFamilyBadge {
  readonly id: string;
  readonly label: string;
  readonly emphasis?: boolean;
}

export interface FontFamilyOption {
  readonly value: string;
  readonly label?: string;
  readonly preview?: string;
  readonly badges?: readonly FontFamilyBadge[];
}

export function fontChoices(
  families: readonly TypstFontEntry[],
  allowed: readonly TypstFontSourceKind[],
  query: string,
): FontChoice[] {
  const choices: FontChoice[] = [];
  for (const family of matchingFamilies(families, query)) {
    const kinds = sourceKinds(family).filter((kind) => allowed.includes(kind));
    if (kinds.length > 0) choices.push({ name: family.name, kinds });
  }
  return choices;
}

function sameFamily(left: string, right: string): boolean {
  return fontFamilyName(left).toLocaleLowerCase() === fontFamilyName(right).toLocaleLowerCase();
}

function FontOptionRow({
  option,
  id,
  active,
  checked,
  onHover,
  onChoose,
}: Readonly<{
  option: FontFamilyOption;
  id: string;
  active: boolean;
  checked: boolean;
  onHover: () => void;
  onChoose: () => void;
}>) {
  const text = option.label ?? option.value;
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      data-value={option.value}
      data-checked={checked || undefined}
      {...{ [ROW_WINDOW_ITEM]: "" }}
      tabIndex={-1}
      className={cn(
        "relative flex h-7 w-full cursor-default items-center gap-2 rounded-sm pl-2 pr-8 text-left text-sm",
        active && "bg-accent text-accent-foreground",
      )}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onChoose}
    >
      <span
        className="min-w-0 flex-1 truncate"
        title={text}
        style={option.preview ? { fontFamily: option.preview } : undefined}
      >
        {text}
      </span>
      {option.badges?.map((badge) => (
        <Badge key={badge.id} variant={badge.emphasis ? "primaryGhost" : "muted"} size="sm">
          {badge.label}
        </Badge>
      ))}
      {checked ? (
        <CheckCircle2 aria-hidden className="absolute right-2 size-4 text-emerald-500" />
      ) : null}
    </button>
  );
}

export function FontFamilyCombobox({
  id,
  label,
  value,
  placeholder,
  invalid,
  disabled,
  loading,
  listLabel,
  loadingLabel,
  optionsFor,
  onLoad,
  onChange,
  onInput,
  onFocus,
  onBlur,
  className,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  loading: boolean;
  listLabel: string;
  loadingLabel: string;
  optionsFor: (query: string) => readonly FontFamilyOption[];
  onLoad: () => void;
  onChange: (value: string) => void;
  onInput?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
}>) {
  const listId = useId();
  const anchor = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const selectOnMouseUp = useRef(false);
  const [listMounted, setListMounted] = useState(false);
  const attachScroller = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    setListMounted(node !== null);
  }, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const options = useMemo(() => (loading ? [] : optionsFor(query)), [loading, optionsFor, query]);
  const showList = open && !disabled && (loading || options.length > 0);
  const rows = useRowWindow({ count: showList ? options.length : 0, scrollRef: scroller, listRef: list });
  const measured = rows.rowHeight > 0;

  useLayoutEffect(() => {
    if (showList && listMounted && measured) rows.scrollToIndex(active);
  }, [showList, listMounted, measured, active, rows.scrollToIndex]);

  const openList = () => {
    onLoad();
    if (!open) setActive(Math.max(0, options.findIndex((option) => sameFamily(option.value, value))));
    setOpen(true);
  };

  const choose = (next: string) => {
    onChange(next);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      else setActive((index) => Math.min(index + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && showList && options[active]) {
      event.preventDefault();
      choose(options[active].value);
    } else if (event.key === "Escape" && showList) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <PopoverPrimitive.Root open={showList} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <Input
          ref={anchor}
          id={id}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={showList && options[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          data-modal-escape-inner={showList ? "" : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          style={PICKER_FONT}
          className={cn("h-8 text-sm", invalid && "border-destructive", className)}
          onFocus={(event) => {
            event.currentTarget.select();
            selectOnMouseUp.current = true;
            onFocus?.();
            openList();
          }}
          onMouseUp={(event) => {
            if (!selectOnMouseUp.current) return;
            selectOnMouseUp.current = false;
            event.preventDefault();
          }}
          onClick={openList}
          onKeyDown={onKeyDown}
          onBlur={() => {
            selectOnMouseUp.current = false;
            onBlur?.();
          }}
          onChange={(event) => {
            (onInput ?? onChange)(event.target.value);
            setQuery(event.target.value);
            setActive(0);
            openList();
          }}
        />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchor.current?.contains(event.target)) event.preventDefault();
          }}
          style={PICKER_FONT}
          className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-56 rounded-md border bg-card p-1 text-card-foreground shadow-xl"
        >
          <div ref={attachScroller} id={listId} role="listbox" aria-label={listLabel} className="max-h-60 overflow-y-auto">
            {loading ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{loadingLabel}</p>
            ) : (
              <div ref={list} style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}>
                {options.slice(rows.start, rows.end).map((option, offset) => {
                  const index = rows.start + offset;
                  return (
                    <FontOptionRow
                      key={option.value}
                      option={option}
                      id={`${listId}-${index}`}
                      active={index === active}
                      checked={sameFamily(option.value, value)}
                      onHover={() => setActive(index)}
                      onChoose={() => choose(option.value)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export function FontFamilyPicker({
  id,
  label,
  value,
  placeholder,
  invalid,
  fonts,
  sources,
  onLoad,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  invalid?: boolean;
  fonts: FontFamilies;
  sources: readonly TypstFontSourceKind[];
  onLoad: () => void;
  onChange: (value: string) => void;
}>) {
  const { t } = useTranslation(["editor"]);
  const optionsFor = useCallback(
    (query: string): FontFamilyOption[] =>
      fonts.status === "ready"
        ? fontChoices(fonts.families, sources, query).map((choice) => ({
            value: choice.name,
            badges: choice.kinds.map((kind) => ({
              id: kind,
              label: t(($) => $.editor.typstFonts.sources[kind]),
              emphasis: kind === "project",
            })),
          }))
        : [],
    [fonts, sources, t],
  );

  return (
    <FontFamilyCombobox
      id={id}
      label={label}
      value={value}
      placeholder={placeholder}
      invalid={invalid}
      loading={fonts.status === "loading" || fonts.status === "idle"}
      listLabel={t(($) => $.editor.documentSettings.availableFonts)}
      loadingLabel={t(($) => $.editor.documentSettings.fontsLoading)}
      optionsFor={optionsFor}
      onLoad={onLoad}
      onChange={onChange}
    />
  );
}
