export type InputTokenSemantics = "inclusive" | "exclusive" | "unknown";

export type AgentUsage = {
  input: number;
  output: number;
  inputKnown?: boolean;
  outputKnown?: boolean;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  inputSemantics?: InputTokenSemantics;
};

export type NormalizedAgentUsage = {
  inputRecorded: number | null;
  inputTotal: number | null;
  inputFresh: number | null;
  outputTotal: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  inputSemantics: InputTokenSemantics;
  comparableCacheInput: number | null;
  cacheRate: number | null;
};

function counter(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
  return value;
}

export function normalizeAgentUsage(usage: AgentUsage): NormalizedAgentUsage {
  const input = counter(usage.input, "input") as number;
  const output = counter(usage.output, "output") as number;
  const cacheRead = counter(usage.cacheRead, "cacheRead");
  const cacheWrite = counter(usage.cacheWrite, "cacheWrite");
  const inputSemantics = usage.inputSemantics ?? "unknown";
  if (!(["inclusive", "exclusive", "unknown"] as const).includes(inputSemantics)) {
    throw new Error("inputSemantics has an unsupported value");
  }
  const hasLegacyObservation =
    input !== 0 ||
    output !== 0 ||
    cacheRead !== null ||
    cacheWrite !== null ||
    inputSemantics !== "unknown";
  const inputKnown = usage.inputKnown ?? hasLegacyObservation;
  const outputKnown = usage.outputKnown ?? hasLegacyObservation;

  const inputTotal = !inputKnown
    ? null
    : inputSemantics === "exclusive"
      ? cacheRead === null || cacheWrite === null
        ? null
        : input + cacheRead + cacheWrite
      : input;
  if (inputTotal !== null && !Number.isSafeInteger(inputTotal)) {
    throw new Error("normalized input total must be a nonnegative safe integer");
  }
  const inclusiveCacheIsValid =
    inputSemantics !== "inclusive" ||
    cacheRead === null ||
    cacheWrite === null ||
    cacheRead + cacheWrite <= input;
  const inputFresh =
    !inputKnown
      ? null
      : inputSemantics === "exclusive"
      ? input
      : inputSemantics === "inclusive" &&
          cacheRead !== null &&
          cacheWrite !== null &&
          inclusiveCacheIsValid
        ? input - cacheRead - cacheWrite
        : null;
  const comparableCacheInput =
    inputSemantics === "unknown" ||
    cacheRead === null ||
    cacheWrite === null ||
    inputTotal === null ||
    !inclusiveCacheIsValid
      ? null
      : inputTotal;

  return {
    inputRecorded: inputKnown ? input : null,
    inputTotal,
    inputFresh,
    outputTotal: outputKnown ? output : null,
    cacheRead,
    cacheWrite,
    inputSemantics,
    comparableCacheInput,
    cacheRate:
      comparableCacheInput !== null && comparableCacheInput > 0 && cacheRead !== null
        ? cacheRead / comparableCacheInput
        : null,
  };
}
