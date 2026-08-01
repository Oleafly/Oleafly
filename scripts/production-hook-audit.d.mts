export function findProductionDevHookTokens(source: string): string[];
export function assertNoProductionDevHookTokens(
  artifacts: Iterable<readonly [fileName: string, source: string]>,
): void;
export function findInlineStyleElementCount(source: string): number;
export function assertNoTauriStyleNonceTriggers(
  artifacts: Iterable<readonly [fileName: string, source: string]>,
): void;
