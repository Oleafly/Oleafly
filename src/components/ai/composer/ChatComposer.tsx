import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Slash, Square } from "lucide-react";
import { AttachmentChips } from "@/components/ai/AttachmentChips";
import { ComposerHighlight } from "@/components/ai/ComposerHighlight";
import {
  MentionMenu,
  type MentionAgent,
  type MentionEntry,
  type MentionMenuHandle,
  type MentionSelection,
} from "@/components/ai/MentionMenu";
import {
  filterSlashCommands,
  SlashCommandMenu,
  type SlashCommandMenuHandle,
} from "@/components/ai/SlashCommandMenu";
import type { ComposerCommand } from "@/components/ai/composer-command-registry";
import { useAutoSizeTextarea } from "@/components/ai/use-auto-size-textarea";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { ATTACHMENT_ACCEPT } from "@/lib/attachments";
import { activeMentionQuery, mentionTokenEnd } from "@/lib/composer-tokens";
import { logError } from "@/lib/log";
import { takeNativeDrop } from "@/lib/native-drop";
import { treeDragPath } from "@/lib/tree-drag";
import { cn, isLinux } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { promptHistory, rememberPrompt } from "@/store/composer-drafts";
import {
  clampComposerHeight,
  COMPOSER_DEFAULT_HEIGHT,
  COMPOSER_MAX_PANEL_SHARE,
  COMPOSER_MIN_REM,
  composerDropKind,
  composerGrowMax,
  composerKeyAction,
  dropEffectFor,
  historyStep,
  pastedFiles,
  slashMenuQuery,
  type ComposerDropKind,
} from "./composer-input";
import { ComposerResizeHandle } from "./ComposerResizeHandle";
import { isImeEnter } from "./ime";
import type { ComposerAttachment, MentionItem, SlashItem } from "./types";

export { isImeEnter } from "./ime";
export type { ComposerAttachment, MentionItem, SlashItem } from "./types";

export interface ChatComposerProps {
  composerId: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  busy?: boolean;
  onQueue?(): void;
  onStop?(): void;
  /** Shows Stop but greyed out, for a stop already on its way. */
  stopDisabled?: boolean;
  /** Disables sending, never typing or attaching. */
  disabled?: boolean;
  placeholder: string;
  attachments: readonly ComposerAttachment[];
  onAddFiles?(files: File[]): void;
  onRemoveAttachment?(id: string): void;
  onDropProjectPaths?(paths: string[]): void;
  slashItems?: readonly SlashItem[];
  onSlashSelect?(item: SlashItem): void;
  mentionItems?: (query: string) => MentionItem[] | Promise<MentionItem[]>;
  onMentionSelect?(item: MentionItem): void;
  /** Earlier prompts, newest last. Defaults to the project's history. */
  history?: readonly string[];
  /** The left group of the controls row. */
  controls?: ReactNode;
  /** The right group, before the send or stop button. */
  trailingControls?: ReactNode;
  /** `data-tour` on the textarea. */
  dataTour?: string;
  highlight?: { skillIds?: readonly string[]; paths?: Iterable<string> };
  /** Shown under the textarea. */
  notice?: ReactNode;
  accept?: string;
  labels?: { send?: string; stop?: string; stopTitle?: string; textarea?: string };
  controlsTestId?: string;
}

export interface ChatComposerHandle {
  focus(): void;
  setCaret(position: number): void;
  insertText(text: string): void;
  openFilePicker(): void;
}

const EMPTY_SKILLS: readonly string[] = [];
const EMPTY_PATHS: Iterable<string> = [];

