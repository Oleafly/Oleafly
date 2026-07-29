import {
  PROOFREADING_PROTOCOL_VERSION,
  isProofreadingWorkerResponse,
  sameProofreadingIdentity,
  type ProofreadingInput,
  type ProofreadingResult,
  type ProofreadingSurface,
  type ProofreadingWorkerRequest,
} from "@oleafly/editor";
import { useProofreadingStore } from "@/store/proofreading";
import { useSettingsStore } from "@/store/settings";

type ProofreadingDocumentInput = Omit<
  ProofreadingInput,
  "identity" | "preferences"
> & {
  /**
   * App-owned settings/dictionary identity. It is retained locally for an
   * exact synchronous presentation repaint and is never sent to the worker.
   */
  cacheKey?: string;
  identity: Omit<ProofreadingInput["identity"], "requestGeneration">;
  preferences: Omit<
    ProofreadingInput["preferences"],
    "dialect"
  > & {
    dialect?: ProofreadingInput["preferences"]["dialect"];
  };
};

interface WorkerLike {
  postMessage(message: ProofreadingWorkerRequest): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: Event) => void,
  ): void;
  terminate(): void;
}

interface PendingRequest {
  request: ProofreadingInput & {
    requestId: number;
    protocolVersion: typeof PROOFREADING_PROTOCOL_VERSION;
    type: "proofread";
  };
  cacheKey: string;
  lane: string;
  resolve: (result: ProofreadingResult) => void;
  reject: (error: ProofreadingWorkerError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface RetainedProofreading {
  cacheKey: string;
  projectId: string | null;
  path: string;
  text: string;
  mode: ProofreadingInput["mode"];
  result: ProofreadingResult;
}

export class ProofreadingWorkerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProofreadingWorkerError";
  }
}

const TIMEOUT_MS = 25_000;

function laneFor(
  identity: Omit<
    ProofreadingInput["identity"],
    "requestGeneration"
  >,
): string {
  return `${identity.surface}\0${identity.projectId ?? ""}\0${identity.path}`;
}

class ProofreadingWorkerClient {
  private worker: WorkerLike | null = null;
  private requestId = 0;
  private generation = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pendingByLane = new Map<string, number>();
  private readonly retained = new Map<
    ProofreadingSurface,
    RetainedProofreading
  >();

