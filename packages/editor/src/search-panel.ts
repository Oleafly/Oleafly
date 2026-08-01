import { EditorView, type Panel } from "@codemirror/view";
import {
  search,
  getSearchQuery,
  setSearchQuery,
  SearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
  selectMatches,
} from "@codemirror/search";
import { preserveCase } from "./preserve-case";

// Lucide paths, matching the icon set the surrounding app uses.
const ICON_PATHS = {
  chevronRight: ["m9 18 6-6-6-6"],
  chevronDown: ["m6 9 6 6 6-6"],
  up: ["m18 15-6-6-6 6"],
  down: ["m6 9 6 6 6-6"],
  selectAll: ["M3 12h.01", "M3 18h.01", "M3 6h.01", "M8 12h13", "M8 18h13", "M8 6h13"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  search: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16", "m21 21-4.35-4.35"],
} as const;

const SVG_NS = "http://www.w3.org/2000/svg";

function icon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  // Keep controls usable even before CodeMirror mounts the base theme. Raw
  // SVGs without intrinsic dimensions default to 300x150 in WebKit.
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("cm-vs-icon");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

let nextPanelId = 0;

function btn(
  content: string | readonly string[],
  title: string,
  onClick: () => void,
  extraClass = "",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  if (typeof content === "string") b.textContent = content;
  else b.append(icon(content));
  b.title = title;
  b.setAttribute("aria-label", title);
  b.className = `cm-vs-btn ${extraClass}`.trim();
  b.onmousedown = (e) => e.preventDefault(); // keep editor/inputs from losing focus
  b.onclick = onClick;
  return b;
}

function setPressed(button: HTMLButtonElement, pressed: boolean): void {
  button.classList.toggle("active", pressed);
  button.setAttribute("aria-pressed", String(pressed));
}

function createSearchPanel(view: EditorView): Panel {
  const q0 = getSearchQuery(view.state);
  let caseSensitive = q0.caseSensitive;
  let wholeWord = q0.wholeWord;
  let regexp = q0.regexp;
  let preserveCaseOn = false;
  let expanded = false;

  const wrap = document.createElement("div");
  wrap.className = "cm-vs-search";
  wrap.setAttribute("role", "search");
  wrap.setAttribute("aria-label", "Find and replace");
  const replaceRowId = `cm-vs-replace-${++nextPanelId}`;

  const expandBtn = btn(ICON_PATHS.chevronRight, "Toggle Replace", () => {
    expanded = !expanded;
    replaceRow.style.display = expanded ? "flex" : "none";
    expandBtn.replaceChildren(
      icon(expanded ? ICON_PATHS.chevronDown : ICON_PATHS.chevronRight),
    );
    expandBtn.setAttribute("aria-expanded", String(expanded));
    if (expanded) replaceInput.focus({ preventScroll: true });
  });
  expandBtn.classList.add("cm-vs-expand");
  expandBtn.setAttribute("aria-controls", replaceRowId);
  expandBtn.setAttribute("aria-expanded", "false");

  const findInput = document.createElement("input");
  findInput.className = "cm-vs-input";
  findInput.placeholder = "Find";
  findInput.setAttribute("aria-label", "Find");
  findInput.value = q0.search;

  const caseBtn = btn("Aa", "Match case", () => {
    caseSensitive = !caseSensitive;
    setPressed(caseBtn, caseSensitive);
    commit();
  });
  setPressed(caseBtn, caseSensitive);
  const wordBtn = btn("ab", "Match whole word", () => {
    wholeWord = !wholeWord;
    setPressed(wordBtn, wholeWord);
    commit();
  });
  setPressed(wordBtn, wholeWord);
  wordBtn.style.textDecoration = "underline";
  const reBtn = btn(".*", "Use regular expression", () => {
    regexp = !regexp;
    setPressed(reBtn, regexp);
    commit();
  });
  setPressed(reBtn, regexp);

  const count = document.createElement("span");
  count.className = "cm-vs-count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  count.setAttribute("aria-atomic", "true");

  const prevBtn = btn(ICON_PATHS.up, "Previous match (⇧Enter)", () => {
    findPrevious(view);
    refresh();
  });
  const nextBtn = btn(ICON_PATHS.down, "Next match (Enter)", () => {
    findNext(view);
    refresh();
  });
  const selAllBtn = btn(ICON_PATHS.selectAll, "Select all matches", () => selectMatches(view));
  const closeBtn = btn(ICON_PATHS.close, "Close (Esc)", () => closeSearchPanel(view));

  const findRow = document.createElement("div");
  findRow.className = "cm-vs-row";
  const findBox = document.createElement("div");
  findBox.className = "cm-vs-box";
  const findGlyph = icon(ICON_PATHS.search);
  findGlyph.classList.add("cm-vs-lead");
  findBox.append(findGlyph, findInput, caseBtn, wordBtn, reBtn);
  findRow.append(findBox, count, prevBtn, nextBtn, selAllBtn, closeBtn);

  const replaceInput = document.createElement("input");
  replaceInput.className = "cm-vs-input";
  replaceInput.placeholder = "Replace";
  replaceInput.setAttribute("aria-label", "Replace");
  replaceInput.value = q0.replace;
  const replaceRow = document.createElement("div");
  replaceRow.id = replaceRowId;
  replaceRow.className = "cm-vs-row";
  replaceRow.style.display = "none";
  const preserveBtn = btn("AB", "Preserve case", () => {
    preserveCaseOn = !preserveCaseOn;
    setPressed(preserveBtn, preserveCaseOn);
  });
  setPressed(preserveBtn, preserveCaseOn);
  const replaceBox = document.createElement("div");
  replaceBox.className = "cm-vs-box";
  replaceBox.append(replaceInput, preserveBtn);

  const doReplaceNext = () => {
    // Preserve case (literal search only): map the match's case onto the replacement.
    if (preserveCaseOn && !regexp) {
      const sel = view.state.selection.main;
      const matched = view.state.sliceDoc(sel.from, sel.to);
      const isMatch =
        matched.length > 0 &&
        (caseSensitive ? matched === findInput.value : matched.toLowerCase() === findInput.value.toLowerCase());
      if (isMatch) {
        view.dispatch({ changes: { from: sel.from, to: sel.to, insert: preserveCase(matched, replaceInput.value) } });
      }
      findNext(view);
    } else {
      replaceNext(view);
    }
    refresh();
  };
  const doReplaceAll = () => {
    if (preserveCaseOn && !regexp) {
      const q = getSearchQuery(view.state);
      if (q.search && q.valid) {
        const changes: { from: number; to: number; insert: string }[] = [];
        try {
          const it = q.getCursor(view.state) as Iterator<{ from: number; to: number }>;
          let r = it.next();
          while (!r.done) {
            const matched = view.state.sliceDoc(r.value.from, r.value.to);
            changes.push({ from: r.value.from, to: r.value.to, insert: preserveCase(matched, replaceInput.value) });
            r = it.next();
          }
        } catch {
          /* invalid query */
        }
        if (changes.length) view.dispatch({ changes });
      }
    } else {
      replaceAll(view);
    }
    refresh();
  };

  const replaceBtn = btn("Replace", "Replace next", doReplaceNext);
  const replaceAllBtn = btn("All", "Replace all", doReplaceAll);
  replaceRow.append(replaceBox, replaceBtn, replaceAllBtn);

  const rows = document.createElement("div");
  rows.className = "cm-vs-rows";
  rows.append(findRow, replaceRow);
  wrap.append(expandBtn, rows);

  function commit() {
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: findInput.value,
          replace: replaceInput.value,
          caseSensitive,
          wholeWord,
          regexp,
        }),
      ),
    });
    refresh();
  }

  function refresh() {
    const q = getSearchQuery(view.state);
    if (!q.search || !q.valid) {
      count.textContent = q.search && !q.valid ? "Invalid" : "";
      return;
    }
    const sel = view.state.selection.main;
    let total = 0;
    let cur = 0;
    try {
      const it = q.getCursor(view.state) as Iterator<{ from: number; to: number }>;
      let r = it.next();
      while (!r.done && total < 2000) {
        total++;
        if (r.value.from === sel.from && r.value.to === sel.to) cur = total;
        r = it.next();
      }
    } catch {
      count.textContent = "";
      return;
    }
    const capped = total >= 2000 ? "2000+" : String(total);
    count.textContent =
      total === 0
        ? "No results"
        : cur > 0
          ? `${cur} of ${capped}`
          : `${capped} ${total === 1 ? "result" : "results"}`;
  }

  findInput.addEventListener("input", commit);
  replaceInput.addEventListener("input", commit);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) findPrevious(view);
      else findNext(view);
      refresh();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doReplaceNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearchPanel(view);
    }
  });

  return {
    dom: wrap,
    top: true,
    mount() {
      findInput.focus({ preventScroll: true });
      findInput.select();
      refresh();
    },
    update(u) {
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) {
        refresh();
      }
    },
  };
}