function rootFontPx(): number {
  if (typeof document === "undefined") return 16;
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

function sameMentions(left: readonly MentionItem[], right: readonly MentionItem[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item.id === right[index].id && item.kind === right[index].kind)
  );
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(
  {
    composerId,
    value,
    onChange,
    onSubmit,
    busy = false,
    onQueue,
    onStop,
    stopDisabled = false,
    disabled = false,
    placeholder,
    attachments,
    onAddFiles,
    onRemoveAttachment,
    onDropProjectPaths,
    slashItems,
    onSlashSelect,
    mentionItems,
    onMentionSelect,
    history,
    controls,
    trailingControls,
    dataTour,
    highlight,
    notice,
    accept,
    labels,
    controlsTestId = "ai-composer-controls",
  },
  ref,
) {
  const { t } = useTranslation(["common", "ai"]);
  const rootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<SlashCommandMenuHandle>(null);
  const mentionMenuRef = useRef<MentionMenuHandle>(null);
  const pendingCaret = useRef<number | null>(null);
  const recall = useRef<number | null>(null);

  // Height: the stored resting height, a live preview while dragging, and
  // the panel it may take up to 60% of.
  const storedHeight = useSettingsStore((state) => state.aiComposerHeight);
  const setStoredHeight = useSettingsStore((state) => state.setAiComposerHeight);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  const [fontPx, setFontPx] = useState(16);
  useEffect(() => {
    setFontPx(rootFontPx());
    const panel = rootRef.current?.closest<HTMLElement>("[data-composer-panel]");
    const measure = () =>
      setPanelHeight(panel?.getBoundingClientRect().height || window.innerHeight);
    measure();
    if (panel && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(panel);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const minHeight = Math.round(COMPOSER_MIN_REM * fontPx);
  const maxHeight = Math.max(minHeight, Math.round(panelHeight * COMPOSER_MAX_PANEL_SHARE));
  const resting = clampComposerHeight(previewHeight ?? storedHeight, panelHeight, fontPx);
  const growMax = composerGrowMax(resting);
  useAutoSizeTextarea(textareaRef, shellRef, value, placeholder, growMax, resting);

  // Caret, for mentions and for placing it after programmatic edits.
  const [caret, setCaretState] = useState(value.length);
  const syncCaret = useCallback((textarea: HTMLTextAreaElement) => {
    setCaretState(
      typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length,
    );
  }, []);
  useLayoutEffect(() => {
    const position = pendingCaret.current;
    const textarea = textareaRef.current;
    if (position === null || !textarea) return;
    pendingCaret.current = null;
    textarea.setSelectionRange(position, position);
    setCaretState(position);
  }, [value]);

  const focus = useCallback(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const replaceValue = useCallback(
    (next: string, caretAt: number) => {
      pendingCaret.current = caretAt;
      onChange(next);
      if (next === value) {
        // No re-render follows, so place the caret now.
        pendingCaret.current = null;
        textareaRef.current?.setSelectionRange(caretAt, caretAt);
        setCaretState(caretAt);
      }
    },
    [onChange, value],
  );

  // Slash menu.
  const [slashDismissedFor, setSlashDismissedFor] = useState<string | null>(null);
  const [activeSlashId, setActiveSlashId] = useState<string | null>(null);
  const slashQuery = slashItems?.length ? slashMenuQuery(value, slashItems, slashDismissedFor) : null;
  const slashOpen = slashQuery !== null;
  const slashCommands = useMemo<ComposerCommand[]>(
    () =>
      (slashItems ?? []).map((item) => ({
        id: item.id,
        label: item.label,
        description: [item.description, item.hint].filter(Boolean).join(" · "),
        icon: item.icon ?? Slash,
        kind: item.insertText !== undefined ? ("insert" as const) : ("action" as const),
        insertText: item.insertText,
        group: item.group,
        keywords: item.keywords,
        action: () => {},
      })),
    [slashItems],
  );
  // The menu draws nothing when no command matches what was typed.
  const slashShown = useMemo(
    () => slashQuery !== null && filterSlashCommands(slashCommands, slashQuery).length > 0,
    [slashCommands, slashQuery],
  );
  const selectSlash = (command: ComposerCommand) => {
    const item = slashItems?.find((candidate) => candidate.id === command.id);
    if (!item) return;
    const inserted = item.insertText ?? "";
    replaceValue(inserted, inserted.length);
    setSlashDismissedFor(inserted || null);
    setActiveSlashId(null);
    onSlashSelect?.(item);
    // An action may open a picker of its own, so only inserted text takes focus back.
    if (inserted) requestAnimationFrame(focus);
  };

  // Mentions.
  const mentionToken = mentionItems ? activeMentionQuery(value, caret) : null;
  const mentionQuery = mentionToken?.query ?? null;
  const [mentionDismissedFor, setMentionDismissedFor] = useState<string | null>(null);
  const [activeMentionKey, setActiveMentionKey] = useState<string | null>(null);
  const mentionResult = useMemo(
    () => (mentionQuery === null || !mentionItems ? null : mentionItems(mentionQuery)),
    [mentionItems, mentionQuery],
  );
  const [asyncMentions, setAsyncMentions] = useState<{
    query: string;
    items: MentionItem[];
  } | null>(null);
  const mentionSequence = useRef(0);
  useEffect(() => {
    if (mentionResult === null || Array.isArray(mentionResult) || mentionQuery === null) return;
    const sequence = ++mentionSequence.current;
    const query = mentionQuery;
    mentionResult.then(
      (items) => {
        if (sequence !== mentionSequence.current) return;
        setAsyncMentions((current) =>
          current && current.query === query && sameMentions(current.items, items)
            ? current
            : { query, items },
        );
      },
      (error: unknown) => void logError("mention suggestions", error),
    );
  }, [mentionQuery, mentionResult]);
  const mentionResults: readonly MentionItem[] = Array.isArray(mentionResult)
    ? mentionResult
    : asyncMentions && asyncMentions.query === mentionQuery
      ? asyncMentions.items
      : [];
  const mentionOpen =
    mentionToken !== null && mentionResults.length > 0 && mentionDismissedFor !== value;
  const mentionEntries = useMemo<MentionEntry[]>(
    () =>
      mentionResults
        .filter((item) => item.kind !== "agent")
        .map((item) => ({ path: item.path ?? item.label, isDir: item.kind === "folder" })),
    [mentionResults],
  );
  const mentionAgents = useMemo<MentionAgent[]>(
    () =>
      mentionResults
        .filter((item) => item.kind === "agent")
        .map((item) => ({ id: item.id, label: item.label, detail: item.detail ?? "" })),
    [mentionResults],
  );
  const selectMention = (selection: MentionSelection) => {
    if (!mentionToken) return;
    const item =
      selection.kind === "agent"
        ? mentionResults.find((entry) => entry.kind === "agent" && entry.id === selection.target.id)
        : mentionResults.find(
            (entry) => entry.kind !== "agent" && (entry.path ?? entry.label) === selection.path,
          );
    const end = mentionTokenEnd(value, mentionToken.start);
    const next = value.slice(0, mentionToken.start) + selection.text + value.slice(end);
    replaceValue(next, mentionToken.start + selection.text.length);
    setActiveMentionKey(null);
    if (item) onMentionSelect?.(item);
    requestAnimationFrame(focus);
  };

  // Sending.
  const processing = attachments.some((item) => item.status === "processing");
  const ready = attachments.some((item) => item.status === "ready");
  const hasContent = value.trim() !== "" || ready;
  const canSubmit = !disabled && hasContent && !processing;
  const canQueue = Boolean(onQueue) && hasContent && !processing;

  const submit = () => {
    if (!canSubmit) return;
    if (value.trim()) rememberPrompt(composerId, value);
    recall.current = null;
    onSubmit();
  };
  const queue = () => {
    if (!canQueue) return;
    if (value.trim()) rememberPrompt(composerId, value);
    recall.current = null;
    onQueue?.();
  };

  const stepHistory = (direction: "prev" | "next"): boolean => {
    const list = history ?? promptHistory(composerId);
    const step = historyStep(list, recall.current, direction);
    if (!step) return false;
    recall.current = step.index;
    replaceValue(step.value, step.value.length);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isImeEnter(event)) return;
    if (mentionOpen && mentionMenuRef.current?.handleKeyDown(event)) return;
    if (slashOpen && slashMenuRef.current?.handleKeyDown(event)) return;
    const action = composerKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      busy,
      canQueue,
      canSubmit,
      empty: (textareaRef.current?.value ?? value) === "",
      recalling: recall.current !== null,
    });
    switch (action) {
      case "submit":
        event.preventDefault();
        submit();
        return;
      case "queue":
        event.preventDefault();
        queue();
        return;
      case "block":
        event.preventDefault();
        return;
      case "historyPrev":
      case "historyNext":
        if (stepHistory(action === "historyPrev" ? "prev" : "next")) event.preventDefault();
        return;
      default:
        return;
    }
  };

  const onTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    recall.current = null;
    setSlashDismissedFor(null);
    setActiveSlashId(null);
    setMentionDismissedFor(null);
    setActiveMentionKey(null);
    onChange(event.target.value);
    syncCaret(event.target);
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAddFiles) return;
    const files = pastedFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    onAddFiles(files);
  };

  // Drops: files from the computer, project paths from the file tree, and
  // Linux file drops through the native bridge.
  const [dropKind, setDropKind] = useState<ComposerDropKind | null>(null);
  const dragDepth = useRef(0);
  const acceptedDrop = (transfer: DataTransfer | null): ComposerDropKind | null => {
    const kind = composerDropKind(transfer, isLinux);
    if (kind === "tree") return onDropProjectPaths ? kind : null;
    if (kind) return onAddFiles ? kind : null;
    return null;
  };
  const showDropEffect = (event: DragEvent<HTMLDivElement>, kind: ComposerDropKind) => {
    event.dataTransfer.dropEffect =
      kind === "tree" ? dropEffectFor(event.dataTransfer.effectAllowed) : "copy";
  };
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    const kind = acceptedDrop(event.dataTransfer);
    if (!kind) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDropKind(kind);
    showDropEffect(event, kind);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    const kind = acceptedDrop(event.dataTransfer);
    if (!kind) return;
    event.preventDefault();
    showDropEffect(event, kind);
  };
  const onDragLeave = () => {
    if (dragDepth.current === 0) return;
    dragDepth.current -= 1;
    if (dragDepth.current === 0) setDropKind(null);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const kind = acceptedDrop(event.dataTransfer);
    dragDepth.current = 0;
    setDropKind(null);
    if (!kind) return;
    event.preventDefault();
    if (kind === "tree") {
      const path = treeDragPath(event.dataTransfer);
      if (path) onDropProjectPaths?.([path]);
      return;
    }
    if (kind === "files") {
      const files = Array.from(event.dataTransfer.files);
      if (files.length > 0) onAddFiles?.(files);
      return;
    }
    void takeNativeDrop()
      .then((items) => Promise.all(items.map((item) => item.read())))
      .then((files) => {
        if (files.length > 0) onAddFiles?.(files);
      })
      .catch((error: unknown) => void logError("read dropped files", error));
  };

  useImperativeHandle(
    ref,
    () => ({
      focus,
      setCaret(position: number) {
        const textarea = textareaRef.current;
        if (!textarea) return;
        const at = Math.max(0, Math.min(position, textarea.value.length));
        textarea.setSelectionRange(at, at);
        setCaretState(at);
      },
      insertText(text: string) {
        const textarea = textareaRef.current;
        const at =
          textarea && typeof textarea.selectionStart === "number"
            ? textarea.selectionStart
            : value.length;
        const before = value.slice(0, at);
        const lead = before && !/\s$/.test(before) ? " " : "";
        const inserted = `${lead}${text}`;
        replaceValue(before + inserted + value.slice(at), at + inserted.length);
        requestAnimationFrame(focus);
      },
      openFilePicker() {
        fileInputRef.current?.click();
      },
    }),
    [focus, replaceValue, value],
  );

  const activeDescendant =
    mentionOpen && activeMentionKey
      ? `ai-mention-${activeMentionKey}`
      : slashShown && activeSlashId
        ? `ai-slash-command-${activeSlashId}`
        : undefined;
  const sendLabel = labels?.send ?? t(($) => $.ai.composer.send);
  const stopLabel = labels?.stop ?? t(($) => $.ai.composer.stop);
  const stopTitle = labels?.stopTitle ?? t(($) => $.ai.composer.stopTitle);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the drop target wraps the composer; every control inside stays keyboard reachable
    <div
      ref={rootRef}
      data-chat-composer=""
      data-composer-id={composerId}
      className="relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <AttachmentChips items={attachments} onRemove={onRemoveAttachment} />
      <div
        ref={shellRef}
        className="relative rounded-[1.375rem] border bg-card px-3 pb-2 pt-2.5 shadow-sm transition-colors focus-within:border-ring"
      >
        <ComposerResizeHandle
          height={resting}
          min={minHeight}
          max={maxHeight}
          onPreview={setPreviewHeight}
          onCommit={(height) => {
            setPreviewHeight(null);
            setStoredHeight(clampComposerHeight(height, panelHeight, fontPx));
          }}
          onReset={() => {
            setPreviewHeight(null);
            setStoredHeight(COMPOSER_DEFAULT_HEIGHT);
          }}
        />
        {onAddFiles && (
          <Input
            ref={fileInputRef}
            type="file"
            multiple
            accept={accept ?? ATTACHMENT_ACCEPT}
            className="hidden"
            data-testid="ai-composer-file-input"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) onAddFiles(files);
            }}
          />
        )}
        {slashOpen && (
          <SlashCommandMenu
            ref={slashMenuRef}
            commands={slashCommands}
            query={slashQuery}
            onActiveCommandChange={setActiveSlashId}
            onClose={() => {
              setSlashDismissedFor(value);
              setActiveSlashId(null);
            }}
            onSelect={selectSlash}
          />
        )}
        {mentionOpen && (
          <MentionMenu
            ref={mentionMenuRef}
            entries={mentionEntries}
            agents={mentionAgents}
            onActiveEntryChange={setActiveMentionKey}
            onClose={() => {
              setMentionDismissedFor(value);
              setActiveMentionKey(null);
            }}
            onSelect={selectMention}
          />
        )}
        <div className="relative">
          {highlight && (
            <ComposerHighlight
              ref={highlightRef}
              text={value}
              skillIds={highlight.skillIds ?? EMPTY_SKILLS}
              paths={highlight.paths ?? EMPTY_PATHS}
              className="rounded-md px-0.5 py-2 text-sm"
            />
          )}
          <Textarea
            ref={textareaRef}
            data-tour={dataTour}
            role="combobox"
            aria-label={labels?.textarea}
            aria-autocomplete="list"
            aria-controls={
              mentionOpen ? "ai-mention-menu" : slashShown ? "ai-slash-command-menu" : undefined
            }
            aria-expanded={mentionOpen || slashShown}
            aria-haspopup="listbox"
            aria-activedescendant={activeDescendant}
            value={value}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onScroll={(event) => {
              const layer = highlightRef.current;
              if (layer) layer.scrollTop = event.currentTarget.scrollTop;
            }}
            onSelect={(event) => syncCaret(event.currentTarget)}
            onClick={(event) => syncCaret(event.currentTarget)}
            onKeyUp={(event) => syncCaret(event.currentTarget)}
            placeholder={placeholder}
            rows={1}
            style={{ minHeight: resting, maxHeight: growMax }}
            className={cn(
              // overflow-x-hidden: with the window zoomed past 100%, WebKit
              // gives the placeholder a wider scroll width than the box, and
              // the vertical scrolling turned that into a horizontal scrollbar.
              // Text still wraps at the visible width.
              "relative w-full resize-none overflow-y-auto overflow-x-hidden rounded-md border-0 bg-transparent px-0.5 text-sm shadow-none placeholder:text-muted-foreground/70",
              highlight && "text-transparent caret-foreground",
            )}
          />
        </div>
        {notice}
        <div
          data-testid={controlsTestId}
          className="ai-composer-controls mt-2 flex min-h-7 min-w-0 flex-nowrap items-center justify-between gap-0.5 [container-name:ai-composer] [container-type:inline-size]"
        >
          <div
            data-testid="ai-composer-controls-left"
            className="ai-composer-controls-left no-scrollbar flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto overflow-y-hidden"
          >
            {controls}
          </div>
          <div
            data-testid="ai-composer-controls-right"
            className="ai-composer-controls-right ml-auto flex shrink-0 flex-nowrap items-center gap-1"
          >
            {trailingControls}
            {busy && onStop ? (
              <Tooltip label={stopTitle}>
                <button
                  type="button"
                  onClick={onStop}
                  disabled={stopDisabled}
                  aria-label={stopLabel}
                  className="ai-composer-submit flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:opacity-90 disabled:opacity-40"
                >
                  <Square className="size-3.5 fill-current" />
                </button>
              </Tooltip>
            ) : (
              <button
                type="button"
                onClick={busy ? queue : submit}
                disabled={busy ? !canQueue : !canSubmit}
                aria-label={sendLabel}
                className="ai-composer-submit flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary disabled:opacity-40"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
        {dropKind && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.375rem] border-2 border-dashed border-primary/60 bg-primary/5 text-xs font-medium text-primary"
          >
            {dropKind === "tree"
              ? t(($) => $.ai.attachments.dropProjectFile)
              : t(($) => $.ai.attachments.dropFiles)}
          </div>
        )}
      </div>
    </div>
  );
});
