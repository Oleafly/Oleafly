import { lazy, Suspense, type ComponentType } from "react";

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
  return (
    <aside
      aria-label="Language analysis status"
      className="fixed right-3 top-14 z-50 flex max-w-sm items-center gap-2 rounded-md border border-amber-500/40 bg-background/95 p-2 text-xs shadow-md backdrop-blur"
      role="alert"
    >
      <span className="min-w-0 flex-1">
        Language analysis is unavailable because its runtime could not
        load.
      </span>
      <button
        type="button"
        className="inline-flex min-h-7 items-center rounded border px-2 font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={reload}
      >
        Reload Oleafly
      </button>
    </aside>
  );
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
