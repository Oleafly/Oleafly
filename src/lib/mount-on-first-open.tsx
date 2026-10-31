import { Suspense, useState, type ComponentType } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { closeAfterCrash } from "@/lib/close-after-crash";

/**
 * Mounts a lazy surface the first time it opens, so its chunk stays off the
 * startup path, and keeps it mounted after that, so closing still animates and
 * a reopened modal keeps its state. Each gets its own boundary: one arriving
 * later must not blank one already on screen. The fallback stays null.
 */
export function mountOnFirstOpen(
  Surface: ComponentType,
  useOpen: () => boolean,
  close?: () => void,
) {
  const onError = close ? () => closeAfterCrash(close) : undefined;
  return function MountOnFirstOpen() {
    const open = useOpen();
    const [seen, setSeen] = useState({ open, openings: open ? 1 : 0 });
    if (seen.open !== open) {
      setSeen({ open, openings: open ? seen.openings + 1 : seen.openings });
    }
    if (!open && seen.openings === 0) return null;
    return (
      <ErrorBoundary fallback={null} resetKey={seen.openings} onError={onError}>
        <Suspense fallback={null}>
          <Surface />
        </Suspense>
      </ErrorBoundary>
    );
  };
}
