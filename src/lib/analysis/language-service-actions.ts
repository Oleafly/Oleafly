import {
  analysisReasonEnglishText,
  type AnalysisReason,
} from "./reason";

export interface LanguageServiceLifecycleActions {
  retry(): void;
  setup(): Promise<void> | void;
}

export const LANGUAGE_SERVICE_SETUP_FAILURE_ANALYSIS_REASON: AnalysisReason =
  { key: "setupFailed" };

export const LANGUAGE_SERVICE_SETUP_FAILURE_REASON =
  analysisReasonEnglishText(LANGUAGE_SERVICE_SETUP_FAILURE_ANALYSIS_REASON);

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
    throw new Error(LANGUAGE_SERVICE_SETUP_FAILURE_REASON);
  }
}
