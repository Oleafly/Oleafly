import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as renderWithoutProviders, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpStart: vi.fn(), acpAuthenticate: vi.fn(), acpDisconnect: vi.fn(), acpReconnect: vi.fn(),
  acpSetModel: vi.fn(), acpPrompt: vi.fn(), acpPermission: vi.fn(), acpCancel: vi.fn(),
  onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
}));
vi.mock("@/lib/agent-turns", async (original) => ({
  ...await original<typeof import("@/lib/agent-turns")>(),
  agentTurnStatus: vi.fn(), agentTurnPreview: vi.fn(), agentTurnRevert: vi.fn(), agentTurnRedo: vi.fn(),
}));
vi.mock("@/lib/tauri", async (original) => ({
  ...await original<typeof import("@/lib/tauri")>(),
  gitIsInitialized: vi.fn(),
}));
vi.mock("./export-conversation", () => ({ exportConversation: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), errorUnique: vi.fn(), successUnique: vi.fn() } }));
vi.mock("@/components/layout/CleanLibraryDialog", () => ({
  CleanLibraryDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="clean-library-dialog" /> : null),
}));
vi.mock("@/lib/skills", async (original) => ({
  ...await original<typeof import("@/lib/skills")>(),
  useSkills: () => ({
    data: [
      {
        id: "oleafly-verify-claims",
        name: "Verify claims",
        description: "Check claims against sources.",
        instructions: "",
        dir: "/skills/oleafly-verify-claims",
        files: [],
        allowedTools: [],
        tier: "native",
        phase: "review",
        tools: [],
        source: "bundled",
        updateAvailable: false,
        projectEnabled: false,
        enabled: true,
        removable: false,
        validation: { status: "valid" },
      },
    ],
    isPending: false,
    isFetching: false,
  }),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
import type { ReactNode } from "react";
import {
  acpCatalog, acpEvents, acpPrompt, acpSessions, acpSnapshot, acpStart, onAcpEvent, onAcpResync, acpDisconnect,
  type AcpEvent, type AcpPermission, type AcpSnapshot,
} from "@/lib/acp";
import { agentTurnStatus } from "@/lib/agent-turns";
import { gitIsInitialized } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { useFilesStore } from "@/store/files";
import { AssistantShellAcpActions } from "@/components/ai/AssistantShellAcpActions";
import { useTurnReviewStore } from "@/components/ai/turns/turn-review-store";
import { agent, chooseMenuItem, event, menuItemNames, session } from "./tests/ui-fixtures";
import { exportConversation } from "./export-conversation";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let snapshots: Record<string, AcpSnapshot>;
let history: Record<string, AcpEvent[]>;
let emit: (value: AcpEvent) => void;

function turnChanges(overrides: Record<string, unknown> = {}) {
  return {
    turnId: "turn",
    snapshotId: "snap-1",
    files: [{ index: 0, path: "main.tex", change: "modified", beforeSize: 1, afterSize: 2, added: 4, removed: 1, alsoEditedHere: false, build: false }],
    moreFiles: 0,
    skipped: [],
    overlapped: false,
    unavailable: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  useTurnReviewStore.getState().reset();
  snapshots = { saved: { session: session(), permissions: [] } };
  history = { saved: [] };
  emit = () => { throw new Error("The native event listener is not attached"); };
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { paper: "saved" }, composers: {}, errors: {}, starting: {} });
  useFilesStore.setState({ projectName: "Thesis" });
  vi.mocked(acpCatalog).mockResolvedValue([agent()]);
  vi.mocked(acpSessions).mockImplementation(async () => Object.values(snapshots).map((value) => value.session));
  vi.mocked(acpSnapshot).mockImplementation(async (_project, id) => {
    if (!snapshots[id]) throw new Error("Conversation missing");
    return snapshots[id];
  });
  vi.mocked(acpEvents).mockImplementation(async (_project, id, after = 0, limit = 300) => {
    const remaining = (history[id] ?? []).filter((value) => value.sequence > after);
    return { events: remaining.slice(0, limit), hasMore: remaining.length > limit };
  });
  vi.mocked(onAcpEvent).mockImplementation(async (listener) => { emit = listener; return () => {}; });
  vi.mocked(onAcpResync).mockResolvedValue(() => {});
  vi.mocked(acpDisconnect).mockResolvedValue();
  vi.mocked(gitIsInitialized).mockResolvedValue(false);
  vi.mocked(agentTurnStatus).mockResolvedValue({ expired: false, files: [] });
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

async function publish(...events: AcpEvent[]) {
  act(() => { for (const value of events) emit(value); });
  await waitFor(() => expect(useAcpSessionsStore.getState().events[events[0].sessionId]?.at(-1)?.sequence).toBe(events.at(-1)?.sequence));
}

function typeMessage(input: HTMLElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

function quickStartLabels(ui: ReturnType<typeof render>) {
  return ui.getAllByTestId("acp-quick-start").map((node) => node.textContent);
}

describe("CLI home research presets", () => {
  it("shows the presets before a conversation exists and fills the composer without sending", async () => {
    snapshots = {};
    useAcpSessionsStore.setState({ activeByProject: {} });
    vi.mocked(acpStart).mockResolvedValue({ session: session("fresh"), permissions: [] });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(quickStartLabels(ui)).toEqual([
      "Literature sweep", "Related work", "Citation audit", "Manuscript review",
      "Reproducibility audit", "Figure audit", "Reference cleanup",
    ]));
    await waitFor(() => expect(ui.getByTestId("acp-start-conversation")).toBeEnabled());

    fireEvent.click(ui.getByTitle("Citation audit"));

    await waitFor(() => expect(acpStart).toHaveBeenCalledExactlyOnceWith("paper", "fixture"));
    const composer = useAcpSessionsStore.getState().composers.paper;
    expect(composer?.draft).toMatch(/^Audit the claims in this manuscript against their cited sources\./);
    expect(composer?.draft).toMatch(/Do not change manuscript files; write findings to research\/claims\.md\.$/);
    expect(composer?.skill).toEqual({ id: "oleafly-verify-claims", name: "Verify claims" });
    await waitFor(() => expect(ui.getByLabelText("Message CLI agent")).toHaveValue(composer?.draft));
    expect(ui.getByTestId("acp-skill-chip")).toHaveTextContent("Verify claims");
    expect(acpPrompt).not.toHaveBeenCalled();
  });

  it("offers Git review only in a Git repository", async () => {
    vi.mocked(gitIsInitialized).mockResolvedValue(true);
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(quickStartLabels(ui)).toContain("Git review"));
    expect(gitIsInitialized).toHaveBeenCalledWith("paper");
  });

  it("opens the library cleanup instead of prompting for reference cleanup", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(quickStartLabels(ui)).toContain("Reference cleanup"));
    fireEvent.click(ui.getByTitle("Reference cleanup"));
    expect(await ui.findByTestId("clean-library-dialog")).toBeInTheDocument();
    expect(useAcpSessionsStore.getState().composers.paper?.draft ?? "").toBe("");
  });

  it("sends the chosen skill with the message and shows it on the user row", async () => {
    vi.mocked(acpPrompt).mockImplementation(async (_project, _id, text, _images, skillId) => {
      history.saved = [event(1, "user_message", { text, skill: { id: skillId, name: "Verify claims" } })];
      snapshots.saved = { session: session("saved", { status: "running", lastSequence: 1 }), permissions: [] };
      emit(history.saved[0]);
      return snapshots.saved;
    });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    await waitFor(() => expect(ui.getByTestId("assistant-home-cards")).toBeInTheDocument());
    fireEvent.click(ui.getByTestId("assistant-home-card-oleafly-verify-claims"));
    expect(await ui.findByTestId("acp-skill-chip")).toHaveTextContent("Verify claims");
    const input = ui.getByLabelText("Message CLI agent");
    expect(input).toHaveValue("");
    typeMessage(input, "Check section 3");
    await waitFor(() => expect(ui.getByRole("button", { name: "Send" })).toBeEnabled());
    fireEvent.click(ui.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(acpPrompt).toHaveBeenCalledExactlyOnceWith("paper", "saved", "Check section 3", [], "oleafly-verify-claims"));
    await waitFor(() => expect(ui.queryByTestId("acp-skill-chip")).toBeNull());
    expect(await ui.findByTestId("user-skill-chip")).toHaveTextContent("Verify claims");
  });

  it("lets the user remove the skill chip", async () => {
    useAcpSessionsStore.setState({ composers: { paper: { agentId: "fixture", draft: "Hi", images: [], skill: { id: "oleafly-verify-claims", name: "Verify claims" } } } });
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    fireEvent.click(await ui.findByRole("button", { name: "Remove skill Verify claims" }));
    expect(ui.queryByTestId("acp-skill-chip")).toBeNull();
    expect(useAcpSessionsStore.getState().composers.paper?.skill).toBeNull();
  });
});

