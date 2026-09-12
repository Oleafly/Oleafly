import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { useToastStore } from "@/store/toast";

const KEEP_MESSAGE = "Keep this toast";
const CHOOSE_MESSAGE = "Choose a compatible engine";

describe("keyed toasts", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("updates an existing toast instead of stacking a duplicate", () => {
    const firstAction = vi.fn();
    const latestAction = vi.fn();

    toast.infoUnique("unrelated", KEEP_MESSAGE);
    const firstId = toast.infoUnique(
      "engine-compatibility:project-1",
      CHOOSE_MESSAGE,
      { label: "Choose engine…", onClick: firstAction },
      true,
    );
    const latestId = toast.infoUnique(
      "engine-compatibility:project-1",
      CHOOSE_MESSAGE,
      { label: "Choose engine…", onClick: latestAction },
      true,
    );

    expect(latestId).toBe(firstId);
    expect(useToastStore.getState().toasts).toHaveLength(2);
    expect(useToastStore.getState().toasts[0]?.message).toBe(KEEP_MESSAGE);
    expect(useToastStore.getState().toasts[1]?.action?.onClick).toBe(latestAction);
  });
});
