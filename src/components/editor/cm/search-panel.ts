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
import { preserveCase } from "@/lib/preserve-case";

/**
 * A VSCode-style find/replace widget for the editor. Replaces CodeMirror's
 * default search bar: a compact, right-aligned card with icon toggles (case,
 * whole-word, regex), a live match count, prev/next, select-all, and a
 * collapsible replace row. Wired to CodeMirror's own search commands.
 */

const ICON = {
  chevronRight: "›",
  chevronDown: "⌄",
  up: "↑",
  down: "↓",
  selectAll: "≡",
  close: "✕",
};

function btn(text: string, title: string, onClick: () => void, extraClass = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.className = `cm-vs-btn ${extraClass}`.trim();
  b.onmousedown = (e) => e.preventDefault(); // keep editor/inputs from losing focus
  b.onclick = onClick;
  return b;
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

  // Left expand/collapse chevron.
  const expandBtn = btn(ICON.chevronRight, "Toggle Replace", () => {
    expanded = !expanded;
    replaceRow.style.display = expanded ? "flex" : "none";
    expandBtn.textContent = expanded ? ICON.chevronDown : ICON.chevronRight;
    if (expanded) replaceInput.focus();
  });
  expandBtn.classList.add("cm-vs-expand");

  const findInput = document.createElement("input");
  findInput.className = "cm-vs-input";
  findInput.placeholder = "Find";
  findInput.value = q0.search;

  const caseBtn = btn("Aa", "Match case", () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle("active", caseSensitive);
    commit();
  });
  caseBtn.classList.toggle("active", caseSensitive);
  const wordBtn = btn("ab", "Match whole word", () => {
    wholeWord = !wholeWord;
    wordBtn.classList.toggle("active", wholeWord);
    commit();
  });
  wordBtn.classList.toggle("active", wholeWord);
  wordBtn.style.textDecoration = "underline";
  const reBtn = btn(".*", "Use regular expression", () => {
    regexp = !regexp;
    reBtn.classList.toggle("active", regexp);
    commit();
  });
  reBtn.classList.toggle("active", regexp);

  const count = document.createElement("span");
  count.className = "cm-vs-count";

  const prevBtn = btn(ICON.up, "Previous match (⇧Enter)", () => {
    findPrevious(view);
    refresh();
  });
  const nextBtn = btn(ICON.down, "Next match (Enter)", () => {
    findNext(view);
    refresh();
  });
  const selAllBtn = btn(ICON.selectAll, "Select all matches", () => selectMatches(view));
  const closeBtn = btn(ICON.close, "Close (Esc)", () => closeSearchPanel(view));

  const findRow = document.createElement("div");
  findRow.className = "cm-vs-row";
  const findBox = document.createElement("div");
  findBox.className = "cm-vs-box";
  findBox.append(findInput, caseBtn, wordBtn, reBtn);
  findRow.append(findBox, count, prevBtn, nextBtn, selAllBtn, closeBtn);

  // Replace row (hidden until expanded).
  const replaceInput = document.createElement("input");
  replaceInput.className = "cm-vs-input";
  replaceInput.placeholder = "Replace";
  replaceInput.value = q0.replace;
  const replaceRow = document.createElement("div");
  replaceRow.className = "cm-vs-row";
  replaceRow.style.display = "none";
  const preserveBtn = btn("AB", "Preserve case", () => {
    preserveCaseOn = !preserveCaseOn;
    preserveBtn.classList.toggle("active", preserveCaseOn);
  });
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

  // Stack Find above Replace (a column), with the expand chevron to their left.
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
    count.textContent = total === 0 ? "No results" : cur > 0 ? `${cur} of ${capped}` : `${capped} results`;
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
      findInput.focus();
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
  ".cm-panels.cm-panels-top": { borderBottom: "none", backgroundColor: "transparent", zIndex: "20" },
  ".cm-vs-search": {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: "2px",
    marginLeft: "auto",
    width: "fit-content",
    maxWidth: "min(32rem, calc(100% - 12px))",
    padding: "4px 6px 4px 2px",
    borderRadius: "6px",
    border: "1px solid var(--border, rgba(128,128,128,0.3))",
    background: "var(--popover, #fff)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
    font: "12px system-ui, sans-serif",
  },
  ".cm-vs-rows": { display: "flex", flexDirection: "column", gap: "2px" },
  ".cm-vs-expand": { alignSelf: "flex-start", padding: "3px 2px", fontSize: "13px", color: "var(--muted-foreground, #888)" },
  ".cm-vs-row": { display: "flex", alignItems: "center", gap: "2px", margin: "1px 0" },
  ".cm-vs-box": {
    display: "flex",
    alignItems: "center",
    gap: "1px",
    padding: "0 2px",
    borderRadius: "4px",
    border: "1px solid var(--border, rgba(128,128,128,0.3))",
    background: "var(--background, #fff)",
  },
  ".cm-vs-input": {
    width: "13rem",
    maxWidth: "40vw",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "inherit",
    padding: "3px 4px",
    font: "12px system-ui, sans-serif",
  },
  ".cm-vs-btn": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "20px",
    height: "20px",
    padding: "0 4px",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--muted-foreground, #666)",
    cursor: "pointer",
    font: "11px system-ui, sans-serif",
  },
  ".cm-vs-btn:hover": { background: "var(--accent, rgba(128,128,128,0.15))", color: "var(--foreground, #111)" },
  ".cm-vs-btn.active": { background: "color-mix(in srgb, var(--primary, #2563eb) 22%, transparent)", color: "var(--foreground, #111)" },
  ".cm-vs-count": { minWidth: "4.5rem", padding: "0 6px", color: "var(--muted-foreground, #888)", whiteSpace: "nowrap" },
});

export function vscodeSearch() {
  return [search({ top: true, createPanel: createSearchPanel }), searchTheme];
}
