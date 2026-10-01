import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  bestSettingsHit,
  buildSettingsIndex,
  searchSettings,
  settingsTabFor,
  type CatalogPath,
  type SettingsSearchHit,
  type SettingsSearchIndex,
  type SettingsSearchPlatform,
  type SettingsSearchRowHit,
} from "@/components/settings/settings-search";
import { cn, isMac, isWindows } from "@/lib/utils";

const SEARCH_DELAY_MS = 150;
/**
 * How long to keep looking for a row after a click. Counted in time, not
 * frames: WebView2 runs frames at the display rate, so 90 frames is 0.6 s on
 * a 144 Hz screen, and rows the backend fills in can take longer than that.
 */
const REVEAL_TIMEOUT_MS = 2000;
const HIT_ATTRIBUTE = "data-settings-search-hit";
const ROW_SELECTOR = '[role="switch"], .rounded-lg.border';
const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const SETTINGS_SEARCH_HIT_CLASSES =
  "[&_[data-settings-search-hit]]:!border-primary/50 [&_[data-settings-search-hit]]:!bg-primary/10";

type I18nBundles = { getResourceBundle: (language: string, namespace: string) => unknown };

type PendingRow<Id extends string> = SettingsSearchRowHit & { id: Id; serial: number };

function currentPlatform(): SettingsSearchPlatform {
  if (isMac) return "macos";
  if (isWindows) return "windows";
  return "linux";
}

function subtree(bundle: unknown, keys: readonly string[]): unknown {
  let node = bundle;
  for (const key of keys) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

function catalogLookup(i18n: I18nBundles, locale: string) {
  return (path: CatalogPath) => {
    const [namespace, ...keys] = path;
    return subtree(i18n.getResourceBundle(locale, namespace), keys) ?? subtree(i18n.getResourceBundle("en", namespace), keys);
  };
}

function clearHits(container: HTMLElement | null) {
  for (const element of container?.querySelectorAll(`[${HIT_ATTRIBUTE}]`) ?? []) {
    element.removeAttribute(HIT_ATTRIBUTE);
  }
}

function isShown(element: Element): boolean {
  return !element.closest("[hidden]") && !element.closest(".sr-only");
}

/**
 * What to tint for a heading only screen readers see: the region it labels,
 * or else the first row after it.
 */
function visibleStandIn(container: HTMLElement, heading: HTMLElement): HTMLElement | null {
  if (heading.id) {
    for (const region of container.querySelectorAll<HTMLElement>("[aria-labelledby]")) {
      const ids = region.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
      if (ids.includes(heading.id) && isShown(region)) return region;
    }
  }
  for (const row of container.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
    const after = heading.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (after && isShown(row)) return row;
  }
  return null;
}

function revealTarget(container: HTMLElement, element: HTMLElement): HTMLElement | null {
  if (element.closest(".sr-only")) return visibleStandIn(container, element);
  const row = element.closest<HTMLElement>(ROW_SELECTOR);
  return row && container.contains(row) ? row : element;
}

export function revealSettingsRow(container: HTMLElement, label: string): HTMLElement | null {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.replace(/\s+/g, " ").trim() !== label) continue;
    const element = node.parentElement;
    if (!element || element.closest("[hidden]")) continue;
    const target = revealTarget(container, element);
    if (!target) continue;
    clearHits(container);
    target.setAttribute(HIT_ATTRIBUTE, "");
    target.scrollIntoView?.({ block: "center" });
    const focusable = target.matches(FOCUSABLE) ? target : target.querySelector<HTMLElement>(FOCUSABLE);
    focusable?.focus({ preventScroll: true });
    return target;
  }
  return null;
}

function tabValue(tab: HTMLElement): string | null {
  return /-trigger-(.+)$/.exec(tab.id)?.[1] ?? /-tab-(.+)$/.exec(tab.dataset.testid ?? "")?.[1] ?? null;
}

function tabMatches(value: string, key: string): boolean {
  const words = new Set(value.toLowerCase().split(/[^a-z\d]+/));
  const lowered = key.toLowerCase();
  return words.has(lowered) || (lowered.endsWith("s") && words.has(lowered.slice(0, -1)));
}

