import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import {
  CircleMinus,
  CirclePlus,
  CircleSlash2,
  ListFilter,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  acceptField,
  acceptValue,
  highlight,
  insertAtCaret,
  suggestAt,
  toggleNegation,
  type AnalyzedQuery,
  type Diagnostic,
  type Edit,
  type SearchSchema,
  type Segment,
  type SuggestContext,
} from "@oleafly/search-query";
import { INLINE_KEYWORD, INLINE_TOKEN_AMBER, INLINE_TOKEN_BLUE } from "@/components/ui/inline-token";
import { useScrollTopOnChange } from "@/hooks/use-scroll-top-on-change";
import {
  buildSuggestions,
  type QueryMeta,
  type QuerySuggestion,
  type QuerySuggestions,
} from "@/lib/query-suggestions";
import { cn } from "@/lib/utils";
import { CheckBadge } from "@/components/ui/check-badge";

const MENU_WIDTH = 288;
const UNFINISHED = new Set<Diagnostic["code"]>(["unclosed-group", "dangling-operator", "unterminated-quote"]);
const OPTION_CLASS = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors";
const HEADING_CLASS = "px-2.5 pb-1 pt-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground";

const ISSUE_KEYS = {
  "unclosed-group": "unclosedGroup",
  "unexpected-close": "unexpectedClose",
  "dangling-operator": "danglingOperator",
  "too-deep": "tooDeep",
  "empty-group": "emptyGroup",
  "unterminated-quote": "unterminatedQuote",
  "unknown-qualifier": "unknownQualifier",
  "missing-value": "missingValue",
  "invalid-value": "invalidValue",
  "invalid-range": "invalidDate",
  "sort-negated": "sortNegated",
} as const satisfies Record<Diagnostic["code"], string>;

type Translate = ReturnType<typeof useTranslation<["common"]>>["t"];

export function queryIssueMessage<T>(
  t: Translate,
  issue: Diagnostic,
  source: string,
  schema: SearchSchema<T, QueryMeta>,
): string {
  const params = {
    key: issue.key ?? "",
    value: issue.value ?? "",
    operator: source.slice(issue.span.start, issue.span.end),
  };
  if (issue.code === "invalid-range" && issue.key && schema.field(issue.key)?.type === "number") {
    return t(($) => $.common.querySearch.issues.invalidNumber, params);
  }
  return t(($) => $.common.querySearch.issues[ISSUE_KEYS[issue.code]], params);
}

function segmentClass(segment: Segment): string | undefined {
  if (segment.error) return INLINE_TOKEN_AMBER;
  if (segment.kind === "value") return INLINE_TOKEN_BLUE;
  if (segment.kind === "operator") return INLINE_KEYWORD;
  return undefined;
}

const NO_SUGGESTIONS: QuerySuggestions = { heading: null, items: [], operators: [], hint: null };

function visibleIssues(diagnostics: readonly Diagnostic[], source: string, caret: number, focused: boolean): Diagnostic[] {
  if (!focused) return [...diagnostics];
  const typingAtEnd = caret >= source.trimEnd().length;
  return diagnostics.filter(
    (diagnostic) =>
      !(diagnostic.span.start <= caret && caret <= diagnostic.span.end) &&
      !(typingAtEnd && UNFINISHED.has(diagnostic.code)),
  );
}

function anchorOf<T>(context: SuggestContext<T, QueryMeta>, caret: number): number {
  return context.kind === "none" ? caret : context.from;
}

function SuggestionIcon({ suggestion }: Readonly<{ suggestion: QuerySuggestion }>) {
  if (suggestion.kind === "exclude" || suggestion.kind === "negate") return <CircleMinus className="size-4" />;
  if (suggestion.kind === "operator") {
    return suggestion.operator === "OR" ? <CircleSlash2 className="size-4" /> : <CirclePlus className="size-4" />;
  }
  return suggestion.meta?.icon ?? <ListFilter className="size-4" />;
}

function editFor<T>(
  suggestion: QuerySuggestion,
  value: string,
  context: SuggestContext<T, QueryMeta>,
  caret: number,
): { edit: Edit; keepOpen: boolean } | null {
  if (suggestion.kind === "field" && context.kind === "fields") {
    return { edit: acceptField(value, context, suggestion.key), keepOpen: true };
  }
  if (suggestion.kind === "value" && context.kind === "values") {
    return { edit: acceptValue(value, context, suggestion.value), keepOpen: false };
  }
  if (suggestion.kind === "negate" && context.kind === "values") {
    return { edit: toggleNegation(value, context, caret), keepOpen: true };
  }
  if (suggestion.kind === "operator") {
    return { edit: insertAtCaret(value, caret, `${suggestion.operator} `), keepOpen: true };
  }
  if (suggestion.kind === "exclude") return { edit: insertAtCaret(value, caret, "-"), keepOpen: true };
  return null;
}

