import { afterAll, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(),
}));

import { acpCatalog } from "@/lib/acp";
import { agent } from "@/components/ai/acp/tests/ui-fixtures";
import { useAgentTargets } from "./use-agent-targets";

afterAll(restore);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("delegation targets", () => {
  it("offers only CLI agents that can start a conversation", async () => {
    vi.mocked(acpCatalog).mockResolvedValue([
      agent("ready"),
      agent("pi", {
        installed: true, cliRequired: true,
        cli: { command: "pi", displayName: "Pi", path: null, version: null, signInCommand: "pi" },
      }),
      agent("bridge", { installed: false }),
    ]);
    const { result } = renderHook(() => useAgentTargets("paper", []), { wrapper });
    await waitFor(() => expect(result.current.map((target) => target.id)).toEqual(["ready"]));
  });
});
