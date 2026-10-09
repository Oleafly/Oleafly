import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { SquareArrowOutUpRight, TableOfContents, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { PdfOutlineState, PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type OutlineItem = PdfOutlineState["items"][number];

interface OutlineItemsProps {
  items: OutlineItem[];
  onActivate: (id: string) => void;
  depth?: number;
}

export function PdfOutlineItems({ items, onActivate, depth = 0 }: Readonly<OutlineItemsProps>) {
  const { t } = useTranslation(["common", "preview"]);
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            disabled={Boolean(item.disabledReason)}
            title={item.disabledReason}
            onClick={() => onActivate(item.id)}
            className="flex min-h-8 w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            style={{ paddingInlineStart: `${8 + depth * 14}px` }}
          >
            <span className="min-w-0 flex-1 truncate">
              {item.title}
            </span>
            {item.external && (
              <SquareArrowOutUpRight
                className="size-3 shrink-0 text-muted-foreground"
                aria-label={t(($) => $.preview.outline.externalLink)}
              />
            )}
          </button>
          {item.children.length > 0 && (
            <PdfOutlineItems
              items={item.children}
              onActivate={onActivate}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export function PdfOutlineTree({ items, onActivate, depth = 0 }: Readonly<OutlineItemsProps>) {
  const { t } = useTranslation(["common", "preview"]);
  return (
    <ul className={cn(depth > 0 && "ml-3 border-l pl-1")}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            disabled={Boolean(item.disabledReason)}
            title={item.disabledReason}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => onActivate(item.id)}
          >
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.external && (
              <span className="text-[0.5625rem] uppercase text-muted-foreground">
                {t(($) => $.preview.outline.externalBadge)}
              </span>
            )}
          </button>
          {item.children.length > 0 && (
            <PdfOutlineTree
              items={item.children}
              onActivate={onActivate}
              depth={depth + 1}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

export function PdfOutlinePanel({
  id,
  open,
  state,
  pdfRef,
  onClose,
  itemStyle = "indented",
}: Readonly<{
  id: string;
  open: boolean;
  state: PdfOutlineState;
  pdfRef: RefObject<PdfViewerHandle | null>;
  onClose: () => void;
  itemStyle?: "indented" | "tree";
}>) {
  const { t } = useTranslation(["common", "preview"]);
  const activate = (itemId: string) => {
    pdfRef.current?.activateOutlineItem(itemId);
    onClose();
  };
  const Items = itemStyle === "tree" ? PdfOutlineTree : PdfOutlineItems;
  return (
    <aside
      id={id}
      aria-label={t(($) => $.preview.outline.panel)}
      inert={!open}
      className={cn(
        "absolute inset-y-2 left-2 z-30 flex w-[min(19rem,calc(100%-1rem))] flex-col overflow-hidden rounded-lg border bg-popover/80 text-popover-foreground shadow-xl backdrop-blur-xl supports-[not(backdrop-filter:blur(0))]:bg-popover",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "-translate-x-[calc(100%_+_1rem)]",
      )}
    >
      <div className="flex min-h-11 items-center justify-between px-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TableOfContents
            aria-hidden
            className="size-4 text-muted-foreground"
          />
          {t(($) => $.preview.outline.title)}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          aria-label={t(($) => $.preview.outline.close)}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {state.status === "loading" ? (
          <output
            className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"
          >
            <Spinner size="sm" />
            {t(($) => $.preview.outline.loading)}
          </output>
        ) : null}
        {state.status !== "loading" && (state.items.length ? (
          <Items items={state.items} onActivate={activate} />
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {state.message ?? t(($) => $.preview.outline.empty)}
          </p>
        ))}
      </div>
    </aside>
  );
}
