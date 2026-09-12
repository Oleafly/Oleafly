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

function normalizedInputTotal(
  inputKnown: boolean,
  inputSemantics: InputTokenSemantics,
  input: number,
  cacheRead: number | null,
  cacheWrite: number | null,
): number | null {
  if (!inputKnown) return null;
  if (inputSemantics !== "exclusive") return input;
  if (cacheRead === null || cacheWrite === null) return null;
  return input + cacheRead + cacheWrite;
}

function normalizedInputFresh(
  inputKnown: boolean,
  inputSemantics: InputTokenSemantics,
  input: number,
  cacheRead: number | null,
  cacheWrite: number | null,
  inclusiveCacheIsValid: boolean,
): number | null {
  if (!inputKnown) return null;
  if (inputSemantics === "exclusive") return input;
  if (
    inputSemantics === "inclusive" &&
    cacheRead !== null &&
    cacheWrite !== null &&
    inclusiveCacheIsValid
  ) {
    return input - cacheRead - cacheWrite;
  }
  return null;
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

  const inputTotal = normalizedInputTotal(
    inputKnown,
    inputSemantics,
    input,
    cacheRead,
    cacheWrite,
  );
  if (inputTotal !== null && !Number.isSafeInteger(inputTotal)) {
    throw new Error("normalized input total must be a nonnegative safe integer");
  }
  const inclusiveCacheIsValid =
    inputSemantics !== "inclusive" ||
    cacheRead === null ||
    cacheWrite === null ||
    cacheRead + cacheWrite <= input;
  const inputFresh = normalizedInputFresh(
    inputKnown,
    inputSemantics,
    input,
    cacheRead,
    cacheWrite,
    inclusiveCacheIsValid,
  );
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
