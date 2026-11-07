import { EmojiPicker, type EmojiPickerListProps } from "frimousse";
import { useTranslation } from "react-i18next";
import { INPUT_CLASS_NAME } from "@/components/ui/input";
import { currentLocale } from "@/i18n";
import { cn } from "@/lib/utils";
import { EMOJIBASE_PATH, emojibaseLocale } from "./emoji-locale";

const LIST: NonNullable<EmojiPickerListProps["components"]> = {
  CategoryHeader: ({ category, ...props }) => (
    <div {...props} className="bg-popover px-1 pb-1 pt-2 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
      {category.label}
    </div>
  ),
  Row: ({ children, ...props }) => (
    <div {...props} className="gap-0.5">
      {children}
    </div>
  ),
  Emoji: ({ emoji, ...props }) => (
    <button
      {...props}
      type="button"
      className="flex size-8 items-center justify-center rounded text-lg transition-colors data-[active]:bg-accent"
    >
      {emoji.emoji}
    </button>
  ),
};

const STATE = "absolute inset-0 flex items-center justify-center text-xs text-muted-foreground";

export default function EmojiGrid({ onSelect }: Readonly<{ onSelect: (emoji: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <EmojiPicker.Root
      locale={emojibaseLocale(currentLocale())}
      emojibaseUrl={`${import.meta.env.BASE_URL}${EMOJIBASE_PATH}`}
      columns={8}
      onEmojiSelect={(emoji) => onSelect(emoji.emoji)}
      className="flex h-72 flex-col gap-2"
    >
      <div className="flex items-center gap-1">
        <EmojiPicker.Search
          autoFocus
          aria-label={t(($) => $.notes.icons.searchEmoji)}
          placeholder={t(($) => $.notes.icons.searchEmoji)}
          className={cn(INPUT_CLASS_NAME, "h-8 [&::-webkit-search-cancel-button]:hidden")}
        />
        <EmojiPicker.SkinToneSelector
          aria-label={t(($) => $.notes.icons.skinTone)}
          className="flex size-8 shrink-0 items-center justify-center rounded text-base transition-colors hover:bg-accent focus-visible:bg-accent"
        />
      </div>
      <EmojiPicker.Viewport className="relative min-h-0 flex-1">
        <EmojiPicker.Loading className={STATE}>{t(($) => $.notes.icons.loading)}</EmojiPicker.Loading>
        <EmojiPicker.Empty className={STATE}>{t(($) => $.notes.icons.noEmoji)}</EmojiPicker.Empty>
        <EmojiPicker.List components={LIST} />
      </EmojiPicker.Viewport>
    </EmojiPicker.Root>
  );
}
