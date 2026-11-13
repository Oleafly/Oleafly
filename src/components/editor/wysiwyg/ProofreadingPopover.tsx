import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/core";
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { i18n } from "@/i18n";
import { suggestSpelling } from "@/lib/proofreading/client";
import { currentDictionaryLocale } from "@/lib/proofreading/effective-locale";
import { Button } from "@/components/ui/button";
import { useDismiss } from "@/components/ui/use-dismiss";
import {
  applyVisualProofreadingSuggestion,
  ignoreVisualProofreadingIssue,
  isVisualProofreadingIssueCurrent,
  type VisualProofreadingIssue,
  visualProofreadingIssueGroup,
  visualProofreadingMessage,
} from "./proofreading";

interface ProofreadingPopoverPosition {
  left: number;
  top: number;
}

function suggestionLabel(
  suggestion: VisualProofreadingIssue["suggestions"][number],
): string {
  if (suggestion.kind === 1) return i18n.t(($) => $.editor.visual.suggestionRemove);
  if (suggestion.kind === 2) {
    return suggestion.text
      ? i18n.t(($) => $.editor.visual.suggestionInsertText, { text: suggestion.text })
      : i18n.t(($) => $.editor.visual.suggestionInsert);
  }
  return suggestion.text
    ? i18n.t(($) => $.editor.visual.suggestionReplaceText, { text: suggestion.text })
    : i18n.t(($) => $.editor.visual.suggestionReplace);
}

function suggestionIcon(
  kind: VisualProofreadingIssue["suggestions"][number]["kind"],
) {
  if (kind === 1) return Trash2;
  if (kind === 2) return Plus;
  return Check;
}

function nextActionIndex(
  key: string,
  current: number,
  count: number,
): number {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (Math.max(current, -1) + 1) % count;
  return (current <= 0 ? count : current) - 1;
}

