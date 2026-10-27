// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  imported: vi.fn(),
  register: vi.fn(),
  registry: { aiToolsets: [] as { id: string }[] },
}));

vi.mock("@oleafly/registry", () => ({ registry: mocks.registry }));

vi.mock("@/contributions/ai-toolsets", () => {
  mocks.imported();
  return {
    registerAiToolsets: () => {
      mocks.register();
      mocks.registry.aiToolsets.push({ id: "project-tools" });
    },
  };
});

import { loadAiToolsets, useAiToolsets } from "./load-ai-toolsets";

describe("loadAiToolsets", () => {
  it("loads the toolsets only when asked, once, and re-renders the readers", async () => {
    expect(mocks.imported).not.toHaveBeenCalled();

    const { result } = renderHook(() => useAiToolsets());
    expect(result.current).toEqual([]);

    await waitFor(() => expect(result.current).toEqual([{ id: "project-tools" }]));
    await expect(Promise.all([loadAiToolsets(), loadAiToolsets()])).resolves.toEqual([
      [{ id: "project-tools" }],
      [{ id: "project-tools" }],
    ]);
    expect(mocks.imported).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
  });
});
