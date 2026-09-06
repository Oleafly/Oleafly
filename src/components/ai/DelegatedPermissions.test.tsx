// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/acp", async (original) => ({
  ...(await original<typeof import("@/lib/acp")>()),
  acpDelegatedPermission: vi.fn(),
  onAcpEvent: vi.fn(),
  onAcpResync: vi.fn(),
}));

import { acpDelegatedPermission, onAcpEvent, onAcpResync, type AcpPermission } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import type { SubagentEntry } from "@/store/chats";
import { delegatedAcpSessions, DelegatedPermissions } from "./DelegatedPermissions";

const CHILD_SESSION = "acp-child-1";
const PARENT_SESSION = "thread-agent-7";

function permission(overrides: Partial<AcpPermission> = {}): AcpPermission {
  return {
    id: "request-1",
    sessionId: CHILD_SESSION,
    turnId: "turn-1",
    title: "Read the linked evidence?",
    toolCallId: "tool-1",
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject-once", name: "Decline", kind: "reject_once" },
    ],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

const subagents: SubagentEntry[] = [
  { id: "agent-1", label: "Evidence", state: "permission", runtime: "built-in" },
  {
    id: "agent-2",
    label: "Sources",
    state: "permission",
    detail: "Waiting for permission: Read the linked evidence?",
    runtime: "acp",
    sessionId: CHILD_SESSION,
    agentId: "claude",
  },
];

beforeEach(() => {
  vi.mocked(acpDelegatedPermission).mockReset().mockResolvedValue(undefined);
  vi.mocked(onAcpEvent).mockReset().mockResolvedValue(() => {});
  vi.mocked(onAcpResync).mockReset().mockResolvedValue(() => {});
  useAcpSessionsStore.setState({
    catalog: [],
    sessions: {},
    events: {},
    permissions: {},
    activeByProject: {},
    composers: {},
  });
});

afterEach(cleanup);

describe("delegated ACP permissions in the built-in chat", () => {
  it("keeps only the ACP children that reported a session", () => {
    expect(delegatedAcpSessions(subagents)).toEqual([
      { sessionId: CHILD_SESSION, agentId: "claude" },
    ]);
    expect(delegatedAcpSessions(undefined)).toEqual([]);
  });

  it("renders a pending child request and answers it with the child and parent session ids", async () => {
    render(
      <DelegatedPermissions
        projectId="paper"
        parentSessionId={PARENT_SESSION}
        subagents={subagents}
      />,
    );

    await waitFor(() => expect(onAcpEvent).toHaveBeenCalled());
    expect(screen.queryByTestId("delegated-permissions")).toBeNull();

    act(() => {
      useAcpSessionsStore.setState({ permissions: { [CHILD_SESSION]: [permission()] } });
    });

    expect(await screen.findByText("Read the linked evidence?")).toBeTruthy();
    expect(screen.getByText("claude needs permission")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() =>
      expect(acpDelegatedPermission).toHaveBeenCalledExactlyOnceWith(
        "paper",
        CHILD_SESSION,
        PARENT_SESSION,
        "request-1",
        "allow-once",
      ),
    );
  });

  it("reports a failed answer and renders nothing without a parent session", async () => {
    vi.mocked(acpDelegatedPermission).mockRejectedValueOnce(
      new Error("This permission request belongs to another conversation."),
    );
    const onError = vi.fn();
    const ui = render(
      <DelegatedPermissions
        projectId="paper"
        parentSessionId={PARENT_SESSION}
        subagents={subagents}
        onError={onError}
      />,
    );
    act(() => {
      useAcpSessionsStore.setState({ permissions: { [CHILD_SESSION]: [permission()] } });
    });
    fireEvent.click(await ui.findByRole("button", { name: "Decline" }));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "This permission request belongs to another conversation.",
      ),
    );

    ui.rerender(
      <DelegatedPermissions
        projectId="paper"
        parentSessionId={null}
        subagents={subagents}
        onError={onError}
      />,
    );
    expect(ui.queryByTestId("delegated-permissions")).toBeNull();
  });
});
