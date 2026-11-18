import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { currentLocale } from "@/i18n";
import { lazy } from "@/lib/preloadable";

const EmojiGrid = lazy(() => import("@/components/ui/emoji-grid"), { warm: true });

export function EmojiChooser({
  selected,
  selectedClassName,
  onSelect,
}: Readonly<{ selected?: string; selectedClassName?: string; onSelect: (emoji: string) => void }>) {
  const { t } = useTranslation(["editor"]);
  return (
    <Suspense
      fallback={
        <div className="flex h-72 items-center justify-center">
          <Spinner size="sm" />
        </div>
      }
    >
      <EmojiGrid
        locale={currentLocale()}
        labels={{
          search: t(($) => $.editor.emoji.search),
          skinTone: t(($) => $.editor.emoji.skinTone),
          loading: t(($) => $.editor.emoji.loading),
          empty: t(($) => $.editor.emoji.empty),
        }}
        selected={selected}
        selectedClassName={selectedClassName}
        onSelect={onSelect}
      />
    </Suspense>
  );
}
