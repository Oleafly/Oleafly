import type { Editor } from "@tiptap/core";
import { type RefObject, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { FindBar } from "@/components/ui/find-bar";
import { formatNumber } from "@/lib/intl";
import { isMac } from "@/lib/utils";
import {
  ACTIVE_MATCH_CLASS,
  closeNoteFind,
  findNextMatch,
  findPreviousMatch,
  MAX_FIND_MATCHES,
  type NoteFindQuery,
  noteFindState,
  replaceAllMatches,
  replaceNextMatch,
  setNoteFindQuery,
} from "./note-find";

const PRINTABLE_ASCII = /^[\x20-\x7e]$/;
const GLYPHS = { matchCase: "Aa", wholeWord: "ab", regexp: ".*", preserveCase: "AB" } as const;
const SEED_LIMIT = 100;

export function isFindKey(event: KeyboardEvent): boolean {
  const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === "f" || (event.code === "KeyF" && !PRINTABLE_ASCII.test(event.key));
}

function selectionSeed(editor: Editor): string {
  const { from, to, empty } = editor.state.selection;
  if (empty || to - from > SEED_LIMIT) return "";
  const text = editor.state.doc.textBetween(from, to, "\n");
  return text.includes("\n") ? "" : text;
}

export function NoteFindBar({ editor, scope }: Readonly<{ editor: Editor; scope: RefObject<HTMLElement | null> }>) {
  const { t } = useTranslation(["editor"]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regexp, setRegexp] = useState(false);
  const [keepCase, setKeepCase] = useState(false);
  const [focusRequest, requestFocus] = useReducer((count: number) => count + 1, 0);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const findRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const query = useMemo<NoteFindQuery>(
    () => ({ search, replace, caseSensitive, wholeWord, regexp }),
    [search, replace, caseSensitive, wholeWord, regexp],
  );

  const openBar = useCallback(() => {
    const seed = selectionSeed(editor);
    if (seed) setSearch(seed);
    setOpen(true);
    requestFocus();
  }, [editor]);

  useEffect(() => {
    const element = scope.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isFindKey(event) || isImeEnter(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openBar();
    };
    element.addEventListener("keydown", onKey, true);
    return () => element.removeEventListener("keydown", onKey, true);
  }, [openBar, scope]);

  useEffect(() => {
    if (!open || focusRequest === 0) return;
    findRef.current?.focus({ preventScroll: true });
    findRef.current?.select();
  }, [focusRequest, open]);

  useEffect(() => {
    if (!open) return;
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
      if (!editor.isDestroyed && noteFindState(editor.state).query) setNoteFindQuery(editor.view, null);
    };
  }, [editor, open]);

  useEffect(() => {
    if (open && !editor.isDestroyed) setNoteFindQuery(editor.view, query);
  }, [editor, open, query]);

  if (!open || editor.isDestroyed) return null;

  const reveal = () => {
    const active = editor.view.dom.querySelector(`.${ACTIVE_MATCH_CLASS}`);
    const scroller = scope.current;
    if (!active || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const top = Math.max(box.top, barRef.current?.getBoundingClientRect().bottom ?? box.top);
    const rect = active.getBoundingClientRect();
    if (rect.top < top || rect.bottom > box.bottom) active.scrollIntoView?.({ block: "center", inline: "nearest" });
  };
  const step = (forward: boolean) => {
    const found = forward ? findNextMatch(editor.view) : findPreviousMatch(editor.view);
    if (found) reveal();
  };
  const replaceNext = () => {
    if (replaceNextMatch(editor.view, keepCase)) reveal();
  };
  const replaceAll = () => replaceAllMatches(editor.view, keepCase);
  const close = () => {
    closeNoteFind(editor.view);
    setOpen(false);
    editor.commands.focus();
  };

  const found = noteFindState(editor.state);
  const total = found.matches.length;
  const totalText = total >= MAX_FIND_MATCHES ? `${formatNumber(MAX_FIND_MATCHES)}+` : formatNumber(total);
  let count = "";
  if (found.query && !found.valid) count = t(($) => $.editor.package.search.invalid);
  else if (found.query && total === 0) count = t(($) => $.editor.package.search.noResults);
  else if (found.query && found.active >= 0) {
    count = t(($) => $.editor.package.search.matchPosition, { current: formatNumber(found.active + 1), total: totalText });
  } else if (found.query) count = t(($) => $.editor.package.search.matchCount, { count: total, total: totalText });

  return (
    <div className="pointer-events-none sticky top-9 z-20 h-0">
      <FindBar
        ref={barRef}
        aria-label={t(($) => $.editor.package.search.panel)}
        data-note-find=""
        className="pointer-events-auto absolute right-3 top-1.5 max-w-[min(34rem,calc(100%-1.5rem))]"
        inputRef={findRef}
        value={search}
        onValueChange={setSearch}
        inputLabel={t(($) => $.editor.package.search.find)}
        status={count}
        onStep={step}
        onClose={close}
        labels={{
          previous: t(($) => $.editor.package.search.previousMatch),
          next: t(($) => $.editor.package.search.nextMatch),
          close: t(($) => $.editor.package.search.close),
        }}
        toggles={[
          { label: t(($) => $.editor.package.search.matchCase), glyph: GLYPHS.matchCase, pressed: caseSensitive, onToggle: () => setCaseSensitive((value) => !value) },
          {
            label: t(($) => $.editor.package.search.matchWholeWord),
            glyph: GLYPHS.wholeWord,
            pressed: wholeWord,
            onToggle: () => setWholeWord((value) => !value),
            className: "underline",
          },
          { label: t(($) => $.editor.package.search.useRegex), glyph: GLYPHS.regexp, pressed: regexp, onToggle: () => setRegexp((value) => !value) },
        ]}
        replace={
          editor.isEditable
            ? {
                open: expanded,
                onOpenChange: setExpanded,
                toggleLabel: t(($) => $.editor.package.search.toggleReplace),
                value: replace,
                onValueChange: setReplace,
                label: t(($) => $.editor.package.search.replace),
                toggles: [
                  {
                    label: t(($) => $.editor.package.search.preserveCase),
                    glyph: GLYPHS.preserveCase,
                    pressed: keepCase,
                    onToggle: () => setKeepCase((value) => !value),
                  },
                ],
                onEnter: replaceNext,
                actions: [
                  { label: t(($) => $.editor.package.search.replaceNext), text: t(($) => $.editor.package.search.replaceAction), onClick: replaceNext },
                  { label: t(($) => $.editor.package.search.replaceAll), text: t(($) => $.editor.package.search.replaceAllAction), onClick: replaceAll },
                ],
              }
            : undefined
        }
      />
    </div>
  );
}
