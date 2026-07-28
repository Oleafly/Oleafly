import {
  BookOpenCheck,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import {
  getEditorView,
  refreshEditorLints,
  type ProofreadingSurface,
} from "@oleafly/editor";
import { Button } from "@/components/ui/button";
import { retryProofreading } from "@/lib/proofreading/client";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

export function ProofreadingStatus({
  path,
  surface,
}: {
  path: string | null;
  surface: ProofreadingSurface;
}) {
  const status = useProofreadingStore((state) => state[surface]);
  const spellcheck = useSettingsStore((state) => state.spellcheck);
  const grammar = useSettingsStore((state) => state.harper);

  if (
    !path ||
    (!spellcheck && !grammar) ||
    status.phase === "idle" ||
    status.identity?.path !== path
  ) {
    return null;
  }
  if (status.phase === "ready" && !status.truncated) return null;

  const retry = () => {
    retryProofreading(surface);
    if (surface === "source") {
      refreshEditorLints(getEditorView());
    }
    window.dispatchEvent(
      new CustomEvent("oleafly:proofreading-retry", {
        detail: { surface, path },
      }),
    );
  };

  if (status.phase === "loading") {
    // Loading is represented by the document startup/compile progress surface;
    // avoid a second transient toast-like banner in the PDF toolbar.
    return null;
  }

  if (status.phase === "unavailable") {
    return (
      <aside
        aria-label="Proofreading status"
        aria-live="polite"
        className="fixed right-3 top-[5.75rem] z-40 flex max-w-sm items-center gap-2 rounded-md border border-amber-500/40 bg-background/95 px-2.5 py-1.5 text-xs shadow-sm backdrop-blur"
        role="alert"
        title={status.message ?? undefined}
      >
        <TriangleAlert
          className="size-3.5 shrink-0 text-amber-500"
          aria-hidden
        />
        <span className="min-w-0 truncate">
          {status.message ?? "Offline proofreading is unavailable."}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={retry}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Retry
        </Button>
      </aside>
    );
  }

  const message =
    status.phase === "too_large"
      ? (status.message ??
        "Proofreading is paused because this document is too large.")
      : status.phase === "unsupported"
        ? (status.message ??
          "Proofreading is not supported for this document format.")
        : `Showing the first ${status.diagnosticCount.toLocaleString()} proofreading issues.`;

  return (
    <aside
      aria-label="Proofreading status"
      className="fixed right-3 top-[5.75rem] z-40 flex max-w-sm items-center gap-2 rounded-md border bg-background/95 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
      role="status"
      title={message}
    >
      <BookOpenCheck className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{message}</span>
    </aside>
  );
}
