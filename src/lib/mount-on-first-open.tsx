import { Suspense, useState, type ComponentType, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { closeAfterCrash } from "@/lib/close-after-crash";

export interface MountOnFirstOpenOptions {
  readonly useResetKey?: () => unknown;
  readonly fallback?: ReactNode;
}

const noResetKey = () => undefined;

export function mountOnFirstOpen(
  Surface: ComponentType,
  useOpen: () => boolean,
  close?: () => void,
  { useResetKey = noResetKey, fallback = null }: MountOnFirstOpenOptions = {},
) {
  const onError = close ? () => closeAfterCrash(close) : undefined;
  return function MountOnFirstOpen() {
    const open = useOpen();
    const key = useResetKey();
    const [seen, setSeen] = useState({ open, key, mounted: open, attempt: 0 });
    if (seen.open !== open || !Object.is(seen.key, key)) {
      const retry = open && (!seen.open || !Object.is(seen.key, key));
      setSeen({
        open,
        key,
        mounted: seen.mounted || open,
        attempt: retry ? seen.attempt + 1 : seen.attempt,
      });
    }
    if (!open && !seen.mounted) return null;
    return (
      <ErrorBoundary fallback={fallback} resetKey={seen.attempt} onError={onError}>
        <Suspense fallback={null}>
          <Surface />
        </Suspense>
      </ErrorBoundary>
    );
  };
}
