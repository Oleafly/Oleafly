import { EmojiPicker, type EmojiPickerListProps } from "frimousse";
import { useMemo } from "react";
import { INPUT_CLASS_NAME } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EMOJIBASE_PATH, emojibaseLocale } from "./emoji-locale";

type ListComponents = NonNullable<EmojiPickerListProps["components"]>;

export interface EmojiGridLabels {
  search: string;
  skinTone: string;
  loading: string;
  empty: string;
}

const HEADER: ListComponents["CategoryHeader"] = ({ category, ...props }) => (
  <div {...props} className="bg-popover px-1 pb-1 pt-2 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
    {category.label}
  </div>
);

const ROW: ListComponents["Row"] = ({ children, ...props }) => (
  <div {...props} className="gap-0.5">
    {children}
  </div>
);

function listFor(selected: string | undefined, selectedClassName: string): ListComponents {
  return {
    CategoryHeader: HEADER,
    Row: ROW,
    Emoji: ({ emoji, ...props }) => (
      <button
        {...props}
        type="button"
        aria-pressed={emoji.emoji === selected}
        className={cn(
          "flex size-8 items-center justify-center rounded text-lg transition-colors data-[active]:bg-accent",
          emoji.emoji === selected && selectedClassName,
        )}
      >
        {emoji.emoji}
      </button>
    ),
  };
}

const STATE = "absolute inset-0 flex items-center justify-center text-xs text-muted-foreground";

export default function EmojiGrid({
  locale,
  labels,
  selected,
  selectedClassName = "bg-accent",
  onSelect,
}: Readonly<{
  locale: string;
  labels: EmojiGridLabels;
  selected?: string;
  selectedClassName?: string;
  onSelect: (emoji: string) => void;
}>) {
  const list = useMemo(() => listFor(selected, selectedClassName), [selected, selectedClassName]);
  return (
    <EmojiPicker.Root
      locale={emojibaseLocale(locale)}
      emojibaseUrl={`${import.meta.env.BASE_URL}${EMOJIBASE_PATH}`}
      columns={8}
      onEmojiSelect={(emoji) => onSelect(emoji.emoji)}
      className="flex h-72 flex-col gap-2"
    >
      <div className="flex items-center gap-1">
        <EmojiPicker.Search
          autoFocus
          aria-label={labels.search}
          placeholder={labels.search}
          className={cn(INPUT_CLASS_NAME, "h-8 [&::-webkit-search-cancel-button]:hidden")}
        />
        <EmojiPicker.SkinToneSelector
          aria-label={labels.skinTone}
          className="flex size-8 shrink-0 items-center justify-center rounded text-base transition-colors hover:bg-accent focus-visible:bg-accent"
        />
      </div>
      <EmojiPicker.Viewport className="relative min-h-0 flex-1">
        <EmojiPicker.Loading className={STATE}>{labels.loading}</EmojiPicker.Loading>
        <EmojiPicker.Empty className={STATE}>{labels.empty}</EmojiPicker.Empty>
        <EmojiPicker.List components={list} />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
