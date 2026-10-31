function normalized(stopReason: string | null | undefined): string | null {
  return typeof stopReason === "string" ? stopReason.trim().toLowerCase() : null;
}

export function isOutputLimitStop(stopReason: string | null | undefined): boolean {
  const reason = normalized(stopReason);
  return reason === "length" || reason === "max_tokens" || reason === "max_output_tokens";
}

export function isRefusalStop(stopReason: string | null | undefined): boolean {
  const reason = normalized(stopReason);
  return reason === "refusal" || reason === "content_filter" || reason === "safety";
}
