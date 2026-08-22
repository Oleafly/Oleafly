import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  getEditorView,
  refreshEditorLints,
  type ProofreadingSurface,
} from "@oleafly/editor";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";
import { retryProofreading } from "@/lib/proofreading/client";

/**
 * Renders nothing. Proofreading counts live in the Project info panel now — a
 * floating badge over the document was one more thing between the writer and
 * their page. What stays here is the part that has to interrupt: the toasts for
 * a checker that went offline, gave up on an oversized document, or failed and
 * needs a retry.
 */
export function ProofreadingNotifications({
  path,
  surface,
}: {
  path: string | null;
  surface: ProofreadingSurface;
}) {
  const status = useProofreadingStore((state) => state[surface]);
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

  return null;
}
