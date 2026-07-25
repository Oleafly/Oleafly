import { describe, expect, it } from "vitest";
import {
  canApplyLocalCompileOutcome,
  COMPILE_CHECKPOINT_VERSION,
  createCompileSuccessCheckpoint,
  fingerprintCompileOutput,
  hasCompileCheckpointAdvanced,
  isCompileSuccessCheckpoint,
  isNewerCompileCheckpoint,
  nextSuccessfulCompileTimestamp,
} from "./compile-checkpoint";

const checkpoint = (
  outputRevision: number,
  outputKind: "standard" | "tagged" = "standard",
) =>
  createCompileSuccessCheckpoint({
    projectId: "project-a",
    mainDocument: "main.tex",
    outputKind,
    producerId: "main-window",
    outputRevision,
    outputId: fingerprintCompileOutput(
      new Uint8Array([outputRevision, outputRevision + 1]),
    ),
    previousCompletedAt: 100,
    now: 200 + outputRevision,
  });

describe("compile success checkpoint contract", () => {
  it("carries an explicit version, project/source identity, and backend order", () => {
    expect(checkpoint(7, "tagged")).toEqual({
      version: COMPILE_CHECKPOINT_VERSION,
      projectId: "project-a",
      mainDocument: "main.tex",
      outputKind: "tagged",
      producerId: "main-window",
      outputRevision: 7,
      outputId: fingerprintCompileOutput(new Uint8Array([7, 8])),
      completedAt: 207,
    });
  });

  it("validates the complete payload and rejects legacy or partial done events", () => {
    expect(isCompileSuccessCheckpoint(checkpoint(1))).toBe(true);
    expect(
      isCompileSuccessCheckpoint({
        projectId: "project-a",
        from: "legacy-window",
      }),
    ).toBe(false);
    expect(
      isCompileSuccessCheckpoint({ ...checkpoint(1), version: 2 }),
    ).toBe(false);
    expect(
      isCompileSuccessCheckpoint({ ...checkpoint(1), outputId: "stale" }),
    ).toBe(false);
  });

  it("orders outputs by the backend revision, not event arrival time", () => {
    const current = checkpoint(8);
    expect(isNewerCompileCheckpoint(checkpoint(9), current)).toBe(true);
    expect(isNewerCompileCheckpoint(checkpoint(8), current)).toBe(false);
    expect(isNewerCompileCheckpoint(checkpoint(7), current)).toBe(false);
  });

  it("prevents an older local completion from replacing a newer accepted success", () => {
    const attemptStart = checkpoint(4);
    const current = checkpoint(6);

    expect(hasCompileCheckpointAdvanced(attemptStart, current)).toBe(true);
    expect(canApplyLocalCompileOutcome(null, current, attemptStart)).toBe(false);
    expect(
      canApplyLocalCompileOutcome(checkpoint(5), current, attemptStart),
    ).toBe(false);
    expect(
      canApplyLocalCompileOutcome(checkpoint(7), current, attemptStart),
    ).toBe(true);
  });

  it("always advances the local success timestamp even within one millisecond", () => {
    expect(nextSuccessfulCompileTimestamp(500, 500)).toBe(501);
    expect(nextSuccessfulCompileTimestamp(500, 499)).toBe(501);
    expect(nextSuccessfulCompileTimestamp(500, 900)).toBe(900);
  });

  it("fingerprints every output byte deterministically", () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    expect(fingerprintCompileOutput(bytes)).toBe(
      "pdf-v1:4:6fab6075b28eda84",
    );
    expect(fingerprintCompileOutput(bytes)).not.toBe(
      fingerprintCompileOutput(new Uint8Array([0, 1, 3, 255])),
    );
  });
});