function pressTab(tab: HTMLElement, visited: Set<HTMLElement>) {
  visited.add(tab);
  const view = tab.ownerDocument.defaultView;
  if (view) tab.dispatchEvent(new view.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  tab.click();
}

/**
 * Rows inside a section's sub-tab are not mounted until that tab is picked.
 * Press the tab settingsTabFor names for the row. For other rows, the catalog
 * keys usually name the tab ("appearance.editor.fontSize" lives on the Editor
 * tab), so press the first closed tab they name.
 *
 * `visited` holds the tabs seen open or already pressed while looking for
 * this row. None of them is pressed again, so a user who picks another tab
 * while the row is still being looked for is not pulled back.
 */
export function openSettingsTabFor(
  container: HTMLElement,
  path: readonly string[],
  visited: Set<HTMLElement>,
): boolean {
  const tabs = [...container.querySelectorAll<HTMLElement>('[role="tab"]')];
  for (const tab of tabs) {
    if (tab.getAttribute("aria-selected") === "true") visited.add(tab);
  }
  const closed = tabs.filter(
    (tab) => !visited.has(tab) && !tab.hasAttribute("disabled") && !tab.closest("[hidden]"),
  );
  const tab = tabToOpen(closed, path);
  if (!tab) return false;
  pressTab(tab, visited);
  return true;
}

function tabToOpen(closed: readonly HTMLElement[], path: readonly string[]): HTMLElement | undefined {
  const known = settingsTabFor(path);
  if (known !== null) return closed.find((tab) => tabValue(tab) === known);
  for (const key of path) {
    const tab = closed.find((candidate) => {
      const value = tabValue(candidate);
      return value !== null && tabMatches(value, key);
    });
    if (tab) return tab;
  }
  return undefined;
}

interface SettingsSearchOptions<Id extends string> {
  open: boolean;
  resetKey: unknown;
  sections: readonly { id: Id; label: string }[];
  currentSection: Id;
  onSelectSection: (id: Id) => void;
  suspended: boolean;
  containerRef: RefObject<HTMLElement | null>;
}

export function useSettingsSearch<Id extends string>({
  open,
  resetKey,
  sections,
  currentSection,
  onSelectSection,
  suspended,
  containerRef,
}: SettingsSearchOptions<Id>) {
  const { i18n } = useTranslation();
  const locale = i18n.language || "en";
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [pendingRow, setPendingRow] = useState<PendingRow<Id> | null>(null);
  const indexRef = useRef<{ locale: string; index: SettingsSearchIndex } | null>(null);
  const selectRef = useRef(onSelectSection);
  selectRef.current = onSelectSection;

  const reset = useCallback(() => {
    setQuery("");
    setApplied("");
    setPendingRow(null);
    clearHits(containerRef.current);
  }, [containerRef]);

  // Start over each time Settings opens, and when it is sent to another
  // section (a new resetKey) while open.
  const openedForRef = useRef<{ resetKey: unknown } | null>(null);
  useEffect(() => {
    if (!open) {
      openedForRef.current = null;
      return;
    }
    if (openedForRef.current && Object.is(openedForRef.current.resetKey, resetKey)) return;
    openedForRef.current = { resetKey };
    reset();
  }, [open, resetKey, reset]);

  useEffect(() => {
    if (suspended) reset();
  }, [suspended, reset]);

  useEffect(() => {
    if (query.trim() === "") {
      setApplied("");
      return;
    }
    const timer = window.setTimeout(() => setApplied(query), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const index = () => {
    if (indexRef.current?.locale !== locale) {
      indexRef.current = {
        locale,
        index: buildSettingsIndex(catalogLookup(i18n, locale), locale, currentPlatform()),
      };
    }
    return indexRef.current.index;
  };

  const active = !suspended && applied.trim() !== "";
  const hits: SettingsSearchHit<Id>[] | null = active
    ? searchSettings(index(), sections, applied, locale)
    : null;
  const currentVisible = hits ? hits.some((hit) => hit.id === currentSection) : true;
  const bestHitRef = useRef<Id | null>(null);
  bestHitRef.current = hits ? bestSettingsHit(hits, currentSection) : null;
  const selectedForRef = useRef<string | null>(null);

  // Open the best match once per query, and again if the open section drops
  // out of the list. A section picked by hand from the list is left alone.
  // A layout effect, so the list and the open section never disagree on screen.
  useLayoutEffect(() => {
    const best = bestHitRef.current;
    const newQuery = selectedForRef.current !== applied;
    selectedForRef.current = applied;
    if (best && (newQuery || !currentVisible)) selectRef.current(best);
  }, [applied, currentVisible]);

  // A new query drops the row the last one revealed.
  const clearedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (clearedForRef.current === applied) return;
    clearedForRef.current = applied;
    clearHits(containerRef.current);
    setPendingRow(null);
  }, [applied, containerRef]);

  useEffect(() => {
    if (!pendingRow) return;
    let frame = 0;
    const started = performance.now();
    const visited = new Set<HTMLElement>();
    const attempt = () => {
      const container = containerRef.current;
      if (container) {
        if (revealSettingsRow(container, pendingRow.label)) return;
        openSettingsTabFor(container, pendingRow.path, visited);
      }
      // A row the backend fills in shows up a moment later. Past the window,
      // the row is not on the page right now (a list that is empty, or a panel
      // that is closed), so stop looking but keep it in the results.
      if (performance.now() - started < REVEAL_TIMEOUT_MS) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
  }, [pendingRow, containerRef]);

  const revealRow = (id: Id, row: SettingsSearchRowHit) => {
    selectRef.current(id);
    setPendingRow((previous) => ({ ...row, id, serial: (previous?.serial ?? 0) + 1 }));
  };

  return { query, setQuery, active, hits, revealRow };
}

export function SettingsSearchField({
  value,
  onChange,
  controls,
}: Readonly<{ value: string; onChange: (value: string) => void; controls: string }>) {
  const { t } = useTranslation(["shell"]);
  const label = t(($) => $.shell.settings.search.label);
  return (
    <div className="relative mb-2 shrink-0">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            onChange("");
          }
        }}
        aria-label={label}
        placeholder={label}
        aria-controls={controls}
        autoComplete="off"
        spellCheck={false}
        data-modal-initial-focus
        data-modal-escape-inner={value === "" ? undefined : ""}
        data-testid="settings-search"
        className="h-8 w-full rounded-md border bg-background pl-7 pr-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:border-foreground/20 focus:border-primary/60"
      />
    </div>
  );
}

