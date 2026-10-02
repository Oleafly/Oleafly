import { useCallback, useEffect, useRef, useState } from "react";

export type CopyStatus = "idle" | "copied" | "failed";

export const COPIED_FEEDBACK_MS = 1500;
export const COPY_FAILED_FEEDBACK_MS = 4000;

export interface CopyStatusOptions {
  readonly onError?: (error: unknown) => void;
  readonly copiedMs?: number;
  readonly failedMs?: number;
}

export interface CopyStatusControls {
  readonly status: CopyStatus;
  readonly copied: boolean;
  readonly copiedText: string | null;
  readonly copy: (text: string) => Promise<boolean>;
  readonly reset: () => void;
}

interface CopyState {
  readonly status: CopyStatus;
  readonly text: string | null;
}

const IDLE: CopyState = { status: "idle", text: null };

export function useCopyStatus(options: CopyStatusOptions = {}): CopyStatusControls {
  const [state, setState] = useState<CopyState>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearTimer = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setState(IDLE);
  }, [clearTimer]);

  const copy = useCallback(
    async (text: string) => {
      let status: CopyStatus = "copied";
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        status = "failed";
        optionsRef.current.onError?.(error);
      }
      const succeeded = status === "copied";
      if (!mounted.current) return succeeded;
      clearTimer();
      setState({ status, text: succeeded ? text : null });
      const { copiedMs = COPIED_FEEDBACK_MS, failedMs = COPY_FAILED_FEEDBACK_MS } = optionsRef.current;
      timer.current = setTimeout(
        () => {
          timer.current = null;
          setState(IDLE);
        },
        succeeded ? copiedMs : failedMs,
      );
      return succeeded;
    },
    [clearTimer],
  );

  return {
    status: state.status,
    copied: state.status === "copied",
    copiedText: state.text,
    copy,
    reset,
  };
}
