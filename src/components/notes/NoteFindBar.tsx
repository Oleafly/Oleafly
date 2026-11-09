import type { Editor } from "@tiptap/core";
import { ChevronDown, ChevronRight, ChevronUp, Search, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber } from "@/lib/intl";
import { cn, isMac } from "@/lib/utils";
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
const ICON_BUTTON = "size-7 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3.5";
const BOX = "flex min-w-0 flex-1 items-center gap-0.5 rounded-md border bg-background pl-1.5 focus-within:border-ring";
const FIELD = "h-7 w-44 min-w-14 flex-1 border-0 bg-transparent px-1 py-0 text-xs shadow-none";

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

function keepFocus(event: { preventDefault(): void }) {
  event.preventDefault();
}

function Action({
  label,
  onClick,
  children,
  className,
  pressed,
  expanded,
  controls,
}: Readonly<{
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  pressed?: boolean;
  expanded?: boolean;
  controls?: string;
}>) {
  return (
    <Tooltip label={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-controls={controls}
        onMouseDown={keepFocus}
        onClick={onClick}
        className={cn(ICON_BUTTON, pressed && "bg-primary/20 text-foreground hover:bg-primary/25", className)}
      >
        {children}
      </Button>
    </Tooltip>
  );
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
  const replaceRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const replaceId = useId();
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
  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>, onEnter: (event: ReactKeyboardEvent) => void) => {
    if (isImeEnter(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onEnter(event);
    }
  };

  const editable = editor.isEditable;
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
      {/* biome-ignore lint/a11y/useSemanticElements: WebKit before Safari 17 has no search element, so the role keeps the landmark */}
      <div
        ref={barRef}
        role="search"
        aria-label={t(($) => $.editor.package.search.panel)}
        data-note-find=""
        className="pointer-events-auto absolute right-3 top-1.5 flex w-fit max-w-[min(34rem,calc(100%-1.5rem))] items-start gap-1 rounded-lg border bg-popover p-1.5 text-xs text-popover-foreground shadow-xl"
      >
        {editable && (
          <Action
            label={t(($) => $.editor.package.search.toggleReplace)}
            expanded={expanded}
            controls={replaceId}
            className="w-5 min-w-5"
            onClick={() => {
              setExpanded((value) => !value);
              if (!expanded) requestAnimationFrame(() => replaceRef.current?.focus({ preventScroll: true }));
            }}
          >
            {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </Action>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1">
            <div className={BOX}>
              <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                ref={findRef}
                value={search}
                spellCheck={false}
                placeholder={t(($) => $.editor.package.search.find)}
                aria-label={t(($) => $.editor.package.search.find)}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => onFieldKey(event, (key) => step(!key.shiftKey))}
                className={FIELD}
              />
              <Action label={t(($) => $.editor.package.search.matchCase)} pressed={caseSensitive} onClick={() => setCaseSensitive((value) => !value)}>
                {GLYPHS.matchCase}
              </Action>
              <Action label={t(($) => $.editor.package.search.matchWholeWord)} pressed={wholeWord} onClick={() => setWholeWord((value) => !value)} className="underline">
                {GLYPHS.wholeWord}
              </Action>
              <Action label={t(($) => $.editor.package.search.useRegex)} pressed={regexp} onClick={() => setRegexp((value) => !value)}>
                {GLYPHS.regexp}
              </Action>
            </div>
            <output aria-live="polite" aria-atomic="true" className="min-w-[3.25rem] shrink-0 px-1 text-center text-[0.6875rem] tabular-nums text-muted-foreground">
              {count}
            </output>
            <Action label={t(($) => $.editor.package.search.previousMatch)} onClick={() => step(false)}>
              <ChevronUp aria-hidden />
            </Action>
            <Action label={t(($) => $.editor.package.search.nextMatch)} onClick={() => step(true)}>
              <ChevronDown aria-hidden />
            </Action>
            <Action label={t(($) => $.editor.package.search.close)} onClick={close}>
              <X aria-hidden />
            </Action>
          </div>
          {editable && expanded && (
            <div id={replaceId} className="flex min-w-0 items-center gap-1">
              <div className={BOX}>
                <Input
                  ref={replaceRef}
                  value={replace}
                  spellCheck={false}
                  placeholder={t(($) => $.editor.package.search.replace)}
                  aria-label={t(($) => $.editor.package.search.replace)}
                  onChange={(event) => setReplace(event.target.value)}
                  onKeyDown={(event) => onFieldKey(event, replaceNext)}
                  className={FIELD}
                />
                <Action label={t(($) => $.editor.package.search.preserveCase)} pressed={keepCase} onClick={() => setKeepCase((value) => !value)}>
                  {GLYPHS.preserveCase}
                </Action>
              </div>
              <Tooltip label={t(($) => $.editor.package.search.replaceNext)} side="bottom">
                <Button type="button" variant="ghost" size="xs" className="h-7 text-muted-foreground hover:text-foreground" onMouseDown={keepFocus} onClick={replaceNext}>
                  {t(($) => $.editor.package.search.replaceAction)}
                </Button>
              </Tooltip>
              <Tooltip label={t(($) => $.editor.package.search.replaceAll)} side="bottom">
                <Button type="button" variant="ghost" size="xs" className="h-7 text-muted-foreground hover:text-foreground" onMouseDown={keepFocus} onClick={replaceAll}>
                  {t(($) => $.editor.package.search.replaceAllAction)}
                </Button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
