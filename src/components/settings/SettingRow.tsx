import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useChangedSettings } from "./changed-settings";
import { settingControl } from "./reveal-setting";

/** The brief tint on a row the Changed settings list jumped to. */
export const SETTING_ROW_HIGHLIGHT = "transition-colors data-[setting-highlight]:bg-primary/10";

/**
 * A small accent dot after a setting's name, read out as "Changed". Pass `id`
 * so a control can name the text in its aria-describedby.
 */
export function ChangedMarker({ id }: Readonly<{ id?: string }>) {
  const { t } = useTranslation(["common", "settings"]);
  // Relative so the sr-only text is placed inside the row. Otherwise the
  // dialog becomes its containing block and scrolls when a row is revealed.
  // The leading space keeps a name read from content as "Hidden files
  // Changed"; with it, ml-0.5 gives the same gap as before.
  return (
    <>
      {" "}
      <span className="relative ml-0.5 inline-flex align-middle">
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
        <span id={id} className="sr-only">
          {t(($) => $.settings.changed.marker)}
        </span>
      </span>
    </>
  );
}

export function ChangedSettingMarker({
  id,
  descriptionId,
}: Readonly<{ id: string; descriptionId?: string }>) {
  const changed = useChangedSettings();
  return changed?.isChanged(id) ? <ChangedMarker id={descriptionId} /> : null;
}

/**
 * Adds the marker to the row control's aria-describedby while the setting is
 * changed, so the state is read out on the control itself. The control is
 * whatever the row renders, hence the DOM edit; it adds and removes only its
 * own id, like the Tooltip does.
 */
function useControlDescribedBy(
  rowRef: RefObject<HTMLElement | null>,
  descriptionId: string,
  active: boolean,
) {
  useEffect(() => {
    const control = active && rowRef.current ? settingControl(rowRef.current) : null;
    if (!control) return;
    const ids = (value: string | null) => (value ?? "").split(/\s+/u).filter(Boolean);
    control.setAttribute(
      "aria-describedby",
      [...ids(control.getAttribute("aria-describedby")), descriptionId].join(" "),
    );
    return () => {
      const rest = ids(control.getAttribute("aria-describedby")).filter(
        (id) => id !== descriptionId,
      );
      if (rest.length > 0) control.setAttribute("aria-describedby", rest.join(" "));
      else control.removeAttribute("aria-describedby");
    };
  }, [rowRef, descriptionId, active]);
}

function rowControl(button: HTMLElement): HTMLElement | null {
  const row = button.closest("[data-setting-id]");
  return row ? settingControl(row) : null;
}

export function ResetSettingButton({
  id,
  label,
  className,
  wrapperClassName,
  reserveSpace = false,
  nextFocus = rowControl,
}: Readonly<{
  id: string;
  label: string;
  /** Classes for the button itself. */
  className?: string;
  /**
   * Classes for the box around the button, which is what a flex parent lays
   * out. Put ml-auto here, not in className.
   */
  wrapperClassName?: string;
  /**
   * Holds the button's space with an empty slot while the setting is
   * unchanged, so the controls beside it do not move when it appears. Only
   * inside the Settings dialog, the one place Reset can appear.
   */
  reserveSpace?: boolean;
  /** Where keyboard focus goes once the button leaves; the row's control by default. */
  nextFocus?: (button: HTMLElement) => HTMLElement | null;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const changed = useChangedSettings();
  if (!changed) return null;
  if (!changed.isChanged(id)) {
    return reserveSpace ? (
      <span
        aria-hidden
        data-setting-reset-slot
        className={cn("inline-flex size-7 shrink-0", className, wrapperClassName)}
      />
    ) : null;
  }

  const reset = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const button = event.currentTarget;
    const next = document.activeElement === button ? nextFocus(button) : null;
    changed.reset(id);
    if (next) requestAnimationFrame(() => next.focus({ preventScroll: true }));
  };

  return (
    <Tooltip label={t(($) => $.settings.changed.resetTooltip)} className={wrapperClassName}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        data-setting-reset
        aria-label={t(($) => $.settings.changed.reset, { label })}
        onClick={reset}
        className={cn("size-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
      >
        <RotateCcw aria-hidden />
      </Button>
    </Tooltip>
  );
}

/**
 * A settings row tied to one schema entry: it carries the entry's id for the
 * Changed settings jump, and shows the changed marker and a reset button
 * while the value differs from its default.
 */
export function SettingRow({
  settingId,
  label,
  description,
  layout = "inline",
  labelFor,
  testId,
  className,
  children,
}: Readonly<{
  settingId: string;
  label: string;
  description?: ReactNode;
  /** "stacked" puts the control under the label, for wide pickers. */
  layout?: "inline" | "stacked";
  /** Renders the label as a <label> for this control id. */
  labelFor?: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}>) {
  const rowRef = useRef<HTMLDivElement>(null);
  const markerId = useId();
  const changed = useChangedSettings()?.isChanged(settingId) ?? false;
  useControlDescribedBy(rowRef, markerId, changed);

  // The marker stays outside a <label>, so it is read once, as the control's
  // description, and never as part of its name.
  const title = (
    <>
      <div className="text-sm font-medium">
        {labelFor ? <label htmlFor={labelFor}>{label}</label> : label}
        <ChangedSettingMarker id={settingId} descriptionId={markerId} />
      </div>
      {description ? (
        <div className={cn("text-xs text-muted-foreground", layout === "stacked" && "mb-2")}>
          {description}
        </div>
      ) : null}
    </>
  );

  if (layout === "stacked") {
    return (
      <div
        ref={rowRef}
        data-setting-id={settingId}
        data-testid={testId}
        className={cn("rounded-lg border bg-card p-3", SETTING_ROW_HIGHLIGHT, className)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">{title}</div>
          {/* -my-1 keeps the 28px button from making a 20px header taller. */}
          <ResetSettingButton id={settingId} label={label} className="-my-1 -mr-1" reserveSpace />
        </div>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      data-setting-id={settingId}
      data-testid={testId}
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border bg-card p-3",
        SETTING_ROW_HIGHLIGHT,
        className,
      )}
    >
      <div>{title}</div>
      {/* The slot keeps the label column one width, changed or not, so a
          description does not rewrap when Reset appears. */}
      <div className="flex shrink-0 items-center gap-1">
        <ResetSettingButton id={settingId} label={label} reserveSpace />
        {children}
      </div>
    </div>
  );
}
