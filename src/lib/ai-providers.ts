/**
 * Re-export of the AI provider engine, which now lives in @openleaf/ai-core.
 * Kept here so existing `@/lib/ai-providers` imports (and their test mocks)
 * keep working while consumers migrate to the package directly.
 */
export * from "@openleaf/ai-core";
