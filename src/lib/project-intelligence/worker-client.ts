import {
  isProjectIntelligenceWorkerResponse,
  sameProjectIntelligenceIdentity,
  type AnalyzeProjectIntelligenceRequest,
  type ProjectIntelligenceWorkerRequest,
} from "./worker-protocol";
import {
  PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
  type ProjectIntelligenceSnapshot,
} from "./types";

export type ProjectIntelligenceAnalyzeInput = Omit<
  AnalyzeProjectIntelligenceRequest,
  "protocolVersion" | "type" | "requestId"
>;

interface ProjectIntelligenceWorkerLike {
  postMessage(message: ProjectIntelligenceWorkerRequest): void;
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

export type ProjectIntelligenceWorkerFactory =
  () => ProjectIntelligenceWorkerLike;

interface PendingRequest {
  readonly request: AnalyzeProjectIntelligenceRequest;
  readonly resolve: (snapshot: ProjectIntelligenceSnapshot) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class ProjectIntelligenceWorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "ProjectIntelligenceWorkerError";
    this.code = code;
    this.retryable = retryable;
  }
}

const defaultWorkerFactory: ProjectIntelligenceWorkerFactory = () =>
  new Worker(
    new URL(
      "./project-intelligence.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "oleafly-project-intelligence",
    },
  );

export class ProjectIntelligenceWorkerClient {
  private worker: ProjectIntelligenceWorkerLike | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private requestId = 0;
  private disposed = false;

  constructor(
    private readonly workerFactory: ProjectIntelligenceWorkerFactory =
      defaultWorkerFactory,
    private readonly timeoutMs = 15_000,
  ) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError(
        "Project-intelligence timeout must be positive.",
      );
    }
  }

  analyze(
    input: ProjectIntelligenceAnalyzeInput,
  ): Promise<ProjectIntelligenceSnapshot> {
    if (this.disposed) {
      return Promise.reject(
        new ProjectIntelligenceWorkerError(
          "Project-intelligence worker is disposed.",
          "disposed",
          false,
        ),
      );
    }
    const request: AnalyzeProjectIntelligenceRequest = {
      protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
      type: "analyze",
      requestId: ++this.requestId,
      ...input,
    };
    let worker: ProjectIntelligenceWorkerLike;
    try {
      worker = this.ensureWorker();
    } catch {
      return Promise.reject(
        new ProjectIntelligenceWorkerError(
          "Project-intelligence worker is unavailable.",
          "worker_unavailable",
          true,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(request.requestId)) return;
        reject(
          new ProjectIntelligenceWorkerError(
            "Project intelligence timed out.",
            "timeout",
            true,
          ),
        );
        this.failWorker(
          new ProjectIntelligenceWorkerError(
            "Project-intelligence worker was restarted after a timeout.",
            "worker_restarted",
            true,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(request.requestId, {
        request,
        resolve,
        reject,
        timeout,
      });
      try {
        worker.postMessage(request);
      } catch {
        clearTimeout(timeout);
        this.pending.delete(request.requestId);
        reject(
          new ProjectIntelligenceWorkerError(
            "Could not send project analysis to the worker.",
            "post_message_failed",
            true,
          ),
        );
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.worker) {
      try {
        this.worker.postMessage({
          protocolVersion: PROJECT_INTELLIGENCE_PROTOCOL_VERSION,
          type: "dispose",
        });
      } catch {
        // Termination below is authoritative.
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.rejectPending(
      new ProjectIntelligenceWorkerError(
        "Project-intelligence worker was disposed.",
        "disposed",
        false,
      ),
    );
  }

  private ensureWorker(): ProjectIntelligenceWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    worker.addEventListener("message", (event) =>
      this.handleMessage(event),
    );
    const fatal = () =>
      this.failWorker(
        new ProjectIntelligenceWorkerError(
          "Project-intelligence worker failed.",
          "worker_failed",
          true,
        ),
      );
    worker.addEventListener("error", fatal);
    worker.addEventListener("messageerror", fatal);
    this.worker = worker;
    return worker;
  }

  private handleMessage(event: MessageEvent<unknown>): void {
    if (!isProjectIntelligenceWorkerResponse(event.data)) {
      this.failWorker(
        new ProjectIntelligenceWorkerError(
          "Project-intelligence worker returned a malformed response.",
          "protocol_error",
          true,
        ),
      );
      return;
    }
    const pending = this.pending.get(event.data.requestId);
    if (!pending) return;
    if (
      !sameProjectIntelligenceIdentity(
        pending.request.identity,
        event.data.identity,
      )
    ) {
      this.failWorker(
        new ProjectIntelligenceWorkerError(
          "Project-intelligence response identity did not match its request.",
          "protocol_error",
          true,
        ),
      );
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(event.data.requestId);
    if (event.data.type === "error") {
      pending.reject(
        new ProjectIntelligenceWorkerError(
          event.data.error.message,
          event.data.error.code,
          event.data.error.retryable,
        ),
      );
      return;
    }
    if (
      !sameProjectIntelligenceIdentity(
        event.data.identity,
        event.data.snapshot.identity,
      )
    ) {
      this.failWorker(
        new ProjectIntelligenceWorkerError(
          "Project-intelligence snapshot identity was malformed.",
          "protocol_error",
          true,
        ),
      );
      return;
    }
    pending.resolve(event.data.snapshot);
  }

  private failWorker(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
