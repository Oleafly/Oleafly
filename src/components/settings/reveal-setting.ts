// Jumping from the Changed settings list to a setting's own row. The target
// rides on the one-shot settingsScrollTarget; the other consumers compare
// exact strings, so they ignore this prefix.

const TARGET_PREFIX = "setting:";
const HIGHLIGHT_MS = 1600;
// Row reset buttons are skipped: focus should land on the control itself.
const CONTROL_SELECTOR = [
  "button:not([disabled]):not([data-setting-reset])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[role="switch"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function settingScrollTarget(id: string): string {
  return `${TARGET_PREFIX}${id}`;
}

export function settingIdFromScrollTarget(target: string | null): string | null {
  return target?.startsWith(TARGET_PREFIX) ? target.slice(TARGET_PREFIX.length) : null;
}

export function settingControl(row: Element): HTMLElement | null {
  return row.querySelector<HTMLElement>(CONTROL_SELECTOR);
}

/**
 * Scrolls a rendered setting row into view, tints it briefly (a background
 * tint, never a ring) and focuses its first control. False when the row is
 * not rendered, for example a dialect row while grammar checking is off.
 */
export function revealSettingRow(container: ParentNode | null, id: string): boolean {
  // Setting ids are plain letters and dots, so quoting is enough.
  const row = container?.querySelector<HTMLElement>(`[data-setting-id="${id}"]`);
  if (!row) return false;
  row.scrollIntoView?.({ block: "center" });
  row.setAttribute("data-setting-highlight", "");
  window.setTimeout(() => row.removeAttribute("data-setting-highlight"), HIGHLIGHT_MS);
  settingControl(row)?.focus({ preventScroll: true });
  return true;
}

/**
 * Call before a row's reset button disappears: when it had keyboard focus,
 * focus moves to the row's own control instead of falling back to the page.
 */
export function moveFocusToRowControl(button: HTMLElement): void {
  if (document.activeElement !== button) return;
  const row = button.closest("[data-setting-id]");
  if (row) requestAnimationFrame(() => settingControl(row)?.focus({ preventScroll: true }));
}
