import type { ProjectIntelligenceWorkerFactory } from "./worker-client";
import { createProjectIntelligenceWorker } from "./worker-core";
import type {
  ProjectIntelligenceWorkerRequest,
  ProjectIntelligenceWorkerResponse,
} from "./worker-protocol";

export interface InProcessWorkerOptions {
  readonly transfer?: (
    message: ProjectIntelligenceWorkerResponse,
  ) => ProjectIntelligenceWorkerResponse;
  readonly onPost?: (message: ProjectIntelligenceWorkerResponse) => void;
}

type Listener = (event: MessageEvent<unknown>) => void;

export function inProcessProjectIntelligenceWorkerFactory(
  options: InProcessWorkerOptions = {},
): ProjectIntelligenceWorkerFactory {
  return () => {
    const listeners = new Set<Listener>();
    let closed = false;
    const handle = createProjectIntelligenceWorker({
      postMessage: (message) => {
        options.onPost?.(message);
        const data = (options.transfer ?? structuredClone)(message);
        queueMicrotask(() => {
          if (closed) return;
          for (const listener of listeners) {
            listener({ data } as MessageEvent<unknown>);
          }
        });
      },
      close: () => {
        closed = true;
      },
    });
    return {
      postMessage: (message: ProjectIntelligenceWorkerRequest) => {
        const data = structuredClone(message);
        queueMicrotask(() => {
          if (!closed) handle(data);
        });
      },
      addEventListener: (type: string, listener: (event: never) => void) => {
        if (type === "message") listeners.add(listener as Listener);
      },
      terminate: () => {
        closed = true;
      },
    };
  };
}