describe("CLI turn review", () => {
  it("puts the changes card under the turn's last assistant row", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    await publish(
      event(1, "user_message", { text: "Tighten the intro" }),
      event(2, "agent_message_chunk", { content: { type: "text", text: "Tightened it." } }),
      event(3, "turn_changes", turnChanges()),
      event(4, "turn_complete", { stopReason: "end_turn" }),
    );
    const card = await ui.findByTestId("turn-changes");
    expect(card).toHaveTextContent("Changed 1 file");
    const rows = ui.container.querySelectorAll("[data-chat-message-row]");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContainElement(card);
    await waitFor(() => expect(agentTurnStatus).toHaveBeenCalledWith("paper", "snap-1"));
  });

  it("says once per conversation that Undo is unavailable", async () => {
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    await waitFor(() => expect(acpEvents).toHaveBeenCalledWith("paper", "saved", 0));
    const unavailable = turnChanges({ snapshotId: null, files: [], unavailable: "too_many_files" });
    await publish(
      event(1, "user_message", { text: "One" }),
      event(2, "agent_message_chunk", { content: { type: "text", text: "First." } }),
      event(3, "turn_changes", unavailable),
      event(4, "turn_complete", { stopReason: "end_turn" }),
      { ...event(5, "user_message", { text: "Two" }), turnId: "turn-2" },
      { ...event(6, "agent_message_chunk", { content: { type: "text", text: "Second." } }), turnId: "turn-2" },
      { ...event(7, "turn_changes", { ...unavailable, turnId: "turn-2" }), turnId: "turn-2" },
    );
    await waitFor(() => expect(ui.getAllByTestId("turn-changes-unavailable")).toHaveLength(1));
    expect(ui.getByTestId("turn-changes-unavailable")).toHaveTextContent(
      "Undo isn't available for this turn: the project has too many files.",
    );
  });

  it("gives the permission list most of the panel height", async () => {
    const request: AcpPermission = {
      id: "request", sessionId: "saved", turnId: "turn", title: "Edit main.tex", toolCallId: "tool",
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }], expiresAt: Date.now() + 60_000,
      locations: ["main.tex"], diffs: [{ path: "main.tex", oldText: "a", newText: "b", truncated: false }],
    };
    snapshots.saved = { session: session("saved", { status: "running" }), permissions: [request] };
    const ui = render(<AcpWorkspaceAssistant projectId="paper" />);
    const allow = await ui.findByRole("button", { name: "Allow once" });
    expect(allow.closest(".max-h-\\[60vh\\]")).not.toBeNull();
    expect(ui.getByRole("button", { name: "Show change" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CLI conversation names and export", () => {
  it("names the agent in the status pill and the saved list", async () => {
    const ui = render(
      <>
        <AssistantShellAcpActions projectId="paper" />
        <AcpWorkspaceAssistant projectId="paper" />
      </>,
    );
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · ready"));
    const names = await menuItemNames(ui.getByRole("button", { name: "Saved conversations" }));
    expect(names).toEqual(["Export conversation…", "Conversation saved · Research CLI"]);
  });

  it("exports the open conversation from the top of the history menu", async () => {
    vi.mocked(exportConversation).mockResolvedValue(true);
    const ui = render(
      <>
        <AssistantShellAcpActions projectId="paper" />
        <AcpWorkspaceAssistant projectId="paper" />
      </>,
    );
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · ready"));
    await chooseMenuItem(ui.getByRole("button", { name: "Saved conversations" }), "Export conversation…");
    await waitFor(() => expect(exportConversation).toHaveBeenCalledWith({
      projectId: "paper",
      session: expect.objectContaining({ id: "saved" }),
      projectName: "Thesis",
      agentName: "Research CLI",
    }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Conversation exported"));
  });

  it("reports an export failure in the assistant", async () => {
    vi.mocked(exportConversation).mockRejectedValue(new Error("Disk is full"));
    const ui = render(
      <>
        <AssistantShellAcpActions projectId="paper" />
        <AcpWorkspaceAssistant projectId="paper" />
      </>,
    );
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · ready"));
    await chooseMenuItem(ui.getByRole("button", { name: "Saved conversations" }), "Export conversation…");
    expect(await ui.findByRole("alert")).toHaveTextContent("Disk is full");
    expect(within(ui.container).queryByText("Conversation exported")).toBeNull();
  });
});

describe("CLI history menu details", () => {
  function workspace() {
    return render(
      <>
        <AssistantShellAcpActions projectId="paper" />
        <AcpWorkspaceAssistant projectId="paper" />
      </>,
    );
  }

  it("stays quiet when the export is cancelled and leaves an unnamed project out", async () => {
    useFilesStore.setState({ projectName: "" });
    vi.mocked(exportConversation).mockResolvedValue(false);
    const ui = workspace();
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · ready"));

    await chooseMenuItem(ui.getByRole("button", { name: "Saved conversations" }), "Export conversation…");

    await waitFor(() => expect(exportConversation).toHaveBeenCalledWith(expect.objectContaining({ projectName: null })));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("names an untitled conversation and an agent that left the catalog", async () => {
    snapshots.old = { session: session("old", { title: "", agentId: "retired", updatedAt: 0 }), permissions: [] };
    const ui = workspace();
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · ready"));

    const names = await menuItemNames(ui.getByRole("button", { name: "Saved conversations" }));

    expect(names).toContain("Untitled conversation · retired");
  });

  it("does nothing when the open conversation is picked again", async () => {
    const ui = workspace();
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · ready"));
    const reads = vi.mocked(acpSnapshot).mock.calls.length;

    await chooseMenuItem(ui.getByRole("button", { name: "Saved conversations" }), "Conversation saved · Research CLI");

    expect(vi.mocked(acpSnapshot).mock.calls).toHaveLength(reads);
    expect(acpDisconnect).not.toHaveBeenCalled();
  });

  it("opens another conversation without disconnecting one that is already offline", async () => {
    snapshots.saved = { session: session("saved", { status: "disconnected" }), permissions: [] };
    snapshots.other = { session: session("other", { title: "Second thread", updatedAt: 0 }), permissions: [] };
    const ui = workspace();
    await waitFor(() => expect(ui.getByTestId("acp-session-status")).toHaveTextContent("Research CLI · disconnected"));

    await chooseMenuItem(ui.getByRole("button", { name: "Saved conversations" }), "Second thread · Research CLI");

    await waitFor(() => expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("other"));
    expect(acpDisconnect).not.toHaveBeenCalled();
  });
});