  proofread(
    input: ProofreadingDocumentInput,
  ): Promise<ProofreadingResult> {
    const { cacheKey = "", ...workerInput } = input;
    const lane = laneFor(workerInput.identity);
    const identity = {
      ...workerInput.identity,
      requestGeneration: ++this.generation,
    };
    const request = {
      protocolVersion: PROOFREADING_PROTOCOL_VERSION,
      type: "proofread" as const,
      requestId: ++this.requestId,
      ...workerInput,
      identity,
      preferences: {
        ...workerInput.preferences,
        dialect:
          workerInput.preferences.dialect ??
          useSettingsStore.getState().grammarDialect,
        dictionaryLocale:
          workerInput.preferences.dictionaryLocale ??
          useSettingsStore.getState().dictionaryLocale ??
          ({
            american: "en_US",
            british: "en_GB",
            australian: "en_AU",
            canadian: "en_CA",
            indian: "en_IN",
          } as const)[
            workerInput.preferences.dialect ??
              useSettingsStore.getState().grammarDialect
          ],
      },
    };

    this.supersedeLane(lane);
    useProofreadingStore.getState().begin(identity);

    let worker: WorkerLike;
    try {
      worker = this.ensureWorker();
    } catch {
      const error = new ProofreadingWorkerError(
        "Offline proofreading could not start.",
        "worker_unavailable",
        true,
      );
      useProofreadingStore.getState().fail(identity, error.message);
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(request.requestId);
        if (!pending) return;
        const error = new ProofreadingWorkerError(
          "Offline proofreading timed out and will restart on the next edit.",
          "timeout",
          true,
        );
        this.rejectRequest(request.requestId, error);
        useProofreadingStore
          .getState()
          .fail(request.identity, error.message);
        this.failWorker(
          new ProofreadingWorkerError(
            "Offline proofreading restarted after a timeout.",
            "worker_restarted",
            true,
          ),
        );
      }, TIMEOUT_MS);
      this.pending.set(request.requestId, {
        request,
        cacheKey,
        lane,
        resolve,
        reject,
        timeout,
      });
      this.pendingByLane.set(lane, request.requestId);
      try {
        worker.postMessage(request);
      } catch {
        const error = new ProofreadingWorkerError(
          "The document could not be sent to offline proofreading.",
          "post_message_failed",
          true,
        );
        this.rejectRequest(request.requestId, error);
        useProofreadingStore
          .getState()
          .fail(request.identity, error.message);
      }
    });
  }

  cancel(surface: ProofreadingSurface, path?: string) {
    for (const [requestId, pending] of this.pending) {
      if (
        pending.request.identity.surface === surface &&
        (!path || pending.request.identity.path === path)
      ) {
        this.rejectRequest(
          requestId,
          new ProofreadingWorkerError(
            "Proofreading was cancelled.",
            "cancelled",
            true,
          ),
        );
      }
    }
    const retained = this.retained.get(surface);
    if (retained && (!path || retained.path === path)) {
      this.retained.delete(surface);
    }
    useProofreadingStore.getState().clear(surface, path);
  }

  retry(surface: ProofreadingSurface) {
    const status = useProofreadingStore.getState()[surface];
    if (
      status.phase !== "unavailable" &&
      status.phase !== "error" &&
      status.phase !== "partial"
    ) {
      return;
    }
    this.worker?.terminate();
    this.worker = null;
    const restartError = new ProofreadingWorkerError(
      "Offline proofreading restarted.",
      "worker_restarted",
      true,
    );
    for (const pending of [...this.pending.values()]) {
      this.rejectRequest(pending.request.requestId, restartError);
      useProofreadingStore
        .getState()
        .clear(
          pending.request.identity.surface,
          pending.request.identity.path,
        );
    }
    this.retained.delete(surface);
    useProofreadingStore.getState().clear(surface);
  }

  dispose() {
    if (this.worker) {
      try {
        this.worker.postMessage({
          protocolVersion: PROOFREADING_PROTOCOL_VERSION,
          type: "dispose",
        });
      } catch {
        // Termination below is authoritative.
      }
      this.worker.terminate();
      this.worker = null;
    }
    const error = new ProofreadingWorkerError(
      "Offline proofreading was disposed.",
      "disposed",
      false,
    );
    for (const requestId of [...this.pending.keys()]) {
      this.rejectRequest(requestId, error);
    }
    this.retained.clear();
    useProofreadingStore.getState().clear("source");
    useProofreadingStore.getState().clear("visual");
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("./proofreading.worker.ts", import.meta.url),
      {
        type: "module",
        name: "oleafly-proofreading",
      },
    );
    worker.addEventListener("message", (event) => {
      if (this.worker === worker) this.handleMessage(event);
    });
    const fatal = () => {
      if (this.worker !== worker) return;
      this.failWorker(
        new ProofreadingWorkerError(
          "Offline proofreading stopped unexpectedly.",
          "worker_failed",
          true,
        ),
      );
    };
    worker.addEventListener("error", fatal);
    worker.addEventListener("messageerror", fatal);
    this.worker = worker;
    return worker;
  }

  private handleMessage(event: MessageEvent<unknown>) {
    if (!isProofreadingWorkerResponse(event.data)) {
      this.failWorker(
        new ProofreadingWorkerError(
          "Offline proofreading returned an invalid response.",
          "protocol_error",
          true,
        ),
      );
      return;
    }
    const pending = this.pending.get(event.data.requestId);
    if (!pending) return;
    if (
      !sameProofreadingIdentity(
        pending.request.identity,
        event.data.identity,
      )
    ) {
      this.failWorker(
        new ProofreadingWorkerError(
          "Offline proofreading returned a stale response.",
          "protocol_error",
          true,
        ),
      );
      return;
    }
    if (
      event.data.type === "result" &&
      event.data.diagnostics.some(
        (diagnostic) =>
          diagnostic.to > pending.request.text.length,
      )
    ) {
      this.failWorker(
        new ProofreadingWorkerError(
          "Offline proofreading returned an out-of-range diagnostic.",
          "protocol_error",
          true,
        ),
      );
      return;
    }
    this.finishRequest(event.data.requestId);
    if (event.data.type === "error") {
      const error = new ProofreadingWorkerError(
        event.data.error.message,
        event.data.error.code,
        event.data.error.retryable,
      );
      useProofreadingStore
        .getState()
        .fail(
          event.data.identity,
          error.message,
          event.data.error.code === "initialization_failed"
            ? "unavailable"
            : "error",
        );
      pending.reject(error);
      return;
    }
    // Publish the exact immutable result before the observable store becomes
    // ready. Presentation-page changes may be dispatched synchronously by a
    // store consumer; they must never observe "ready" without also being able
    // to repaint from the matching worker result.
    this.retained.set(event.data.identity.surface, {
      cacheKey: pending.cacheKey,
      projectId: pending.request.identity.projectId,
      path: pending.request.identity.path,
      text: pending.request.text,
      mode: pending.request.mode,
      result: event.data,
    });
    useProofreadingStore.getState().complete(event.data);
    pending.resolve(event.data);
  }

  getRetained(input: {
    cacheKey: string;
    projectId: string | null;
    path: string;
    text: string;
    mode: ProofreadingInput["mode"];
    surface: ProofreadingSurface;
  }): ProofreadingResult | null {
    const retained = this.retained.get(input.surface);
    if (
      !retained ||
      retained.cacheKey !== input.cacheKey ||
      retained.projectId !== input.projectId ||
      retained.path !== input.path ||
      retained.text !== input.text ||
      retained.mode !== input.mode
    ) {
      return null;
    }
    return retained.result;
  }

  private supersedeLane(lane: string) {
    const previous = this.pendingByLane.get(lane);
    if (previous === undefined) return;
    this.rejectRequest(
      previous,
      new ProofreadingWorkerError(
        "A newer proofreading request replaced this one.",
        "superseded",
        true,
      ),
    );
  }

  private finishRequest(requestId: number): PendingRequest | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);
    if (this.pendingByLane.get(pending.lane) === requestId) {
      this.pendingByLane.delete(pending.lane);
    }
    return pending;
  }

  private rejectRequest(
    requestId: number,
    error: ProofreadingWorkerError,
  ) {
    const pending = this.finishRequest(requestId);
    pending?.reject(error);
  }

  private failWorker(error: ProofreadingWorkerError) {
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.pending.values()];
    for (const request of pending) {
      useProofreadingStore
        .getState()
        .fail(request.request.identity, error.message);
      this.rejectRequest(request.request.requestId, error);
    }
  }
}

const client = new ProofreadingWorkerClient();

if (import.meta.hot) {
  import.meta.hot.dispose(() => client.dispose());
}

export function proofreadDocument(
  input: ProofreadingDocumentInput,
): Promise<ProofreadingResult> {
  return client.proofread(input);
}

export function getRetainedProofreadingResult(input: {
  cacheKey: string;
  projectId: string | null;
  path: string;
  text: string;
  mode: ProofreadingInput["mode"];
  surface: ProofreadingSurface;
}): ProofreadingResult | null {
  return client.getRetained(input);
}

export function cancelProofreading(
  surface: ProofreadingSurface,
  path?: string,
) {
  client.cancel(surface, path);
}

export function retryProofreading(surface: ProofreadingSurface) {
  client.retry(surface);
}