// EditorView.theme (not baseTheme) so the z-index override beats CodeMirror's
// default `.cm-panels` stacking, keeping the widget below app modals (z-80).
const searchTheme = EditorView.theme({
  ".cm-panels.cm-panels-top": {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    border: "none",
    borderBottom: "none",
    backgroundColor: "transparent",
    zIndex: "20",
    pointerEvents: "none",
  },
  // Mirrors the PDF search bar: one popover surface, a borderless field, and
  // ghost icon buttons, rather than boxes nested inside boxes.
  ".cm-vs-search": {
    position: "relative",
    pointerEvents: "auto",
    display: "flex",
    alignItems: "flex-start",
    gap: "4px",
    marginLeft: "auto",
    width: "fit-content",
    maxWidth: "min(34rem, calc(100% - 12px))",
    padding: "6px",
    borderRadius: "0.5rem",
    border: "1px solid var(--border, rgba(128,128,128,0.3))",
    background: "var(--popover, #fff)",
    color: "var(--popover-foreground, inherit)",
    boxShadow:
      "0 20px 25px -5px oklch(0 0 0 / 0.1), 0 8px 10px -6px oklch(0 0 0 / 0.1)",
    font: "12px system-ui, sans-serif",
  },
  ".cm-vs-rows": {
    display: "flex",
    flex: "1 1 auto",
    minWidth: "0",
    flexDirection: "column",
    gap: "4px",
  },
  ".cm-vs-expand": {
    alignSelf: "flex-start",
    width: "20px",
    minWidth: "20px",
    height: "28px",
    color: "var(--muted-foreground, #888)",
  },
  ".cm-vs-row": {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    margin: "0",
    minWidth: "0",
  },
  ".cm-vs-box": {
    display: "flex",
    flex: "1 1 auto",
    minWidth: "0",
    alignItems: "center",
    gap: "2px",
    paddingLeft: "6px",
    borderRadius: "0.375rem",
    background: "transparent",
  },
  ".cm-vs-lead": {
    width: "14px",
    height: "14px",
    flexShrink: "0",
    color: "var(--muted-foreground, #888)",
  },
  ".cm-vs-icon": { width: "14px", height: "14px" },
  ".cm-vs-input": {
    flex: "1 1 auto",
    width: "11rem",
    minWidth: "3.5rem",
    maxWidth: "40vw",
    height: "28px",
    border: "none",
    outline: "none",
    borderRadius: "0.25rem",
    background: "transparent",
    color: "inherit",
    padding: "0 4px",
    font: "12px system-ui, sans-serif",
  },
  ".cm-vs-input::placeholder": { color: "var(--muted-foreground, #999)" },
  // Keyboard users need a persistent focus target even though the search panel
  // is already a distinct surface. Keep the ring inside the borderless field
  // so it does not resize the panel or read as a second nested input box.
  ".cm-vs-input:focus": {
    outline: "2px solid var(--ring, #2563eb)",
    outlineOffset: "-2px",
  },
  ".cm-vs-input:focus-visible": {
    outline: "2px solid var(--ring, #2563eb)",
    outlineOffset: "-2px",
  },
  ".cm-vs-btn": {
    flexShrink: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "28px",
    height: "28px",
    padding: "0 6px",
    border: "none",
    borderRadius: "0.375rem",
    background: "transparent",
    color: "var(--muted-foreground, #666)",
    cursor: "pointer",
    font: "11px system-ui, sans-serif",
  },
  ".cm-vs-btn:hover": {
    background: "var(--accent, rgba(128,128,128,0.15))",
    color: "var(--accent-foreground, #111)",
  },
  ".cm-vs-btn:focus-visible": {
    outline: "2px solid var(--ring, #2563eb)",
    outlineOffset: "1px",
  },
  ".cm-vs-btn.active": {
    background: "color-mix(in srgb, var(--primary, #2563eb) 20%, transparent)",
    color: "var(--foreground, #111)",
  },
  ".cm-vs-count": {
    flexShrink: "0",
    minWidth: "3.25rem",
    padding: "0 4px",
    color: "var(--muted-foreground, #888)",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
});

const panelBorderOverride = EditorView.baseTheme({
  "&light .cm-panels-top": { borderBottom: "none" },
  "&dark .cm-panels-top": { borderBottom: "none" },
});

export function vscodeSearch() {
  return [search({ top: true, createPanel: createSearchPanel }), searchTheme, panelBorderOverride];
}
