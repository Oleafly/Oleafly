import { beforeEach, describe, expect, it } from "vitest";
import {
  PROOFREADING_PRESENTATION_PAGE_SIZE,
  proofreadingPresentationDiagnostics,
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

describe("proofreading presentation pages", () => {
  it("retains every finding while exposing a bounded deterministic page", () => {
    const requestIdentity = identity();
    const response = result(
      requestIdentity,
      PROOFREADING_PRESENTATION_PAGE_SIZE * 2 + 1,
    );
    useProofreadingStore.getState().begin(requestIdentity);
    useProofreadingStore.getState().complete(response);

    expect(useProofreadingStore.getState().source.diagnostics).toHaveLength(
      PROOFREADING_PRESENTATION_PAGE_SIZE * 2 + 1,
    );
    expect(proofreadingPresentationDiagnostics(response)).toHaveLength(
      PROOFREADING_PRESENTATION_PAGE_SIZE,
    );

    useProofreadingStore.getState().setPresentationPage("source", 2);
    const finalPage = proofreadingPresentationDiagnostics(response);
    expect(finalPage).toHaveLength(1);
    expect(finalPage[0]?.message).toBe(
      `Issue ${PROOFREADING_PRESENTATION_PAGE_SIZE * 2}`,
    );
  });

  it("keeps the selected page across a same-document refresh", () => {
    const firstIdentity = identity(1);
    const first = result(
      firstIdentity,
      PROOFREADING_PRESENTATION_PAGE_SIZE * 2,
    );
    useProofreadingStore.getState().begin(firstIdentity);
    useProofreadingStore.getState().complete(first);
    useProofreadingStore.getState().setPresentationPage("source", 1);

    const nextIdentity = identity(2);
    useProofreadingStore.getState().begin(nextIdentity);
    expect(
      useProofreadingStore.getState().source.presentationPage,
    ).toBe(1);
    useProofreadingStore
      .getState()
      .complete(result(nextIdentity, PROOFREADING_PRESENTATION_PAGE_SIZE * 2));
    expect(
      useProofreadingStore.getState().source.presentationPage,
    ).toBe(1);
  });
});
