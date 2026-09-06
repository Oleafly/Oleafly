export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const count = Math.max(0, Math.round(value));
  if (count < 1000) return String(count);
  if (count < 10_000) return `${trim(Math.round(count / 100) / 10)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  return `${trim(Math.round(count / 100_000) / 10)}M`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}
