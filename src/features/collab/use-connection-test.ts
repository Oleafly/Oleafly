import { useCallback, useRef, useState } from "react";
import { collabServerTest, type CollabConnectionCheck } from "@/lib/tauri";
import { collabErrorText } from "./errors";

export type ConnectionTest =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; checks: CollabConnectionCheck[] }
  | { state: "failed"; message: string };

export function useConnectionTest(url: string): {
  test: ConnectionTest;
  run: () => Promise<void>;
  reset: () => void;
} {
  const [test, setTest] = useState<ConnectionTest>({ state: "idle" });
  const runs = useRef(0);
  const run = useCallback(async () => {
    const current = ++runs.current;
    setTest({ state: "running" });
    try {
      const checks = await collabServerTest(url);
      if (current === runs.current) setTest({ state: "done", checks });
    } catch (error) {
      if (current === runs.current) setTest({ state: "failed", message: collabErrorText(error) });
    }
  }, [url]);
  // Forgets the last result, and any test still running, when the address
  // it was for is no longer the one in question.
  const reset = useCallback(() => {
    runs.current += 1;
    setTest({ state: "idle" });
  }, []);
  return { test, run, reset };
}
