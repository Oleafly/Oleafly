// Why a step ended, across wires. Mirrors is_output_limit_stop and
// is_refusal_stop in crates/oleafly-agent/src/stream/mod.rs.

function normalized(stopReason: string | null | undefined): string | null {
  return typeof stopReason === "string" ? stopReason.trim().toLowerCase() : null;
}

/** The model ran out of output tokens. */
export function isOutputLimitStop(stopReason: string | null | undefined): boolean {
  const reason = normalized(stopReason);
  return reason === "length" || reason === "max_tokens" || reason === "max_output_tokens";
}

/** The model declined to answer. */
export function isRefusalStop(stopReason: string | null | undefined): boolean {
  const reason = normalized(stopReason);
  return reason === "refusal" || reason === "content_filter" || reason === "safety";
}
