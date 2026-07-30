export interface LanguageServiceLifecycleActions {
  retry(): void;
  setup(): Promise<void> | void;
}

export const LANGUAGE_SERVICE_SETUP_FAILURE_REASON =
  "Language-service setup failed. Check your connection and try again.";

let activeActions: LanguageServiceLifecycleActions | null = null;

export function registerLanguageServiceLifecycleActions(
  actions: LanguageServiceLifecycleActions,
): () => void {
  activeActions = actions;
  return () => {
    if (activeActions === actions) activeActions = null;
  };
}

export function retryActiveLanguageService(): void {
  activeActions?.retry();
}

export async function setupActiveLanguageService(): Promise<void> {
  if (!activeActions) {
    throw new Error(LANGUAGE_SERVICE_SETUP_FAILURE_REASON);
  }
  try {
    await activeActions.setup();
  } catch {
    // The backend error can contain local paths or signed URLs. UI callers get
    // one stable, actionable message while the controller owns detailed state.
    throw new Error(LANGUAGE_SERVICE_SETUP_FAILURE_REASON);
  }
}
