import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  createOleafly: vi.fn((_opts?: unknown) => ({})),
  createFigure: vi.fn((_opts?: unknown) => ({})),
  createResearch: vi.fn((_opts?: unknown) => ({})),
}));

vi.mock("@oleafly/registry", () => ({
  registerAiToolset: (...args: unknown[]) => mocks.register(...args),
}));

vi.mock("@/lib/ai-tools", () => ({
  createOleaflyTools: (opts: unknown) => mocks.createOleafly(opts),
  createFigureTools: (opts: unknown) => mocks.createFigure(opts),
}));

vi.mock("@/lib/research-tools", () => ({
  createResearchAiTools: (opts: unknown) => mocks.createResearch(opts),
}));

import { registerAiToolsets } from "./ai-toolsets";

beforeEach(() => {
  mocks.register.mockClear();
  mocks.createResearch.mockClear();
});

describe("AI toolset contributions", () => {
  it("threads the ChatCore confirmation gate into research tools", () => {
    registerAiToolsets();
    const contribution = mocks.register.mock.calls
      .map(([value]) => value as { id: string; create: (opts: unknown) => unknown })
      .find((value) => value.id === "research-tools");
    const confirm = vi.fn();

    contribution?.create({ confirm });

    expect(mocks.createResearch).toHaveBeenCalledWith({ confirm });
  });
});
