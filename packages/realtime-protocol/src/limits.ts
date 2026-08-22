import { z } from "zod";

export interface RealtimeLimitsV1 {
  readonly maxFrameBytes: number;
  readonly maxYjsUpdateBytes: number;
  readonly maxYjsStateVectorBytes: number;
  readonly maxMutationUpdateBytes: number;
  readonly maxRelativePositionBytes: number;
  readonly maxStringBytes: number;
  readonly maxAssistanceAcceptedDiffBytes: number;
}

export const DEFAULT_REALTIME_LIMITS_V1: RealtimeLimitsV1 = Object.freeze({
  maxFrameBytes: 4 * 1024 * 1024,
  maxYjsUpdateBytes: 2 * 1024 * 1024,
  maxYjsStateVectorBytes: 256 * 1024,
  maxMutationUpdateBytes: 2 * 1024 * 1024,
  maxRelativePositionBytes: 4 * 1024,
  maxStringBytes: 4 * 1024,
  maxAssistanceAcceptedDiffBytes: 1024 * 1024,
});

const RealtimeLimitsV1Schema = z.object({
  maxFrameBytes: z.number().int().min(12).max(0xffff_ffff),
  maxYjsUpdateBytes: z.number().int().positive().max(0xffff_ffff),
  maxYjsStateVectorBytes: z.number().int().positive().max(0xffff_ffff),
  maxMutationUpdateBytes: z.number().int().positive().max(0xffff_ffff),
  maxRelativePositionBytes: z.number().int().positive().max(0xffff_ffff),
  maxStringBytes: z.number().int().positive().max(0xffff),
  maxAssistanceAcceptedDiffBytes: z.number().int().nonnegative().max(0xffff_ffff),
}).strict();

export function validateRealtimeLimitsV1(limits: RealtimeLimitsV1): RealtimeLimitsV1 {
  const parsed = RealtimeLimitsV1Schema.parse(limits);
  for (const [name, maximum] of [
    ["maxYjsUpdateBytes", parsed.maxYjsUpdateBytes],
    ["maxYjsStateVectorBytes", parsed.maxYjsStateVectorBytes],
    ["maxMutationUpdateBytes", parsed.maxMutationUpdateBytes],
    ["maxRelativePositionBytes", parsed.maxRelativePositionBytes],
    ["maxStringBytes", parsed.maxStringBytes],
    ["maxAssistanceAcceptedDiffBytes", parsed.maxAssistanceAcceptedDiffBytes],
  ] as const) {
    if (maximum + 32 > parsed.maxFrameBytes) {
      throw new Error(`${name} must fit inside maxFrameBytes`);
    }
  }
  return parsed;
}
