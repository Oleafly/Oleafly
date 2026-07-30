import { useCallback, useEffect } from "react";
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import {
  getEditorView,
  refreshEditorLints,
  type ProofreadingSurface,
} from "@oleafly/editor";
import { Button } from "@/components/ui/button";
import { retryProofreading } from "@/lib/proofreading/client";
import {
  PROOFREADING_PRESENTATION_PAGE_SIZE,
  useProofreadingStore,
} from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

export function ProofreadingStatus({
  path,
  surface,
}: {
  path: string | null;
  surface: ProofreadingSurface;
}) {
  const status = useProofreadingStore((state) => state[surface]);
  const setPresentationPage = useProofreadingStore(
    (state) => state.setPresentationPage,
  );
  const spellcheck = useSettingsStore((state) => state.spellcheck);
  const grammar = useSettingsStore((state) => state.harper);
  const relevant =
    Boolean(path) &&
    (spellcheck || grammar) &&
    status.phase !== "idle" &&
    status.identity?.path === path;

  const retry = useCallback(() => {
    retryProofreading(surface);
    if (surface === "source") {
      refreshEditorLints(getEditorView());
    }
    window.dispatchEvent(
      new CustomEvent("oleafly:proofreading-retry", {
        detail: { surface, path },
      }),
    );
  }, [path, surface]);

  const failure =
    relevant &&
    (status.phase === "unavailable" ||
      status.phase === "error");
  const informational =
    relevant &&
    (status.phase === "too_large" ||
      status.phase === "unsupported" ||
      status.phase === "partial");
  const notificationMessage =
    status.message ??
    (status.phase === "error"
      ? "Proofreading could not finish this document."
      : status.phase === "unavailable"
        ? "Offline proofreading is unavailable."
        : status.phase === "too_large"
          ? "Proofreading is paused because this document is too large."
          : status.phase === "unsupported"
            ? "Proofreading is not supported for this document format."
            : `Proofreading recovered ${status.diagnosticCount.toLocaleString()} findings, but one engine did not finish.`);

  useEffect(() => {
    const toastId = `proofreading:${surface}`;
    if (!failure && !informational) {
      toast.dismiss(toastId);
      return;
    }
    const options = {
      id: toastId,
      duration: Number.POSITIVE_INFINITY,
      action: failure
        ? {
            label: "Retry",
            onClick: retry,
          }
        : undefined,
    };
    if (failure) {
      toast.error(notificationMessage, options);
    } else {
      toast.warning(notificationMessage, options);
    }
    return () => {
      toast.dismiss(toastId);
    };
  }, [
    failure,
    informational,
    notificationMessage,
    retry,
    surface,
  ]);

  if (!relevant) return null;
  const pageCount = Math.max(
    1,
    Math.ceil(
      status.diagnosticCount /
        PROOFREADING_PRESENTATION_PAGE_SIZE,
    ),
  );
  const hasPages = pageCount > 1;
  if (
    (status.phase === "ready" &&
      !status.truncated &&
      !hasPages) ||
    status.phase === "loading" ||
    failure ||
    ((status.phase === "too_large" ||
      status.phase === "unsupported" ||
      status.phase === "partial") &&
      !hasPages)
  ) {
    return null;
  }

  const message =
    status.phase === "too_large"
      ? (status.message ??
        "Proofreading is paused because this document is too large.")
      : status.phase === "unsupported"
        ? (status.message ??
          "Proofreading is not supported for this document format.")
        : status.phase === "partial"
          ? (status.message ??
            `Proofreading recovered ${status.diagnosticCount.toLocaleString()} findings, but one engine did not finish.`)
          : (() => {
              const from =
                status.presentationPage *
                  PROOFREADING_PRESENTATION_PAGE_SIZE +
                1;
              const to = Math.min(
                status.diagnosticCount,
                from +
                  PROOFREADING_PRESENTATION_PAGE_SIZE -
                  1,
              );
              return `Showing issues ${from.toLocaleString()}–${to.toLocaleString()} of ${status.diagnosticCount.toLocaleString()}.`;
            })();

  const changePage = (page: number) => {
    setPresentationPage(surface, page);
    window.dispatchEvent(
      new CustomEvent(
        "oleafly:proofreading-presentation-changed",
        { detail: { surface, path } },
      ),
    );
  };

  return (
    <aside
      aria-label="Proofreading status"
      className="fixed right-3 top-[5.75rem] z-40 flex max-w-sm items-center gap-2 rounded-md border bg-background/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
      role="status"
      title={message}
    >
      <BookOpenCheck className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{message}</span>
      {hasPages && (
        <span className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Show previous proofreading issues"
            disabled={status.presentationPage === 0}
            onClick={() =>
              changePage(status.presentationPage - 1)
            }
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </Button>
          <span>
            <span className="sr-only">
              Page {status.presentationPage + 1} of {pageCount}
            </span>
            <span aria-hidden>
              {status.presentationPage + 1}/{pageCount}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Show next proofreading issues"
            disabled={status.presentationPage >= pageCount - 1}
            onClick={() =>
              changePage(status.presentationPage + 1)
            }
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </Button>
        </span>
      )}
    </aside>
  );
}
