export function findProductionDevHookTokens(source: string): string[];
export function assertNoProductionDevHookTokens(
  artifacts: Iterable<readonly [fileName: string, source: string]>,
): void;
export function findInlineStyleElementCount(source: string): number;
export function assertNoTauriStyleNonceTriggers(
  artifacts: Iterable<readonly [fileName: string, source: string]>,
): void;
export function findStyleSrcDirective(csp: string): string[] | null;
export function assertStyleSrcAllowsRuntimeStyles(csp: string): void;
