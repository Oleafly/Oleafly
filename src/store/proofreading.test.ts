import { beforeEach, describe, expect, it } from "vitest";
import {
  proofreadingPresentationDiagnostics,
  storePresentationDiagnostics,
  useProofreadingStore,
} from "./proofreading";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingIdentity,
  type ProofreadingResult,
} from "@oleafly/editor";

function identity(
  requestGeneration = 1,
): ProofreadingIdentity {
  return {
    projectId: "project",
    path: "main.tex",
    revision: 7,
    requestGeneration,
    surface: "source",
  };
}

function result(
  requestIdentity: ProofreadingIdentity,
  count: number,
): ProofreadingResult {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: 1,
    identity: requestIdentity,
    status: "ready",
    diagnostics: Array.from({ length: count }, (_, index) => ({
      from: index * 2,
      to: index * 2 + 1,
      message: `Issue ${index}`,
      kind: "Grammar",
      source: "harper" as const,
      word: "x",
      suggestions: [],
    })),
  };
}

beforeEach(() => {
  useProofreadingStore.getState().clear("source");
  useProofreadingStore.getState().clear("visual");
});

describe("proofreading presentation (unbounded)", () => {
  it("presents every retained finding without a cap", () => {
    const count = 50_001;
    const requestIdentity = identity();
    const response = result(requestIdentity, count);
    useProofreadingStore.getState().begin(requestIdentity);
    useProofreadingStore.getState().complete(response);

    expect(useProofreadingStore.getState().source.diagnostics).toHaveLength(
      count,
    );
    expect(proofreadingPresentationDiagnostics(response)).toHaveLength(count);
    expect(proofreadingPresentationDiagnostics(response)[count - 1]?.message).toBe(
      `Issue ${count - 1}`,
    );
  });

  it("keeps the full set across a same-document refresh", () => {
    const firstIdentity = identity(1);
    const first = result(firstIdentity, 3_000);
    useProofreadingStore.getState().begin(firstIdentity);
    useProofreadingStore.getState().complete(first);

    const nextIdentity = identity(2);
    useProofreadingStore.getState().begin(nextIdentity);
    // The previous set stays visible while the refresh is in flight.
    expect(
      useProofreadingStore.getState().source.diagnostics,
    ).toHaveLength(3_000);
    useProofreadingStore.getState().complete(result(nextIdentity, 4_500));
    expect(
      useProofreadingStore.getState().source.diagnostics,
    ).toHaveLength(4_500);
    expect(
      proofreadingPresentationDiagnostics(result(nextIdentity, 4_500)),
    ).toHaveLength(4_500);
  });

  it("uses the newest retained diagnostics when a presentation repaint was seeded by an older request", () => {
    const olderIdentity = identity(1);
    const older = result(olderIdentity, 2_000);
    const currentIdentity = identity(2);
    const current = result(currentIdentity, 2_500);
    const currentDiagnostic = current.diagnostics[2_400];
    if (!currentDiagnostic) {
      throw new Error("expected the retained diagnostic");
    }
    current.diagnostics[2_400] = {
      ...currentDiagnostic,
      message: "Current retained issue",
    };
    useProofreadingStore.getState().begin(currentIdentity);
    useProofreadingStore.getState().complete(current);

    const presented = proofreadingPresentationDiagnostics(older);

    expect(presented).toHaveLength(2_500);
    expect(presented[2_400]?.message).toBe("Current retained issue");
  });

  it("returns null for a non-authoritative surface", () => {
    const requestIdentity = identity();
    useProofreadingStore.getState().begin(requestIdentity);
    expect(
      storePresentationDiagnostics("source", "project", "main.tex"),
    ).toBeNull();
    expect(
      storePresentationDiagnostics("source", "other", "main.tex"),
    ).toBeNull();
    expect(
      storePresentationDiagnostics("source", "project", "other.tex"),
    ).toBeNull();
  });
});
