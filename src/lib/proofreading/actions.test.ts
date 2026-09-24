import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofreadingActionHost } from "@oleafly/editor";

const host = vi.hoisted(() => ({ current: null as ProofreadingActionHost | null }));

vi.mock("@oleafly/editor", () => ({
  setProofreadingActionHost: (next: ProofreadingActionHost) => {
    host.current = next;
  },
}));

import { useToastStore } from "@/store/toast";
import { installProofreadingActionHost } from "./actions";

const WRITE_FAILED = "The word could not be saved.";

describe("proofreading action host", () => {
  beforeEach(() => {
    useToastStore.getState().reset();
    installProofreadingActionHost();
  });

  it("answers a lint card action with one info toast through the shared notification layer", () => {
    host.current?.notify(WRITE_FAILED);
    host.current?.notify(WRITE_FAILED);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({
      kind: "info",
      message: WRITE_FAILED,
      count: 2,
    });
  });
});
