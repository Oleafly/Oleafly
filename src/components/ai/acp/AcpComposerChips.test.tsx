import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

import type { AcpSession } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { session } from "./tests/ui-fixtures";
import { AcpComposerChips } from "./AcpComposerChips";

function showQueued(status: AcpSession["status"]) {
  const value = session("saved", { status });
  useAcpSessionsStore.setState({
    sessions: { saved: value },
    queues: { saved: [{ id: "q1", text: "Now write the conclusion", attachments: [], mentions: [], selections: [], skill: null }] },
  });
  render(<AcpComposerChips projectId="paper" session={value} />);
  return screen.getByTestId("acp-queued");
}

beforeEach(() => {
  useAcpSessionsStore.setState({ sessions: {}, queues: {}, composers: {} });
});
afterEach(() => cleanup());
afterAll(restore);

describe("what a queued message waits for", () => {
  it("waits for the turn while the agent works", () => {
    expect(showQueued("running")).toHaveTextContent(enAi.acp.queue.queued);
  });

  it("waits for sign-in while the agent needs it", () => {
    expect(showQueued("auth_required")).toHaveTextContent(enAi.acp.queue.queuedSignIn);
  });

  it("waits for the agent to be ready while it connects or is away", () => {
    expect(showQueued("connecting")).toHaveTextContent(enAi.acp.queue.queuedConnecting);
    cleanup();
    expect(showQueued("disconnected")).toHaveTextContent(enAi.acp.queue.queuedConnecting);
  });
});