export function ProofreadingPopover({
  editor,
  issue,
  locale,
  onClose,
  onNavigate,
}: Readonly<{
  editor: Editor;
  issue: VisualProofreadingIssue;
  locale?: string;
  onClose: () => void;
  onNavigate: (issue: VisualProofreadingIssue) => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const panelRef = useRef<HTMLDialogElement>(null);
  const [position, setPosition] =
    useState<ProofreadingPopoverPosition | null>(null);
  const issueGroup = visualProofreadingIssueGroup(editor, issue);
  const editable = editor.isEditable;
  const deferred =
    editable &&
    issue.source === "hunspell" &&
    issue.suggestionsDeferred === true &&
    issue.suggestions.length === 0;
  const [loaded, setLoaded] = useState<{
    id: string;
    suggestions: VisualProofreadingIssue["suggestions"];
  } | null>(null);
  const suggestionLocale = locale ?? currentDictionaryLocale();
  useEffect(() => {
    if (!deferred) return;
    let live = true;
    void suggestSpelling(issue.word, suggestionLocale).then(
      (found) => {
        if (live) setLoaded({ id: issue.id, suggestions: found });
      },
    );
    return () => {
      live = false;
    };
  }, [deferred, issue.id, issue.word, suggestionLocale]);
  const findingSuggestions = deferred && loaded?.id !== issue.id;
  const offered =
    deferred && loaded?.id === issue.id
      ? loaded.suggestions
      : issue.suggestions;
  const distinct = [
    ...new Map(
      offered.map((suggestion) => [
        `${suggestion.kind}:${suggestion.text}`,
        suggestion,
      ]),
    ).values(),
  ];
  const suggestions = editable ? distinct.slice(0, 8) : [];

  useLayoutEffect(() => {
    const place = () => {
      if (!isVisualProofreadingIssueCurrent(editor, issue)) {
        onClose();
        return;
      }
      const panel = panelRef.current;
      if (!panel) return;
      try {
        const start = editor.view.coordsAtPos(issue.from);
        const end = editor.view.coordsAtPos(issue.to);
        if (
          Math.max(start.bottom, end.bottom) < 0 ||
          Math.min(start.top, end.top) > window.innerHeight ||
          Math.max(start.right, end.right) < 0 ||
          Math.min(start.left, end.left) > window.innerWidth
        ) {
          onClose();
          return;
        }
        const width = panel.offsetWidth || 320;
        const height = panel.offsetHeight || 240;
        const margin = 8;
        const gap = 8;
        const sameLine = Math.abs(start.top - end.top) < 4;
        const anchorLeft = sameLine
          ? (start.left + end.right) / 2
          : start.left;
        let left = anchorLeft - width / 2;
        let top = Math.max(start.bottom, end.bottom) + gap;
        if (top + height > window.innerHeight - margin) {
          top = Math.min(start.top, end.top) - height - gap;
        }
        left = Math.max(
          margin,
          Math.min(left, window.innerWidth - width - margin),
        );
        top = Math.max(
          margin,
          Math.min(top, window.innerHeight - height - margin),
        );
        setPosition({ left, top });
      } catch {
        onClose();
      }
    };

    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [editor, issue, onClose]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (
        panelRef.current?.dataset.proofreadingPanelIssue !== issue.id
      ) {
        return;
      }
      const firstAction =
        panelRef.current?.querySelector<HTMLButtonElement>(
          '[data-proofreading-primary="true"]',
        );
      (firstAction ?? panelRef.current)?.focus({
        preventScroll: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [issue.id]);

  useDismiss(true, [panelRef], onClose, { ignore: "[data-proofreading-issue]" });

  const closeAndFocus = () => {
    onClose();
    requestAnimationFrame(() => editor.view.focus());
  };

  const applySuggestion = (
    suggestion: VisualProofreadingIssue["suggestions"][number],
  ) => {
    if (
      applyVisualProofreadingSuggestion(editor, issue, suggestion)
    ) {
      onClose();
    }
  };

  const ignore = (scope: "project" | "global") => {
    if (ignoreVisualProofreadingIssue(editor, issue, scope)) {
      onClose();
    }
  };

  const moveActionFocus = (
    event: ReactKeyboardEvent<HTMLDialogElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    const actions = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (actions.length === 0) return;
    const active = document.activeElement;
    const current = actions.indexOf(active as HTMLButtonElement);
    const next = nextActionIndex(event.key, current, actions.length);
    event.preventDefault();
    actions[next]?.focus({ preventScroll: true });
  };

  return createPortal(
    <dialog
      ref={panelRef}
      open
      aria-label={t(($) => $.editor.visual.proofreadingPanel)}
      data-proofreading-panel-issue={issue.id}
      tabIndex={-1}
      className="fixed z-[70] m-0 w-80 max-w-[calc(100vw-1rem)] rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-xl"
      style={
        position
          ? { left: position.left, top: position.top }
          : { left: -10_000, top: -10_000 }
      }
      onKeyDown={moveActionFocus}
    >
      <div className="flex items-start gap-2">
        <BookOpenCheck
          className="mt-0.5 size-4 shrink-0 text-amber-500"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
            {issue.source === "hunspell"
              ? t(($) => $.editor.visual.spelling)
              : t(($) => $.editor.visual.grammarAndStyle)}
          </div>
          <p className="mt-1 text-sm leading-snug">
            {visualProofreadingMessage(issue)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 size-7 shrink-0"
          aria-label={t(($) => $.editor.visual.closeProofreading)}
          onClick={closeAndFocus}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>

      {issueGroup && issueGroup.count > 1 && (
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
          >
            {t(($) => $.editor.visual.findingPosition, {
              index: issueGroup.index + 1,
              count: issueGroup.count,
            })}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t(($) => $.editor.visual.previousFinding)}
              disabled={!issueGroup.previous}
              onClick={() => {
                if (issueGroup.previous) {
                  onNavigate(issueGroup.previous);
                }
              }}
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t(($) => $.editor.visual.nextFinding)}
              disabled={!issueGroup.next}
              onClick={() => {
                if (issueGroup.next) onNavigate(issueGroup.next);
              }}
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {findingSuggestions && (
        <p
          className="mt-2 px-2 text-xs text-muted-foreground"
          aria-live="polite"
        >
          {t(($) => $.editor.visual.findingSuggestions)}
        </p>
      )}

      {suggestions.length > 0 && (
        <fieldset
          className="mt-2 grid max-h-40 gap-1 overflow-y-auto"
        >
          <legend className="sr-only">{t(($) => $.editor.visual.suggestedFixes)}</legend>
          {suggestions.map((suggestion, index) => {
            const Icon = suggestionIcon(suggestion.kind);
            return (
              <Button
                key={`${suggestion.kind}:${suggestion.text}`}
                type="button"
                variant="ghost"
                size="sm"
                data-proofreading-primary={
                  index === 0 ? "true" : undefined
                }
                className="h-auto min-h-8 justify-start whitespace-normal px-2 py-1.5 text-left font-normal"
                onClick={() => applySuggestion(suggestion)}
              >
                <Icon
                  className="size-3.5 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="min-w-0 break-words">
                  {suggestionLabel(suggestion)}
                </span>
              </Button>
            );
          })}
        </fieldset>
      )}

      <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
        {issue.projectId && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            data-proofreading-primary={
              suggestions.length === 0 ? "true" : undefined
            }
            onClick={() => ignore("project")}
          >
            {t(($) => $.editor.visual.ignoreInProject)}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          data-proofreading-primary={
            suggestions.length === 0 && !issue.projectId
              ? "true"
              : undefined
          }
          onClick={() => ignore("global")}
        >
          {t(($) => $.editor.visual.ignoreEverywhere)}
        </Button>
      </div>
      <p className="sr-only">{t(($) => $.editor.visual.keyboardHint)}</p>
    </dialog>,
    document.body,
  );
}
