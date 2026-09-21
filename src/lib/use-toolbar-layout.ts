import { useLayoutEffect, useState, type RefObject } from "react";

export const TOOLBAR_OVERFLOW = { settings: 1, theme: 2, browser: 3, fork: 4, layout: 5, history: 6, export: 7 } as const;

interface ToolbarLayout {
  overflow: number;
  compactBrand: boolean;
  iconOnly: boolean;
  stacked: boolean;
  roomy: boolean;
}

/** Reserve equal space on both sides of the view switch, including window chrome. */
export function useToolbarLayout(ref: RefObject<HTMLElement | null>): ToolbarLayout {
  const [layout, setLayout] = useState<ToolbarLayout>({
    overflow: 4, compactBrand: false, iconOnly: false, stacked: false, roomy: false,
  });

  // Reconnect after a render because feature flags can add or remove actions.
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    const measure = () => {
      const part = (name: string) => header.querySelector<HTMLElement>(`[data-toolbar-part="${name}"]`);
      const width = (element: Element | null) => element?.getBoundingClientRect().width ?? 0;
      const headerWidth = width(header);
      if (!headerWidth) return;
      // DOM rectangles include CSS zoom. Computed gaps and padding do not.
      const zoom = headerWidth / header.offsetWidth;
      const gap = (Number.parseFloat(getComputedStyle(header).columnGap) || 0) * zoom;
      const side = (headerWidth - width(part("views"))) / 2 - gap;
      const actions = part("actions");
      if (!actions) return;
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * zoom;
      const iconButtonWidth = 1.75 * rem;
      const items = [...actions.querySelectorAll<HTMLElement>("[data-toolbar-item]")];
      const label = part("compile-label");
      const labelSpace = label?.parentElement ? width(label) + (Number.parseFloat(getComputedStyle(label.parentElement).columnGap) || 0) * zoom : 0;
      const naturalWidth = (item: HTMLElement) => item.hasAttribute("data-toolbar-icon") ? iconButtonWidth
        : width(item) + (item.dataset.toolbarItem === "compile" && layout.iconOnly ? labelSpace : 0);
      const captions = width(part("captions"));
      const trailing = part("trailing");
      const padding = trailing ? Number.parseFloat(getComputedStyle(trailing).paddingRight) * zoom : 0;
      const fixedSpace = captions + (captions ? 0.25 * rem : 0) + padding;
      const visibleItems = (overflow: number) => items.filter((item) => item.dataset.toolbarItem === "menu"
        ? overflow > 0 : !item.dataset.overflowOrder || Number(item.dataset.overflowOrder) > overflow);
      const requiredWidth = (overflow: number, iconOnly: boolean, roomy = false) => {
        const visible = visibleItems(overflow);
        const actionGap = (roomy ? 0.5 : 0.25) * rem;
        return visible.reduce((total, item) => total + naturalWidth(item), fixedSpace)
          + Math.max(0, visible.length - 1) * actionGap
          + (part("compile-label") ? actionGap : 0) - (iconOnly ? labelSpace : 0);
      };
      let overflow = 0;
      while (overflow < TOOLBAR_OVERFLOW.export && requiredWidth(overflow, false) > side) overflow++;
      const iconOnly = requiredWidth(overflow, false) > side;
      // At extreme zoom, a second row is the only way to keep every essential
      // action and the native caption buttons visible without moving the center.
      const stacked = requiredWidth(overflow, iconOnly) > side;
      const roomy = !stacked && requiredWidth(overflow, iconOnly, true) <= side;

      const leading = part("leading");
      const brand = part("brand");
      const brandLabels = [...header.querySelectorAll<HTMLElement>("[data-brand-label]")];
      const brandLabelWidth = Math.max(0, ...brandLabels.map(width));
      const brandGap = brand ? (Number.parseFloat(getComputedStyle(brand).columnGap) || 0) * zoom : 0;
      const brandWidth = width(part("home")) + (layout.compactBrand ? brandLabelWidth + brandGap : 0);
      const leadingPadding = leading ? Number.parseFloat(getComputedStyle(leading).paddingLeft) * zoom : 0;
      const compactBrand = leadingPadding + brandWidth + width(part("breadcrumb"))
        + 2 * gap + width(part("title-minimum")) > side;
      setLayout((previous) => previous.overflow === overflow && previous.compactBrand === compactBrand
        && previous.iconOnly === iconOnly && previous.stacked === stacked
        && previous.roomy === roomy
        ? previous : { overflow, compactBrand, iconOnly, stacked, roomy });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    for (const element of header.querySelectorAll("[data-toolbar-part], [data-toolbar-item], [data-brand-label]")) observer.observe(element);
    return () => observer.disconnect();
  });
  return layout;
}
