interface WorkerState {
  config?: { coverage?: { enabled?: boolean } };
}

function coverageOn(): boolean {
  const worker = (globalThis as { __vitest_worker__?: WorkerState }).__vitest_worker__;
  return worker?.config?.coverage?.enabled ?? process.env.OLEAFLY_COVERAGE_SHARD === "1";
}

export function propertySeeds(full: number, underCoverage: number): number {
  const asked = Number.parseInt(process.env.OLEAFLY_PROPERTY_SEEDS ?? "", 10);
  if (asked > 0) return asked;
  return coverageOn() ? underCoverage : full;
}
