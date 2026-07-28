import type {
  LanguageServiceClient,
  LanguageServiceKind,
  PositionEncoding,
} from "@/lib/language-service";

export interface InteractiveLanguageServiceDocument {
  path: string;
  uri: string;
  text: string;
  version: number;
}

export interface InteractiveLanguageServiceSession {
  owner: object;
  projectId: string;
  projectRevision: number;
  kind: LanguageServiceKind;
  positionEncoding: PositionEncoding;
  client: LanguageServiceClient;
  documentForPath(
    path: string,
  ): InteractiveLanguageServiceDocument | null;
}

type InteractiveLanguageServiceListener = () => void;

let activeSession: InteractiveLanguageServiceSession | null = null;
const listeners = new Set<InteractiveLanguageServiceListener>();

function publish(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // Editor consumers are optional projections of the runtime. One failed
      // surface listener must never interrupt language-service lifecycle
      // ownership or prevent the other surfaces from invalidating.
    }
  }
}

/**
 * Publishes the one synchronized language-service runtime that editor
 * surfaces may query. Ownership makes cleanup race-safe: teardown from an old
 * runtime can never clear a newer replacement.
 */
export function activateInteractiveLanguageService(
  session: InteractiveLanguageServiceSession,
): () => void {
  activeSession = session;
  publish();
  return () => {
    if (activeSession?.owner !== session.owner) return;
    activeSession = null;
    publish();
  };
}

export function currentInteractiveLanguageService():
  | InteractiveLanguageServiceSession
  | null {
  return activeSession;
}

export function subscribeInteractiveLanguageService(
  listener: InteractiveLanguageServiceListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
