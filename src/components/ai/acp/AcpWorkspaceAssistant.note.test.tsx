import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as renderWithoutProviders, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});
const skillState = vi.hoisted(() => ({ data: [] as unknown[] }));
const intake = vi.hoisted(() => ({ intakeFiles: vi.fn() }));
vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpCatalog: vi.fn(), acpSessions: vi.fn(), acpSnapshot: vi.fn(), acpEvents: vi.fn(),
  acpStart: vi.fn(), acpAuthenticate: vi.fn(), acpDisconnect: vi.fn(), acpReconnect: vi.fn(),
  acpSetModel: vi.fn(), acpPrompt: vi.fn(), acpPermission: vi.fn(), acpCancel: vi.fn(),
  acpSignInCommand: vi.fn(), acpElicitationRespond: vi.fn(), acpCancelStart: vi.fn(),
  onAcpEvent: vi.fn(), onAcpResync: vi.fn(),
  onAcpSession: vi.fn(async () => () => {}), onAcpBufferRequest: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/attachments-intake", () => ({ intakeFiles: intake.intakeFiles }));
vi.mock("@/lib/tauri", async (original) => ({
  ...await original<typeof import("@/lib/tauri")>(),
  gitIsInitialized: vi.fn(),
}));
vi.mock("@/lib/external-file-changes", async (original) => ({
  ...await original<typeof import("@/lib/external-file-changes")>(),
  flushOpenFilesToDisk: vi.fn(),
}));
vi.mock("@/components/layout/CleanLibraryDialog", () => ({
  CleanLibraryDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="clean-library-dialog">
      <button type="button" onClick={onClose}>{"Close cleanup"}</button>
    </div>
  ),
}));
vi.mock("@/lib/skills", async (original) => ({
  ...await original<typeof import("@/lib/skills")>(),
  useSkills: () => ({ data: skillState.data, isPending: false, isFetching: false }),
}));
vi.mock("@/components/usage/UsageReport", () => ({
  UsageReportDialog: ({ trigger }: { trigger: ReactNode }) => trigger,
}));
import type { ReactNode } from "react";
import {
  acpCatalog, acpDisconnect, acpEvents, acpPrompt, acpSessions, acpSnapshot,
  onAcpEvent, onAcpResync, type AcpEvent, type AcpPromptInput, type AcpSnapshot,
} from "@/lib/acp";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import { flushOpenFilesToDisk } from "@/lib/external-file-changes";
import { gitIsInitialized } from "@/lib/tauri";
import { acpComposerId, useAcpSessionsStore } from "@/store/acp-sessions";
import { useComposerDrafts } from "@/store/composer-drafts";
import { useSettingsStore } from "@/store/settings";
import { useTerminalsStore } from "@/store/terminals";
import { agent, session } from "./tests/ui-fixtures";
import { AcpWorkspaceAssistant } from "./AcpWorkspaceAssistant";

function render(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithoutProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}



const SLOT_KEY = "paper#note-n1";
let snapshots: Record<string, AcpSnapshot>;
let history: Record<string, AcpEvent[]>;

beforeAll(async () => {
  await import("@/lib/terminal-launch");
});

beforeEach(() => {
  vi.resetAllMocks();
  skillState.data = [];
  snapshots = { saved: { session: session(), permissions: [] } };
  history = { saved: [] };
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, events: {}, permissions: {}, activeByProject: { [SLOT_KEY]: "saved", paper: "work" }, composers: {}, queues: {}, errors: {}, starting: {} });
  useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general", settingsScrollTarget: null, terminalOpen: false });
  useTerminalsStore.setState({ projectId: null, tabs: [], activeId: null, counters: {} });
  useComposerDrafts.setState({ drafts: {} });
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
  vi.mocked(onAcpEvent).mockResolvedValue(() => {});
  vi.mocked(onAcpResync).mockResolvedValue(() => {});
  vi.mocked(acpDisconnect).mockResolvedValue();
  vi.mocked(gitIsInitialized).mockResolvedValue(false);
  vi.mocked(flushOpenFilesToDisk).mockResolvedValue();
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

async function readyComposer(ui: ReturnType<typeof render>) {
  const composer = ui.getByLabelText(enAi.acp.composerAriaLabel);
  await waitFor(() => expect(composer).toBeEnabled());
  return composer as HTMLTextAreaElement;
}

function typeMessage(input: HTMLElement, value: string) {
  fireEvent.focusIn(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyUp(input, { key: "a" });
}

const SLOT = "paper#note-n1";
const composerId = acpComposerId(SLOT, "fixture", "saved");

function input(text: string, overrides: Partial<AcpPromptInput> = {}): AcpPromptInput {
  return { text, images: [], files: [], selections: [], skillId: null, ...overrides };
}




const CONTEXT = { id: "note-context", path: null, text: "You are working for the note.", label: "Masks" };

function noteAssistant(extra: { tree?: { path: string; is_dir: boolean }[] } = {}) {
  return (
    <AcpWorkspaceAssistant
      projectId="paper"
      slot={SLOT}
      projectName="Masks"
      variant="note"
      tree={extra.tree}
      extraSelections={() => [CONTEXT]}
    />
  );
}

describe("a CLI agent for a note", () => {
  it("talks to the project's session under the note's slot and sends the note as context", async () => {
    vi.mocked(acpPrompt).mockResolvedValue({ session: { ...session(), lastSequence: 1 }, permissions: [] });
    const ui = render(noteAssistant({ tree: [{ path: "assets/data.csv", is_dir: false }] }));
    const composer = await readyComposer(ui);
    typeMessage(composer, "Check @assets/data.csv against the note");
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() =>
      expect(acpPrompt).toHaveBeenCalledExactlyOnceWith(
        "paper",
        "saved",
        input("Check @assets/data.csv against the note", {
          files: [{ kind: "project", path: "assets/data.csv" }],
          selections: [{ path: null, text: "You are working for the note." }],
        }),
      ),
    );
    expect(acpSnapshot).toHaveBeenCalledWith("paper", "saved");
    expect(useAcpSessionsStore.getState().activeByProject).toEqual({ [SLOT]: "saved", paper: "work" });
    expect(useAcpSessionsStore.getState().composers[SLOT]?.selections ?? []).toEqual([]);
  });

  it("keeps the person's draft but not the note context when a prompt fails", async () => {
    vi.mocked(acpPrompt).mockRejectedValue(new Error("Agent offline"));
    const ui = render(noteAssistant());
    const composer = await readyComposer(ui);
    typeMessage(composer, "Summarise");
    fireEvent.keyDown(composer, { key: "Enter" });
    await waitFor(() => expect(useComposerDrafts.getState().drafts[composerId]?.text).toBe("Summarise"));
    expect(useAcpSessionsStore.getState().composers[SLOT]?.selections ?? []).toEqual([]);
  });

  it("leaves hand-offs to the workspace's CLI agent", async () => {
    const { useAgentHandoffStore } = await import("@/store/agent-handoff");
    useAgentHandoffStore.setState({ pendingPrompt: "From elsewhere", autoSend: false, target: "acp", pendingImages: [] });
    const ui = render(noteAssistant());
    await readyComposer(ui);
    expect(useAgentHandoffStore.getState().pendingPrompt).toBe("From elsewhere");
    useAgentHandoffStore.setState({ pendingPrompt: null });
  });
});
