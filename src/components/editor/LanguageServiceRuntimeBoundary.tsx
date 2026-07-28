import {
  lazy,
  Suspense,
  useEffect,
  type ComponentType,
} from "react";
import { toast } from "sonner";

export interface LanguageServiceRuntimeModule {
  LanguageServiceRuntime: ComponentType;
}

export type LanguageServiceRuntimeLoader =
  () => Promise<LanguageServiceRuntimeModule>;

export interface LanguageServiceRuntimeUnavailableProps {
  reload?: () => void;
}

/**
 * Static main-bundle fallback for a corrupt or unavailable deferred runtime.
 * It must not import the language-service chunk that just failed to load.
 */
export function LanguageServiceRuntimeUnavailable({
  reload = () => window.location.reload(),
}: LanguageServiceRuntimeUnavailableProps = {}) {
  useEffect(() => {
    const toastId = "language-service-runtime-unavailable";
    toast.error(
      "Language analysis is unavailable because its runtime could not load.",
      {
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Reload Oleafly",
          onClick: reload,
        },
      },
    );
    return () => {
      toast.dismiss(toastId);
    };
  }, [reload]);
  return null;
}

/**
 * Exposed for the deferred-load regression tests. Keeping the loader injectable
 * also makes the boundary's cancellation behavior explicit: React never mounts
 * a module that resolves after its boundary has already unmounted.
 */
export function createLanguageServiceRuntimeBoundary(
  loadRuntime: LanguageServiceRuntimeLoader,
) {
  const Runtime = lazy(async () => {
    const module = await loadRuntime();
    return { default: module.LanguageServiceRuntime };
  });

  return function DeferredLanguageServiceRuntime() {
    return (
      <Suspense fallback={null}>
        <Runtime />
      </Suspense>
    );
  };
}

export const LanguageServiceRuntimeBoundary =
  createLanguageServiceRuntimeBoundary(() =>
    import("./LanguageServiceRuntime"),
  );