export function SettingsSearchRows({
  label,
  rows,
  onReveal,
}: Readonly<{
  label: string;
  rows: readonly SettingsSearchRowHit[];
  onReveal: (row: SettingsSearchRowHit) => void;
}>) {
  if (rows.length === 0) return null;
  return (
    <ul aria-label={label} className="mb-1 flex flex-col gap-px">
      {rows.map((row) => (
        <li key={row.label}>
          <button
            type="button"
            title={row.label}
            onClick={() => onReveal(row)}
            className={cn(
              "block w-full truncate rounded-md py-1 pl-9 pr-2 text-left text-xs text-muted-foreground transition-colors",
              "hover:bg-background/60 hover:text-foreground focus-visible:bg-background/60 focus-visible:text-foreground",
            )}
          >
            {row.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SettingsSearchStatus({ count }: Readonly<{ count: number | null }>) {
  const { t } = useTranslation(["shell"]);
  const empty = t(($) => $.shell.settings.search.empty);
  let announcement = "";
  if (count === 0) announcement = empty;
  else if (count !== null) announcement = t(($) => $.shell.settings.search.results, { count });
  return (
    <>
      {/* Mounted from the first keystroke, before the first result arrives, so
          screen readers announce every change, including no results. Not
          mounted otherwise: Radix never hides a live region's ancestors, so an
          idle one would keep Settings exposed behind a dialog opened over it. */}
      <p aria-live="polite" data-testid="settings-search-status" className="sr-only">
        {announcement}
      </p>
      {count === 0 ? (
        <p aria-hidden="true" className="px-2.5 py-2 text-xs text-muted-foreground">
          {empty}
        </p>
      ) : null}
    </>
  );
}
