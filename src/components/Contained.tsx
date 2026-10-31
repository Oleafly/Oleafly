import type { ReactNode } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { closeAfterCrash } from "@/lib/close-after-crash";

export function Contained({
  children,
  resetKey,
  close,
}: Readonly<{ children: ReactNode; resetKey?: unknown; close?: () => void }>) {
  return (
    <ErrorBoundary
      fallback={null}
      resetKey={resetKey}
      onError={close ? () => closeAfterCrash(close) : undefined}
    >
      {children}
    </ErrorBoundary>
  );
}
