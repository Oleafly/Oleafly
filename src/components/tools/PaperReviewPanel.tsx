import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Flame,
  HandHeart,
  Loader2,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  runPaperReview,
  type PaperReviewMode,
} from "@/lib/document-citation";
import { useFilesStore } from "@/store/files";
import { useDocumentCitationUiStore } from "@/store/document-citation-ui";
import { useSettingsStore } from "@/store/settings";
import { getConfig } from "@/lib/tauri";
import { hasConfiguredProvider } from "@/lib/ai-providers";
import { E2E_HOOKS } from "@/lib/e2e-flags";

function isLatexPath(path: string): boolean {
  return path.toLowerCase().endsWith(".tex");
}

function withOccurrenceKeys(values: string[]) {
  const counts = new Map<string, number>();
  return values.map((value) => {
    const occurrence = counts.get(value) ?? 0;
    counts.set(value, occurrence + 1);
    return { key: `${value}\u0000${occurrence}`, value };
  });
}

function ReviewMarkdown({ text }: { text: string }) {
  const blocks = withOccurrenceKeys(text.split(/\n{2,}/));
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map(({ key, value: block }) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        if (/^#{1,3}\s+/.test(trimmed)) {
          const level = (trimmed.match(/^#+/)?.[0].length ?? 1) as 1 | 2 | 3;
          const title = trimmed.replace(/^#{1,3}\s+/, "");
          const Tag = (`h${Math.min(level + 1, 4)}` as "h2" | "h3" | "h4");
          return (
            <Tag key={key} className="font-semibold tracking-tight">
              {title}
            </Tag>
          );
        }
        if (/^[-*]\s+/m.test(trimmed)) {
          const items = withOccurrenceKeys(
            trimmed.split(/\n/).filter((line) => line.trim()),
          );
          return (
            <ul key={key} className="list-disc space-y-1 pl-5">
              {items.map(({ key: itemKey, value: line }) => (
                <li key={itemKey}>
                  {line.replace(/^[-*]\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1")}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={key} className="whitespace-pre-wrap">
            {trimmed.replace(/\*\*(.+?)\*\*/g, "$1")}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Dedicated Friendly / Fire paper review surface (OpenLeaf Review tab parity).
 */
export function PaperReviewPanel() {
  const offline = useSettingsStore((state) => state.offline);
  const activePath = useFilesStore((state) => state.activePath);
  const mainDoc = useFilesStore((state) => state.mainDoc);
  const files = useFilesStore((state) => state.files);

  const [mode, setMode] = useState<PaperReviewMode>("friendly");
  const [reviewing, setReviewing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [selectionSource, setSelectionSource] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const override =
      useDocumentCitationUiStore.getState().consumeSelectionOverride();
    if (override) setSelectionSource(override);
  }, []);

  useEffect(() => {
    const apply = (configured: boolean) => setProviderReady(configured);
    const check = (event?: Event) => {
      const detail = (event as CustomEvent | undefined)?.detail;
      if (detail && typeof detail === "object") {
        try {
          apply(hasConfiguredProvider(detail as never));
          return;
        } catch {
          // fall through
        }
      }
      void getConfig()
        .then((config) => apply(hasConfiguredProvider(config)))
        .catch(() => apply(false));
    };
    check();
    window.addEventListener("oleafly:ai-config-changed", check);
    return () => {
      window.removeEventListener("oleafly:ai-config-changed", check);
      abortRef.current?.abort();
    };
  }, []);

  const sourceText = useMemo(() => {
    if (selectionSource) return selectionSource;
    if (activePath && isLatexPath(activePath)) {
      const content = files[activePath]?.content;
      if (content != null) return content;
    }
    return files[mainDoc]?.content ?? "";
  }, [activePath, files, mainDoc, selectionSource]);

  const canReview =
    !offline &&
    sourceText.trim().length > 0 &&
    !reviewing &&
    providerReady === true;

  const runReview = useCallback(async () => {
    if (!canReview) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setReviewing(true);
    setError(null);
    setText("");
    try {
      await runPaperReview({
        mode,
        paperText: sourceText,
        signal: controller.signal,
        onChunk: (full) => {
          setText(full);
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        },
      });
    } catch (err) {
      if (
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        // cancelled
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setReviewing(false);
    }
  }, [canReview, mode, sourceText]);

  const cancel = () => abortRef.current?.abort();
  const clear = () => {
    setText("");
    setError(null);
  };

  // E2E / DEV: seed review output without calling a live model.
  useEffect(() => {
    if (!E2E_HOOKS) return;
    const w = window as unknown as {
      __e2ePaperReview?: {
        seed: (mode: PaperReviewMode, body: string) => void;
        getText: () => string;
      };
    };
    w.__e2ePaperReview = {
      seed: (nextMode, body) => {
        setMode(nextMode);
        setText(body);
        setError(null);
        setReviewing(false);
      },
      getText: () => text,
    };
    return () => {
      delete w.__e2ePaperReview;
    };
  }, [text]);

  return (
    <div
      data-testid="paper-review-panel"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex gap-1 rounded-lg border p-1"
            data-testid="paper-review-mode"
          >
            <Button
              type="button"
              size="sm"
              variant={mode === "friendly" ? "secondary" : "ghost"}
              data-testid="paper-review-mode-friendly"
              onClick={() => setMode("friendly")}
              disabled={reviewing}
            >
              <HandHeart className="size-3.5" />
              Friendly
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "fire" ? "secondary" : "ghost"}
              data-testid="paper-review-mode-fire"
              className={cn(
                mode === "fire" && "text-orange-700 dark:text-orange-300",
              )}
              onClick={() => setMode("fire")}
              disabled={reviewing}
            >
              <Flame className="size-3.5" />
              Fire
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {reviewing ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="paper-review-cancel"
                onClick={cancel}
              >
                <Square className="size-3.5" />
                Cancel
              </Button>
            ) : null}
            {text && !reviewing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="paper-review-clear"
                onClick={clear}
              >
                <Trash2 className="size-3.5" />
                Clear
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              data-testid="paper-review-run"
              disabled={!canReview}
              onClick={() => void runReview()}
            >
              {reviewing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {reviewing ? "Reviewing…" : "Review paper"}
            </Button>
          </div>
        </div>

        {offline && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Offline mode is on. Paper review needs a configured AI provider.
          </div>
        )}
        {providerReady === false && !offline && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Configure an AI provider in Settings before reviewing.
          </div>
        )}
        {!sourceText.trim() && (
          <p className="text-sm text-muted-foreground">
            Open a LaTeX project (or use Find citations in document from the
            editor) so there is paper text to review.
          </p>
        )}
        {error && (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            data-testid="paper-review-error"
          >
            {error}
          </div>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto border-t bg-background"
        data-testid="paper-review-content"
      >
        <div className="prose prose-sm dark:prose-invert mx-auto max-w-3xl px-4 py-6 sm:px-6">
          {!text && !reviewing ? (
            <p className="text-muted-foreground not-prose text-sm">
              {mode === "friendly"
                ? "Friendly mode is a constructive mentor: strengths first, then specific suggestions."
                : "Fire mode is Reviewer #2: rigorous, claim-stressing, technically precise."}
            </p>
          ) : (
            <ReviewMarkdown text={text} />
          )}
          {reviewing && !text ? (
            <p className="text-muted-foreground not-prose text-sm">
              Reviewing your paper…
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
