import { type FC, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editorMessage } from "../../../messages";
import { shortSummary } from "./FormFields";
import { FormBody, type FormHost, TypstFormWidget } from "./widget";

export function chipText(host: FormHost): string {
  const summary = shortSummary(host.model.summary);
  const label = host.model.definition.label;
  return summary ? editorMessage("visual.typst.forms.chip", { label, summary }) : label;
}

interface Placement {
  readonly top: number;
  readonly left: number;
}

const GAP = 6;

function placementFor(anchor: HTMLElement): Placement {
  const rect = anchor.getBoundingClientRect();
  return { top: rect.bottom + GAP, left: Math.max(GAP, rect.left) };
}

const Popover: FC<{ readonly host: FormHost; readonly anchor: HTMLElement; onClose(): void }> = ({ host, anchor, onClose }) => {
  const container = useMemo(() => {
    const element = document.createElement("div");
    element.className = host.view.themeClasses;
    element.dataset.oflVisualFormPopover = "";
    return element;
  }, [host.view]);
  const [placement, setPlacement] = useState<Placement>(() => placementFor(anchor));
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    document.body.appendChild(container);
    return () => container.remove();
  }, [container]);

  useEffect(() => {
    const place = () => setPlacement(placementFor(anchor));
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (container.contains(target) || anchor.contains(target)) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && container.contains(focused)) focused.blur();
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.stopPropagation();
      onClose();
      anchor.querySelector("button")?.focus();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    container.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      container.removeEventListener("keydown", onKey);
    };
  }, [anchor, container, onClose]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
  }, []);

  return createPortal(
    <div
      ref={panel}
      className="ofl-visual-form-popover"
      role="dialog"
      aria-label={host.model.definition.label}
      style={{ top: placement.top, left: placement.left }}
    >
      <FormBody host={host} />
    </div>,
    container,
  );
};

export interface FormChipProps {
  readonly host: FormHost;
  readonly anchor: HTMLElement;
}

export const FormChip: FC<FormChipProps> = ({ host, anchor }) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        className="ofl-visual-form-chip-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={editorMessage("visual.typst.forms.open", { label: host.model.definition.label })}
        onClick={() => setOpen((current) => !current)}
      >
        {chipText(host)}
      </button>
      {open && <Popover host={host} anchor={anchor} onClose={close} />}
    </>
  );
};

export class TypstFormChipWidget extends TypstFormWidget {
  protected readonly className = "ofl-visual-form-chip";

  protected get tagName(): string {
    return "span";
  }

  protected content(host: FormHost, element: HTMLElement): ReactNode {
    return <FormChip host={host} anchor={element} />;
  }
}