function optionLabel(t: Translate, suggestion: QuerySuggestion): string {
  if (suggestion.kind === "exclude") return t(($) => $.common.querySearch.exclude);
  if (suggestion.kind === "negate") {
    return t(($) => $.common.querySearch.excludeField, { field: suggestion.meta?.label ?? "" });
  }
  if (suggestion.kind === "operator") return suggestion.operator;
  if (suggestion.meta) return suggestion.meta.label;
  return suggestion.kind === "field" ? suggestion.key : suggestion.value;
}

function nextActive(options: readonly QuerySuggestion[], activeIndex: number, direction: 1 | -1): string | null {
  const slots = options.length + 1;
  const current = activeIndex < 0 ? options.length : activeIndex;
  const next = (current + direction + slots) % slots;
  return next === options.length ? null : options[next].id;
}

interface HighlightProps {
  readonly value: string;
  readonly segments: readonly Segment[];
  readonly scroll: number;
  readonly anchorText: string;
  readonly measureRef: RefObject<HTMLSpanElement | null>;
}

function QueryHighlight({ value, segments, scroll, anchorText, measureRef }: Readonly<HighlightProps>) {
  return (
    <div
      aria-hidden
      data-testid="query-search-highlight"
      className="pointer-events-none absolute inset-0 flex items-center whitespace-pre pl-10 pr-10 text-sm text-foreground"
    >
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <span className="inline-block" style={{ transform: `translateX(${-scroll}px)` }}>
          {segments.map((segment) => (
            <span key={segment.start} data-kind={segment.kind} className={segmentClass(segment)}>
              {value.slice(segment.start, segment.end)}
            </span>
          ))}
        </span>
        <span ref={measureRef} className="invisible absolute left-0 top-0">
          {anchorText}
        </span>
      </div>
    </div>
  );
}

interface OptionProps {
  readonly suggestion: QuerySuggestion;
  readonly id: string;
  readonly active: boolean;
  readonly divided: boolean;
  readonly onHover: (id: string) => void;
  readonly onChoose: (suggestion: QuerySuggestion) => void;
}

