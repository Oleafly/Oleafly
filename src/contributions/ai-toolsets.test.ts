import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Contribution = { id: string; mode: string; source: { kind: string }; create: (opts: unknown) => unknown };

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  createOleafly: vi.fn((_opts?: unknown) => ({ project: true })),
  createFigure: vi.fn((_opts?: unknown) => ({ figure: true })),
  createResearch: vi.fn((_opts?: unknown) => ({ research: true })),
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

let contributions: Contribution[] = [];

function contribution(id: string): Contribution {
  const found = contributions.find((value) => value.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

beforeAll(() => {
  registerAiToolsets();
  contributions = mocks.register.mock.calls.map(([value]) => value as Contribution);
});

beforeEach(() => {
  mocks.createOleafly.mockClear();
  mocks.createFigure.mockClear();
  mocks.createResearch.mockClear();
});

describe("AI toolset contributions", () => {
  it("registers the project, figure and research toolsets once", () => {
    expect(contributions.map(({ id, mode, source }) => ({ id, mode, kind: source.kind }))).toEqual([
      { id: "project-tools", mode: "chat", kind: "project" },
      { id: "figure-tools", mode: "chat", kind: "figure" },
      { id: "research-tools", mode: "chat", kind: "project" },
    ]);
    registerAiToolsets();
    expect(mocks.register).toHaveBeenCalledTimes(3);
  });

  it("builds project tools with the chat options", () => {
    const opts = { confirm: vi.fn(), onImage: vi.fn(), runId: () => "run-1" };
    expect(contribution("project-tools").create(opts)).toEqual({ project: true });
    expect(mocks.createOleafly).toHaveBeenCalledWith(opts);
  });

  it("builds figure tools with the chat options", () => {
    const opts = { confirm: vi.fn(), onImage: vi.fn() };
    expect(contribution("figure-tools").create(opts)).toEqual({ figure: true });
    expect(mocks.createFigure).toHaveBeenCalledWith(opts);
  });

  it("threads the ChatCore confirmation gate into research tools", () => {
    const confirm = vi.fn();
    contribution("research-tools").create({ confirm });
    expect(mocks.createResearch).toHaveBeenCalledWith({ confirm });
  });
});
