import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { subscribeEditorDocument } from "@oleafly/editor";
import { OutlineRail, type OutlineRailRow } from "@/components/ui/outline-rail";
import { OutlineFileBadge } from "@/components/layout/OutlineFileBadge";
import { jumpToOutlineItem, useDocumentOutline } from "@/components/layout/use-document-outline";
import type { OutlineItem } from "@/lib/index/outline";
import { basename } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";
import { isOutlineDocument } from "./cm/outline-rail-clearance";

export const OUTLINE_RAIL_MIN_EDITOR_WIDTH = 360;

interface EditorFrame {
  readonly panels: number;
  readonly narrow: boolean;
}

function useEditorFrame(): EditorFrame {
  const [frame, setFrame] = useState<EditorFrame>({ panels: 0, narrow: false });
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    const unsubscribe = subscribeEditorDocument((_path, view) => {
      observer?.disconnect();
      observer = null;
      if (!view) return;
      const measure = () => {
        const scroller = view.scrollDOM;
        const panels = Math.max(
          0,
          Math.round(scroller.getBoundingClientRect().top - view.dom.getBoundingClientRect().top),
        );
        const narrow = scroller.clientWidth > 0 && scroller.clientWidth < OUTLINE_RAIL_MIN_EDITOR_WIDTH;
        setFrame((current) =>
          current.panels === panels && current.narrow === narrow ? current : { panels, narrow },
        );
      };
      observer = new ResizeObserver(measure);
      observer.observe(view.scrollDOM);
      measure();
    });
    return () => {
      unsubscribe();
      observer?.disconnect();
    };
  }, []);
  return frame;
}

const itemKey = (item: OutlineItem) => `${item.file}:${item.from}`;

export function EditorOutlineRail() {
  const { t } = useTranslation(["workspace"]);
  const activePath = useFilesStore((state) => state.activePath);
  const [open, setOpen] = useState(false);
  const outline = useDocumentOutline("document", open);
  const frame = useEditorFrame();
  const { items, marks, title, root } = outline;

  const row = (item: OutlineItem, index: number): OutlineRailRow => {
    const number = marks[index]?.number ?? null;
    const page = marks[index]?.page ?? null;
    const heading = number === null ? title(item) : `${number} ${title(item)}`;
    return {
      label: title(item),
      ariaLabel: page === null ? heading : t(($) => $.workspace.outline.onPage, { heading, page }),
      leading: number === null ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{number}</span>,
      trailing: (
        <>
          {item.file === activePath ? null : <OutlineFileBadge file={item.file} />}
          {page === null ? null : (
            <span aria-hidden className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {t(($) => $.workspace.outline.page, { page })}
            </span>
          )}
        </>
      ),
      onSelect: () => jumpToOutlineItem(item),
    };
  };

  return (
    <OutlineRail
      items={items}
      itemKey={itemKey}
      row={row}
      activeIndex={outline.activeIndex}
      title={t(($) => $.workspace.outline.title)}
      source={root ? basename(root) : null}
      open={open}
      onOpenChange={setOpen}
      hidden={!activePath || !isOutlineDocument(activePath) || frame.narrow}
      top={frame.panels}
    />
  );
}
