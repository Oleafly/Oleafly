import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofreadingActionHost } from "@oleafly/editor";

const host = vi.hoisted(() => ({ current: null as ProofreadingActionHost | null }));

vi.mock("@oleafly/editor", () => ({
  setProofreadingActionHost: (next: ProofreadingActionHost) => {
    host.current = next;
  },
}));

import { useDictionary } from "@/lib/dictionary";
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

  it("treats a word that is already in a dictionary as added", () => {
    useDictionary.setState({ ignored: {}, global: [] });

    expect(host.current?.addToProjectDictionary("project-a", "Qwertzuiop")).toBe(true);
    expect(host.current?.addToProjectDictionary("project-a", "Qwertzuiop")).toBe(true);
    expect(host.current?.addToPersonalDictionary("Asdfghjkl")).toBe(true);
    expect(host.current?.addToPersonalDictionary("Asdfghjkl")).toBe(true);
    expect(useDictionary.getState().ignored["project-a"]).toEqual(["Qwertzuiop"]);
    expect(useDictionary.getState().global).toEqual(["Asdfghjkl"]);
  });

  it("reports a word it could not add", () => {
    expect(host.current?.addToProjectDictionary("project-a", "bad\u0007word")).toBe(false);
    expect(host.current?.addToPersonalDictionary("")).toBe(false);
  });
});
