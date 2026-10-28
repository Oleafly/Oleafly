import {
  type FC,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { editorMessage } from "../../../messages";
import { FormSaves, historyCommand, imeKeyEvent, shortSummary } from "./FormFields";
import { FormBody, type FormHost, holdFormFocus, TypstFormWidget } from "./widget";

export function chipText(host: FormHost): string {
  const summary = shortSummary(host.model.summary);
  const label = host.model.definition.label;
  return summary ? editorMessage("visual.typst.forms.chip", { label, summary }) : label;
}

export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly maxHeight: number;
}

interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

const GAP = 6;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;

// Below the chip when the panel fits there, above it when there is more room above, and never
// past the window's right edge.
export function placementFor(
  chip: Box,
  panel: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
): Placement {
  const below = viewport.height - chip.bottom - 2 * GAP;
  const above = chip.top - 2 * GAP;
  const flip = panel.height > below && above > below;
  const maxHeight = Math.min(MAX_HEIGHT, viewport.height * 0.7, Math.max(MIN_HEIGHT, flip ? above : below));
  const height = Math.min(panel.height, maxHeight);
  return {
    top: Math.max(GAP, flip ? chip.top - GAP - height : chip.bottom + GAP),
    left: Math.max(GAP, Math.min(chip.left, viewport.width - panel.width - GAP)),
    maxHeight,
  };
}

// A first guess below the chip, corrected before paint once the panel can be measured. The panel
// is never hidden meanwhile: a hidden field can't take focus.
function guessPlacement(anchor: HTMLElement): Placement {
  const chip = anchor.getBoundingClientRect();
  return { top: chip.bottom + GAP, left: Math.max(GAP, chip.left), maxHeight: MAX_HEIGHT };
}

const FIRST_FIELD =
  ".ofl-visual-form-fields input:not(:disabled), .ofl-visual-form-fields select:not(:disabled), .ofl-visual-form-fields textarea:not(:disabled)";

function focusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>("input, select, textarea, button")).filter(
    (control) => !control.hasAttribute("disabled"),
  );
}

const Popover: FC<{ readonly host: FormHost; readonly anchor: HTMLElement; onClose(): void }> = ({ host, anchor, onClose }) => {
  const container = useMemo(() => {
    const element = document.createElement("div");
    element.className = host.view.themeClasses;
    element.dataset.oflVisualFormPopover = "";
    element.dataset.oflVisualForm = "";
    return element;
  }, [host.view]);
  const [placement, setPlacement] = useState<Placement>(() => guessPlacement(anchor));
  const [away, setAway] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const saves = useRef<Promise<boolean>[]>([]);
  const closing = useRef(false);
  const track = useCallback((save: Promise<boolean>) => {
    saves.current.push(save);
  }, []);

  // Closes once the draft the focused field holds is written. A draft with a problem keeps the
  // popover open on that field, with its message, instead of being thrown away.
  const requestClose = useCallback(
    (refocusChip: boolean) => {
      if (closing.current) return;
      saves.current = [];
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && container.contains(focused)) focused.blur();
      const pending = saves.current;
      const close = () => {
        onClose();
        if (refocusChip) anchor.querySelector<HTMLElement>("button")?.focus();
      };
      if (pending.length === 0) {
        close();
        return;
      }
      closing.current = true;
      void Promise.all(pending).then((results) => {
        closing.current = false;
        if (results.every(Boolean)) close();
        else if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
      });
    },
    [anchor, container, onClose],
  );

  useLayoutEffect(() => {
    document.body.appendChild(container);
    return () => container.remove();
  }, [container]);

  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      const node = panel.current;
      if (!node) return;
      const chip = anchor.getBoundingClientRect();
      const editor = host.view.scrollDOM.getBoundingClientRect();
      // A chip scrolled out of the editor takes its popover with it rather than leave it over the app.
      const gone = !anchor.isConnected || chip.bottom < editor.top || chip.top > editor.bottom;
      setAway(gone);
      if (gone) {
        requestClose(false);
        return;
      }
      setPlacement(
        placementFor(
          chip,
          { width: node.offsetWidth, height: node.scrollHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    // Layout can move the chip without a scroll: the sidebar opening, the line rewrapping.
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (panel.current) observer?.observe(panel.current);
    observer?.observe(host.view.scrollDOM);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [anchor, host.view, requestClose]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (container.contains(target) || anchor.contains(target)) return;
      requestClose(false);
    };
    // On the document, so Escape still closes the popover once focus has left it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || imeKeyEvent(event)) return;
      const inside = container.contains(document.activeElement);
      if (inside) event.stopPropagation();
      requestClose(inside);
    };
    window.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, container, requestClose]);

  // The first field the user can change, not the header's "Edit in source".
  useEffect(() => {
    const node = panel.current;
    (node?.querySelector<HTMLElement>(FIRST_FIELD) ?? node?.querySelector<HTMLElement>("button"))?.focus();
  }, []);

  const latestHost = useRef(host);
  latestHost.current = host;

  // Tab and Shift-Tab stay inside the popover, so focus can't wander off into the app behind it.
  // A history key a field didn't take, on a button for instance, undoes in the document. Both
  // listen on the portal's container, added after React's own listener there, so a key a field
  // already handled arrives marked.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = panel.current;
      const command = historyCommand(event);
      if (command) {
        if (event.defaultPrevented) return;
        event.preventDefault();
        latestHost.current.history(command);
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const controls = focusable(node);
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1) ?? first;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    container.addEventListener("keydown", onKey);
    container.addEventListener("mousedown", holdFormFocus);
    return () => {
      container.removeEventListener("keydown", onKey);
      container.removeEventListener("mousedown", holdFormFocus);
    };
  }, [container]);

  const style = {
    top: placement.top,
    left: placement.left,
    maxHeight: placement.maxHeight,
    visibility: away ? ("hidden" as const) : undefined,
  };
  return createPortal(
    <dialog
      ref={panel}
      className="ofl-visual-form-popover"
      open
      aria-label={host.model.definition.label}
      style={style}
    >
      <FormSaves.Provider value={track}>
        <FormBody host={host} />
      </FormSaves.Provider>
    </dialog>,
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
  const text = chipText(host);
  return (
    <>
      <button
        type="button"
        className="ofl-visual-form-chip-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={editorMessage("visual.typst.forms.open", { label: text })}
        onClick={() => setOpen((current) => !current)}
      >
        {text}
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
