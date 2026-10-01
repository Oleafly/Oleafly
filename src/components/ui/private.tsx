import { Fragment, type ReactNode, useMemo } from "react";
import { type PersonalPart, useDisplayPath, usePersonalParts } from "@/lib/display-path";
import { usePersonalDetailsStore } from "@/store/personal-details";
import "./private.css";

/**
 * Screenshot mode markers. Anything marked `data-private` gets a light blur
 * while personal details are hidden (the rule lives in private.css and keys
 * off the attribute the personal-details store puts on <html>). The blur is
 * visual only: the text stays in the page for screen readers and for copy.
 * Hover shows a value clearly, and so does keyboard focus, with a tint.
 */

export function useHidePersonalDetails(): boolean {
  return usePersonalDetailsStore((state) => state.hidden);
}

/**
 * One personal value: a name, a size, a count or a path. It joins the tab
 * order while details are hidden, so a keyboard user can reveal it. Pass
 * `focusable={false}` inside a button or link, which reveals it on focus.
 */
export function Private({
  children,
  focusable = true,
  className,
}: Readonly<{
  children: ReactNode;
  focusable?: boolean;
  className?: string;
}>) {
  const hidden = useHidePersonalDetails();
  return (
    <span
      data-private=""
      tabIndex={hidden && focusable ? 0 : undefined} // NOSONAR - a focus stop in screenshot mode, so a keyboard user can reveal the blurred value
      className={className}
    >
      {children}
    </span>
  );
}

/** A backend path shown through the shared display helper (`~/…`), marked personal. */
export function PrivatePath({
  path,
  focusable,
  className,
}: Readonly<{
  path: string;
  focusable?: boolean;
  className?: string;
}>) {
  const displayPath = useDisplayPath();
  return (
    <Private focusable={focusable} className={className}>
      {displayPath(path)}
    </Private>
  );
}

/**
 * Renders split display text, wrapping each personal run in a marker.
 * `renderPlain` formats the clear runs (a log keeps its token colours).
 */
export function renderPersonalParts(
  parts: readonly PersonalPart[],
  renderPlain: (text: string) => ReactNode = (text) => text,
): ReactNode[] {
  return parts.map((part, index) =>
    part.personal ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional runs of one string
      <span key={index} /* NOSONAR - positional runs of one string */ data-private="">
        {part.text}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional runs of one string
      <Fragment key={index} /* NOSONAR - positional runs of one string */>{renderPlain(part.text)}</Fragment>
    ),
  );
}

/**
 * Props for a block of free text (a log, a reply) that holds personal runs.
 * While details are hidden the block is one focus stop that reveals them all.
 * Pass the block's `text` and a block with nothing personal in it stays out
 * of the tab order, as it would outside screenshot mode.
 */
export function usePrivateGroup(text?: string): { "data-private-group"?: ""; tabIndex?: number } {
  const hidden = useHidePersonalDetails();
  const personalParts = usePersonalParts();
  const personal = useMemo(
    () => hidden && (text === undefined || personalParts(text).some((part) => part.personal)),
    [hidden, personalParts, text],
  );
  return personal ? { "data-private-group": "", tabIndex: 0 } : {};
}

/** A personal value or block that shows itself when it takes focus. */
export const PERSONAL_VALUE_SELECTOR = "[data-private], [data-private-group]";

// The elements a dialog's focus scope can move to on open, in page order.
// Links are left out, as Radix leaves them out when it picks the first one.
function tabbableCandidates(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("*")].filter((element) => {
    if (element.tagName === "A" || element.hidden) return false;
    if ((element as HTMLButtonElement).disabled) return false;
    if (element instanceof HTMLInputElement && element.type === "hidden") return false;
    return element.tabIndex >= 0;
  });
}

/**
 * `onOpenAutoFocus` for a dialog or popover. Opening one focuses its first
 * control, and focus reveals a personal value, so while details are hidden it
 * focuses the first control that is not one, or else the dialog itself.
 */
export function focusPastPersonalDetails(event: Event): void {
  if (!usePersonalDetailsStore.getState().hidden) return;
  const container = event.currentTarget;
  if (!(container instanceof HTMLElement)) return;
  event.preventDefault();
  const before = document.activeElement;
  for (const element of tabbableCandidates(container)) {
    if (element.matches(PERSONAL_VALUE_SELECTOR)) continue;
    element.focus({ preventScroll: true });
    if (document.activeElement !== before) {
      if (element instanceof HTMLInputElement) element.select();
      return;
    }
  }
  container.focus({ preventScroll: true });
}

/**
 * Free text that may hold paths, the account name or the given `values`.
 * While details are shown it renders the text as is, with no extra elements.
 */
export function PrivateText({
  text,
  values,
  focusable = true,
  className,
}: Readonly<{
  text: string;
  values?: readonly string[];
  focusable?: boolean;
  className?: string;
}>) {
  const hidden = useHidePersonalDetails();
  const personalParts = usePersonalParts();
  if (!hidden) return <>{text}</>;
  const parts = personalParts(text, values);
  if (!parts.some((part) => part.personal)) return <>{text}</>;
  return (
    <span
      data-private-group=""
      tabIndex={focusable ? 0 : undefined} // NOSONAR - one focus stop in screenshot mode, so a keyboard user can reveal the blurred values
      className={className}
    >
      {renderPersonalParts(parts)}
    </span>
  );
}
