import type { Editor } from "@tiptap/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { OUTLINE_RAIL_ROOM_PX, OutlineRail, type OutlineRailRow } from "@/components/ui/outline-rail";
import { scrollParent, scrollToHeading, watchHeadings, type DomOutline, type OutlineHeading } from "./note-outline";

const NO_OUTLINE: DomOutline = { headings: [], elements: [] };

const headingKey = (heading: OutlineHeading) => `${heading.index}-${heading.slug}`;

function hasRoom(root: HTMLElement, container: HTMLElement): boolean {
  const right = container.getBoundingClientRect().left + container.clientLeft + container.clientWidth;
  return right - root.getBoundingClientRect().right >= OUTLINE_RAIL_ROOM_PX;
}

export function NoteOutlineRail({ editor, title }: Readonly<{ editor: Editor; title: string }>) {
  const { t } = useTranslation(["notes"]);
  const [outline, setOutline] = useState(NO_OUTLINE);
  const [active, setActive] = useState(-1);
  const [frame, setFrame] = useState({ top: 0, fits: false });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const root = editor.view.dom;
    const container = scrollParent(root);
    const unwatch = watchHeadings(root, { onRead: setOutline, onActive: setActive });
    if (!container) return unwatch;
    const measure = () => {
      const top = container.offsetTop;
      const fits = hasRoom(root, container);
      setFrame((current) => (current.top === top && current.fits === fits ? current : { top, fits }));
    };
    const sizes = new ResizeObserver(measure);
    sizes.observe(container);
    sizes.observe(root);
    measure();
    return () => {
      unwatch();
      sizes.disconnect();
    };
  }, [editor]);

  const row = (heading: OutlineHeading): OutlineRailRow => ({
    label: heading.text,
    onSelect: () => {
      const element = outline.elements[heading.index];
      if (!element?.isConnected) return;
      scrollToHeading(element);
      setActive(heading.index);
    },
  });

  return (
    <OutlineRail
      items={outline.headings}
      itemKey={headingKey}
      row={row}
      activeIndex={active}
      title={t(($) => $.notes.graph.outline.title)}
      source={title}
      open={open}
      onOpenChange={setOpen}
      hidden={!frame.fits}
      top={frame.top}
    />
  );
}
