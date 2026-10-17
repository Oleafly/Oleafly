import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as renderWithoutProviders, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
const renders = vi.hoisted(() => ({ picker: 0, menu: 0 }));
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpDisconnect: vi.fn(), onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...await original<typeof import("@/lib/tauri")>(),
  gitIsInitialized: vi.fn(async () => false),
}));
vi.mock("@/lib/external-file-changes", async (original) => ({
  ...await original<typeof import("@/lib/external-file-changes")>(),
  refreshOpenFilesFromDisk: vi.fn(),
}));
vi.mock("@/lib/skills", async (original) => ({
  ...await original<typeof import("@/lib/skills")>(),
  useSkills: () => ({ data: [], isPending: false, isFetching: false }),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
vi.mock("@/components/ai/home/AgentPickerRow", async (original) => {
  const actual = await original<typeof import("@/components/ai/home/AgentPickerRow")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    AgentPickerRow: (props: Parameters<typeof actual.AgentPickerRow>[0]) => {
      renders.picker += 1;
      return createElement(actual.AgentPickerRow, props);
    },
  };
});
vi.mock("@/components/ui/dropdown-menu", async (original) => {
  const actual = await original<typeof import("@/components/ui/dropdown-menu")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    DropdownMenu: (props: Parameters<typeof actual.DropdownMenu>[0]) => {
      renders.menu += 1;
      return createElement(actual.DropdownMenu, props);
    },
  };
});
import type { ReactNode } from "react";
import {
  acpCatalog, acpDisconnect, acpEvents, acpSessions, acpSnapshot, onAcpEvent, onAcpResync,
  type AcpEvent, type AcpSnapshot,
} from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { AssistantShellAcpActions } from "@/components/ai/AssistantShellAcpActions";
import { agent, event, session } from "./tests/ui-fixtures";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let snapshots: Record<string, AcpSnapshot>;
let history: Record<string, AcpEvent[]>;
let emit: (value: AcpEvent) => void;

beforeEach(() => {
  vi.clearAllMocks();
  renders.picker = 0;
  renders.menu = 0;
  history = {
    saved: [
      event(1, "user_message", { text: "Rebuild the paper and check the tables" }),
      event(2, "tool_call", { toolCallId: "build", title: "Run latexmk", status: "in_progress" }),
      event(3, "agent_message_chunk", { content: { type: "text", text: "Checking" } }),
    ],
  };
  snapshots = { saved: { session: session("saved", { status: "running", lastSequence: 3 }), permissions: [] } };
  emit = () => { throw new Error("The native event listener is not attached"); };
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { paper: "saved" }, composers: {}, errors: {} });
  vi.mocked(acpCatalog).mockResolvedValue([agent()]);
  vi.mocked(acpSessions).mockImplementation(async () => Object.values(snapshots).map((value) => value.session));
  vi.mocked(acpSnapshot).mockImplementation(async (_project, id) => snapshots[id]);
  vi.mocked(acpEvents).mockImplementation(async (_project, id, after = 0) => ({
    events: (history[id] ?? []).filter((value) => value.sequence > after),
    hasMore: false,
  }));
  vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
  vi.mocked(onAcpResync).mockResolvedValue(() => {});
  vi.mocked(acpDisconnect).mockResolvedValue();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

async function publish(...events: AcpEvent[]) {
  act(() => { for (const value of events) emit(value); });
  await waitFor(() => expect(useAcpSessionsStore.getState().events.saved?.at(-1)?.sequence).toBe(events.at(-1)?.sequence));
}

const toolOutput = (sequence: number, text: string) =>
  event(sequence, "tool_call_update", {
    toolCallId: "build",
    status: "in_progress",
    content: [{ type: "content", content: { type: "text", text } }],
  });

describe("ACP assistant streaming", () => {
  it("streams agent text and tool output without rendering the composer, agent picker or header actions again", async () => {
    const ui = render(
      <>
        <AssistantShellAcpActions projectId="paper" />
        <AcpWorkspaceAssistant projectId="paper" />
      </>,
    );
    await ui.findByText("Checking");
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveAttribute("data-status", "running"));
    for (const group of ui.queryAllByRole("button", { name: /Worked through/ })) fireEvent.click(group);
    const picker = renders.picker;
    const menu = renders.menu;

    await publish(event(4, "agent_message_chunk", { content: { type: "text", text: " the tables" } }));
    await publish(event(5, "agent_message_chunk", { content: { type: "text", text: " now." } }));
    expect(await ui.findByText("Checking the tables now.")).toBeInTheDocument();
    await publish(toolOutput(6, "Pass 1 of 3"));
    fireEvent.click(ui.getByRole("button", { name: /Run latexmk/ }));
    expect(await ui.findByText("Pass 1 of 3")).toBeInTheDocument();
    await publish(toolOutput(7, "Pass 2 of 3"));
    expect(await ui.findByText("Pass 2 of 3")).toBeInTheDocument();

    expect(ui.queryByText("Pass 1 of 3")).not.toBeInTheDocument();
    expect(renders.picker).toBe(picker);
    expect(renders.menu).toBe(menu);

    snapshots.saved = { session: session("saved", { status: "ready", lastSequence: 8 }), permissions: [] };
    await publish(event(8, "turn_complete", { stopReason: "end_turn" }));

    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveAttribute("data-status", "ready"));
    expect(renders.picker).toBeGreaterThan(picker);
    expect(ui.getByText("Checking the tables now.")).toBeInTheDocument();
    expect(ui.getByLabelText("Message CLI agent")).toBeEnabled();
  });
});
