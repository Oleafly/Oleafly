import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { useToastStore } from "@/store/toast";

describe("keyed toasts", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("updates an existing toast instead of stacking a duplicate", () => {
    const firstAction = vi.fn();
    const latestAction = vi.fn();

    const firstId = toast.infoUnique(
      "engine-compatibility:project-1",
      "Choose a compatible engine",
      { label: "Choose engine…", onClick: firstAction },
      true,
    );
    const latestId = toast.infoUnique(
      "engine-compatibility:project-1",
      "Choose a compatible engine",
      { label: "Choose engine…", onClick: latestAction },
      true,
    );

    expect(latestId).toBe(firstId);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.action?.onClick).toBe(latestAction);
  });
});
