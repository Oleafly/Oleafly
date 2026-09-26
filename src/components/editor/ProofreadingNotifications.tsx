import { useCallback } from "react";
import {
  getEditorView,
  refreshEditorLints,
  type ProofreadingSurface,
} from "@oleafly/editor";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";
import { retryProofreading } from "@/lib/proofreading/client";
import {
  useSilentRetry,
  type SilentRetryPolicy,
} from "./LanguageServiceRuntimeBoundary";

export const PROOFREADING_RETRY_POLICY: SilentRetryPolicy = {
  baseMs: 2_000,
  maxMs: 300_000,
  limit: Number.POSITIVE_INFINITY,
};

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

  useSilentRetry({
    failing:
      relevant &&
      status.retryable !== false &&
      (status.phase === "unavailable" || status.phase === "error"),
    recovered:
      relevant && (status.phase === "ready" || status.phase === "partial"),
    retry,
    policy: PROOFREADING_RETRY_POLICY,
    scope: `proofreading ${surface}`,
    detail: status.message
      ? `${status.phase}: ${status.message}`
      : status.phase,
    resetKey: `${surface}:${path ?? ""}`,
  });

  return null;
}
