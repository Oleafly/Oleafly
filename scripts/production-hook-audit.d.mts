export function findProductionDevHookTokens(source: string): string[];
export function assertNoProductionDevHookTokens(
  artifacts: Iterable<readonly [fileName: string, source: string]>,
): void;
