import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { matchingFamilies, sourceKinds } from "@/lib/font-families";
import type { TypstFontEntry, TypstFontSourceKind } from "@/lib/typst-options";
import { cn } from "@/lib/utils";

const MAX_SHOWN = 80;

export type FontFamilies =
  | { readonly status: "idle" | "loading" | "error" }
  | { readonly status: "ready"; readonly families: readonly TypstFontEntry[] };

interface FontChoice {
  name: string;
  kinds: TypstFontSourceKind[];
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
    if (choices.length >= MAX_SHOWN) break;
  }
  return choices;
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
  const listId = useId();
  const anchor = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const choices = useMemo(
    () => (fonts.status === "ready" ? fontChoices(fonts.families, sources, query) : []),
    [fonts, sources, query],
  );
  const loading = fonts.status === "loading" || fonts.status === "idle";
  const showList = open && (loading || choices.length > 0);

  const openList = () => {
    onLoad();
    setOpen(true);
  };

  const choose = (name: string) => {
    onChange(name);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      else setActive((index) => Math.min(index + 1, Math.max(choices.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && showList && choices[active]) {
      event.preventDefault();
      choose(choices[active].name);
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
          aria-activedescendant={showList && choices[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          className={cn("h-8 text-sm", invalid && "border-destructive")}
          onFocus={openList}
          onClick={openList}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            onChange(event.target.value);
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
          className="z-[100] w-[var(--radix-popover-trigger-width)] min-w-56 rounded-md border bg-card p-1 text-card-foreground shadow-xl"
        >
          <div
            id={listId}
            role="listbox"
            aria-label={t(($) => $.editor.documentSettings.availableFonts)}
            className="max-h-60 overflow-y-auto"
          >
            {loading ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {t(($) => $.editor.documentSettings.fontsLoading)}
              </p>
            ) : (
              choices.map((choice, index) => (
                <button
                  key={choice.name}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  className={cn(
                    "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1 text-left text-sm",
                    index === active && "bg-accent text-accent-foreground",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(choice.name)}
                >
                  <span className="min-w-0 flex-1 truncate" title={choice.name}>
                    {choice.name}
                  </span>
                  {choice.kinds.map((kind) => (
                    <Badge key={kind} variant={kind === "project" ? "primaryGhost" : "muted"} size="sm">
                      {t(($) => $.editor.typstFonts.sources[kind])}
                    </Badge>
                  ))}
                </button>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
