import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncTaskOutcome<Result> =
  | { readonly status: "done"; readonly result: Result }
  | { readonly status: "failed" }
  | { readonly status: "dropped" };

export interface AsyncTask<Result, Failure> {
  readonly result: Result | null;
  readonly busy: boolean;
  readonly error: Failure | null;
  readonly run: (task: (signal: AbortSignal) => Promise<Result>) => Promise<AsyncTaskOutcome<Result>>;
  readonly cancel: () => void;
  readonly reset: () => void;
  readonly setResult: (result: Result) => void;
}

interface TaskState<Result, Failure> {
  readonly result: Result | null;
  readonly busy: boolean;
  readonly error: Failure | null;
}

const IDLE: TaskState<never, never> = { result: null, busy: false, error: null };
const FAILED = { status: "failed" } as const;
const DROPPED = { status: "dropped" } as const;

export function useAsyncTask<Result, Failure = string>(
  toFailure: (error: unknown) => Failure | null,
): AsyncTask<Result, Failure> {
  const [state, setState] = useState<TaskState<Result, Failure>>(IDLE);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const toFailureRef = useRef(toFailure);
  toFailureRef.current = toFailure;

  const stop = useCallback(() => {
    request.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const cancel = useCallback(() => {
    stop();
    setState((current) => (current.busy ? { ...current, busy: false } : current));
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setState(IDLE);
  }, [stop]);

  const setResult = useCallback((result: Result) => {
    setState((current) => ({ ...current, result }));
  }, []);

  const run = useCallback(
    async (task: (signal: AbortSignal) => Promise<Result>): Promise<AsyncTaskOutcome<Result>> => {
      stop();
      const id = request.current;
      const abort = new AbortController();
      controller.current = abort;
      setState({ result: null, busy: true, error: null });
      try {
        const result = await task(abort.signal);
        if (id !== request.current) return DROPPED;
        controller.current = null;
        setState({ result, busy: false, error: null });
        return { status: "done", result };
      } catch (error_) {
        if (id !== request.current) return DROPPED;
        controller.current = null;
        const error = toFailureRef.current(error_);
        setState({ result: null, busy: false, error });
        return error === null ? DROPPED : FAILED;
      }
    },
    [stop],
  );

  return { ...state, run, cancel, reset, setResult };
}
