import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { LINE_ICON_PREFIX, LINE_ICONS } from "./note-icons";

const EmojiGrid = lazy(() => import("./EmojiGrid"));

const CELL =
  "flex size-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent";

interface IconPickerProps {
  trigger: ReactNode;
  triggerClassName?: string;
  hasIcon: boolean;
  onChange: (icon: string | undefined) => void;
}

function LineIconGrid({ onSelect }: Readonly<{ onSelect: (icon: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const icons = useMemo(
    () =>
      Object.entries(LINE_ICONS)
        .map(([id, entry]) => ({ id, ...entry, label: t(($) => $.notes.icons.names[entry.name]) }))
        .filter((entry) => !needle || entry.label.toLocaleLowerCase().includes(needle) || entry.id.includes(needle)),
    [needle, t],
  );
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
        <div className="grid grid-cols-8 content-start gap-0.5 overflow-y-auto">
          {icons.map(({ id, icon: Icon, label }) => (
            <Tooltip key={id} label={label}>
              <button type="button" aria-label={label} className={CELL} onClick={() => onSelect(`${LINE_ICON_PREFIX}${id}`)}>
                <Icon aria-hidden className="size-4" />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

export function IconPicker({ trigger, triggerClassName, hasIcon, onChange }: Readonly<IconPickerProps>) {
  const { t } = useTranslation(["notes", "common"]);
  const [tab, setTab] = useState<"emoji" | "lines">("emoji");
  const [generation, setGeneration] = useState(0);
  const choose = (icon: string | undefined) => {
    onChange(icon);
    setGeneration((value) => value + 1);
  };

  return (
    <Popover
      key={generation}
      trigger={trigger}
      ariaLabel={t(($) => $.notes.icons.choose)}
      contentAriaLabel={t(($) => $.notes.icons.dialog)}
      closeOnClick={false}
      triggerClassName={triggerClassName}
      className="w-[20rem] min-w-0 p-2"
    >
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
      {tab === "emoji" ? (
        <Suspense
          fallback={
            <div className="flex h-72 items-center justify-center">
              <Spinner size="sm" />
            </div>
          }
        >
          <EmojiGrid onSelect={choose} />
        </Suspense>
      ) : (
        <LineIconGrid onSelect={choose} />
      )}
    </Popover>
  );
}
