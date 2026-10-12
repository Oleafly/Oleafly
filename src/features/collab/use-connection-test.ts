import { useCallback, useState } from "react";
import { collabServerTest, type CollabConnectionCheck } from "@/lib/tauri";
import { collabErrorCode, collabErrorMessage } from "./errors";

export type ConnectionTest =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; checks: CollabConnectionCheck[] }
  | { state: "failed"; message: string };

export function useConnectionTest(url: string): { test: ConnectionTest; run: () => Promise<void> } {
  const [test, setTest] = useState<ConnectionTest>({ state: "idle" });
  const run = useCallback(async () => {
    setTest({ state: "running" });
    try {
      setTest({ state: "done", checks: await collabServerTest(url) });
    } catch (error) {
      setTest({ state: "failed", message: collabErrorMessage(collabErrorCode(error)) });
    }
  }, [url]);
  return { test, run };
}