function SuggestionOption({ suggestion, id, active, divided, onHover, onChoose }: Readonly<OptionProps>) {
  const { t } = useTranslation(["common"]);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      tabIndex={-1}
      onMouseEnter={() => onHover(suggestion.id)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onChoose(suggestion)}
      className={cn(
        OPTION_CLASS,
        active && "bg-accent text-accent-foreground",
        divided && "mt-1 rounded-t-none border-t pt-2",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <SuggestionIcon suggestion={suggestion} />
      </span>
      <span className="min-w-0 flex-1 truncate">{optionLabel(t, suggestion)}</span>
      {suggestion.kind === "negate" && suggestion.negated ? (
        <CheckBadge />
      ) : null}
    </button>
  );
}

interface MenuProps<T> {
  readonly idPrefix: string;
  readonly listId: string;
  readonly left: number;
  readonly suggestions: QuerySuggestions;
  readonly options: readonly QuerySuggestion[];
  readonly activeIndex: number;
  readonly issues: readonly Diagnostic[];
  readonly value: string;
  readonly schema: SearchSchema<T, QueryMeta>;
  readonly onHover: (id: string) => void;
  readonly onChoose: (suggestion: QuerySuggestion) => void;
}

function SuggestionMenu<T>({
  idPrefix,
  listId,
  left,
  suggestions,
  options,
  activeIndex,
  issues,
  value,
  schema,
  onHover,
  onChoose,
}: Readonly<MenuProps<T>>) {
  const { t } = useTranslation(["common"]);
  const listRef = useScrollTopOnChange(value);
  const firstOperator = suggestions.items.length > 0 ? suggestions.items.length : -1;
  return (
    <div
      data-testid="query-search-menu"
      style={{ left, width: MENU_WIDTH }}
      className="absolute top-full z-50 mt-1.5 max-w-full rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl"
    >
      {suggestions.heading === "exclude" && options.length > 0 ? (
        <p className={HEADING_CLASS}>{t(($) => $.common.querySearch.exclude)}</p>
      ) : null}
      {options.length > 0 ? (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={t(($) => $.common.querySearch.suggestions)}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          className="max-h-80 overflow-y-auto"
        >
          {options.map((suggestion, index) => (
            <SuggestionOption
              key={suggestion.id}
              id={`${idPrefix}-${suggestion.id}`}
              suggestion={suggestion}
              active={index === activeIndex}
              divided={index === firstOperator}
              onHover={onHover}
              onChoose={onChoose}
            />
          ))}
        </div>
      ) : null}
      {suggestions.hint === "date" ? (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">{t(($) => $.common.querySearch.dateHint)}</p>
      ) : null}
      {issues.map((issue) => (
        <p
          key={`${issue.code}-${issue.span.start}`}
          className="flex items-start gap-1.5 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">{queryIssueMessage(t, issue, value, schema)}</span>
        </p>
      ))}
    </div>
  );
}

export interface QuerySearchProps<T> {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly query: AnalyzedQuery<T, QueryMeta>;
  readonly schema: SearchSchema<T, QueryMeta>;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly clearLabel: string;
  readonly className?: string;
}

export function QuerySearch<T>({
  value,
  onChange,
  query,
  schema,
  ariaLabel,
  placeholder,
  clearLabel,
  className,
}: QuerySearchProps<T>) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(value.length);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [menuLeft, setMenuLeft] = useState(0);

  const context = useMemo(() => suggestAt(query, schema, caret), [query, schema, caret]);
  const suggestions = useMemo(
    () => (focused ? buildSuggestions(context, schema) : NO_SUGGESTIONS),
    [focused, context, schema],
  );
  const issues = useMemo(
    () => visibleIssues(query.diagnostics, value, caret, focused),
    [query.diagnostics, value, caret, focused],
  );
  const segments = useMemo(() => highlight(value, query.tokens, issues), [value, query.tokens, issues]);
  const options = useMemo(
    () => [...suggestions.items, ...suggestions.operators],
    [suggestions.items, suggestions.operators],
  );
  const activeIndex = options.findIndex((option) => option.id === activeId);
  const hasContent = options.length > 0 || issues.length > 0 || suggestions.hint !== null;
  const open = focused && !dismissed && hasContent;
  const anchorText = value.slice(0, anchorOf(context, caret));
  const activeDescendant = open && activeIndex >= 0 ? `${id}-${options[activeIndex].id}` : undefined;

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input?.value !== value) return;
    if (pendingCaret.current !== null) {
      const next = pendingCaret.current;
      pendingCaret.current = null;
      input.setSelectionRange(next, next);
      setCaret(next);
    }
    setScroll(input.scrollLeft);
  }, [value]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const measure = measureRef.current;
    if (!open || !input || measure?.textContent !== anchorText) return;
    const padding = Number.parseFloat(getComputedStyle(input).paddingLeft) || 0;
    const width = input.parentElement?.clientWidth ?? input.clientWidth;
    const x = padding + measure.offsetWidth - scroll - 10;
    setMenuLeft(Math.max(0, Math.min(x, width - MENU_WIDTH)));
  }, [open, anchorText, scroll]);

  const syncCaret = () => {
    const input = inputRef.current;
    if (!input) return;
    setCaret(input.selectionStart ?? input.value.length);
    setScroll(input.scrollLeft);
  };

  const apply = (edit: Edit, keepOpen: boolean) => {
    pendingCaret.current = edit.caret;
    setActiveId(null);
    setDismissed(!keepOpen);
    if (edit.value === value) {
      inputRef.current?.setSelectionRange(edit.caret, edit.caret);
      setCaret(edit.caret);
      return;
    }
    onChange(edit.value);
  };

  const choose = (suggestion: QuerySuggestion) => {
    const chosen = editFor(suggestion, value, context, caret);
    if (chosen) apply(chosen.edit, chosen.keepOpen);
  };

  const close = () => {
    setDismissed(true);
    setActiveId(null);
  };

  const onArrow = (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    if (!open) setDismissed(false);
    else if (options.length > 0) setActiveId(nextActive(options, activeIndex, event.key === "ArrowDown" ? 1 : -1));
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || activeIndex < 0) {
      close();
      return;
    }
    event.preventDefault();
    choose(options[activeIndex]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") onArrow(event);
    else if (event.key === "Enter") onEnter(event);
    else if (event.key === "Tab") close();
    else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div
      className={cn(
        "relative flex min-w-0 items-center rounded-md border border-input focus-within:border-ring",
        className,
      )}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <QueryHighlight
        value={value}
        segments={segments}
        scroll={scroll}
        anchorText={anchorText}
        measureRef={measureRef}
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open && options.length > 0 ? listId : undefined}
        aria-activedescendant={activeDescendant}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          setActiveId(null);
          setDismissed(false);
          onChange(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={syncCaret}
        onScroll={(event) => setScroll(event.currentTarget.scrollLeft)}
        onFocus={() => {
          setFocused(true);
          setDismissed(value !== "");
          syncCaret();
        }}
        onBlur={() => {
          setFocused(false);
          setActiveId(null);
        }}
        onKeyDown={onKeyDown}
        className="relative h-full w-full min-w-0 rounded-[inherit] bg-transparent py-0 pl-10 pr-10 text-sm text-transparent caret-foreground placeholder:text-muted-foreground selection:bg-primary/25 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => {
            inputRef.current?.focus();
            apply({ value: "", caret: 0 }, true);
          }}
          className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
      {open ? (
        <SuggestionMenu
          idPrefix={id}
          listId={listId}
          left={menuLeft}
          suggestions={suggestions}
          options={options}
          activeIndex={activeIndex}
          issues={issues}
          value={value}
          schema={schema}
          onHover={setActiveId}
          onChoose={choose}
        />
      ) : null}
    </div>
  );
}
