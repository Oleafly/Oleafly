// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantLayoutParts, AssistantScopeValue } from "@/components/ai/assistant-scope";
import type { ChatComposerHandle } from "@/components/ai/composer/ChatComposer";
import { loadNamespace } from "@/i18n";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import type { AcpAgentStatus, AcpEvent, AcpSession } from "@/lib/acp";
import { useAcpSessionsStore, type AcpSelection } from "@/store/acp-sessions";
import { selectScopeRuntime, useAssistantRuntimeStore } from "@/store/assistant-runtime";
import { useChatsStore } from "@/store/chats";
import { beginChatRun, activeChatRun, endChatRun } from "@/components/ai/chat-run-registry";
import { NoteAssistant, type NoteAssistantHandle, type NoteEditorBridge } from "./NoteAssistant";
import { pendingBatches, registerNoteEditor, resetPendingSuggestionsForTest } from "./note-pending-suggestions";
import { PROMPT_COLLAPSED_KEY } from "./note-prefs";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

const ui = vi.hoisted(() => ({
  scope: null as AssistantScopeValue | null,
  parts: {} as Partial<AssistantLayoutParts>,
  handle: {
    focus: vi.fn(),
    setCaret: vi.fn(),
    insertText: vi.fn(),
    openFilePicker: vi.fn(),
  },
  acpProps: null as null | {
    projectId: string;
    slot?: string;
    projectName?: string;
    variant?: string;
    tree?: unknown;
    extraSelections?: () => readonly AcpSelection[];
  },
}));

const tauri = vi.hoisted(() => ({
  listFiles: vi.fn(async () => [{ path: "assets/plot.png", is_dir: false }]),
  listNoteTags: vi.fn(async () => []),
  noteHeads: vi.fn(async () => [{ id: "note-1", head: "---\nid: link-1\n---\n" }]),
  noteSearch: vi.fn(async () => []),
}));
const acpLib = vi.hoisted(() => ({ acpCancel: vi.fn(async () => {}) }));
const listeners = vi.hoisted(() => ({ attach: vi.fn(async () => () => {}) }));

vi.mock("@/lib/tauri", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tauri")>()), ...tauri }));
vi.mock("@/lib/acp", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/acp")>()), ...acpLib }));
vi.mock("@/store/acp-sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/acp-sessions")>()),
  attachAcpListeners: listeners.attach,
}));

vi.mock("@/components/ai/ChatCore", async () => {
  const { useProvidedAssistantScope } = await import("@/components/ai/assistant-scope");
  const { createElement } = await import("react");
  return {
    ChatCore: () => {
      const scope = useProvidedAssistantScope();
      ui.scope = scope;
      if (scope?.composer?.handle) {
        (scope.composer.handle as { current: ChatComposerHandle | null }).current = ui.handle;
      }
      const parts: AssistantLayoutParts = {
        working: false,
        hasMessages: false,
        scrollRef: { current: null },
        onScroll: () => {},
        messages: createElement("p", null, "Messages here"),
        footer: createElement("p", null, "Footer here"),
        composer: scope?.composer?.frame?.(createElement("div", { "data-chat-composer": "" }, createElement("textarea", { "aria-label": "Box" })), false) ?? null,
        dialogs: null,
        newChat: vi.fn(),
        openHistory: vi.fn(),
        stop: vi.fn(),
        chatCount: 0,
        canStartChat: true,
        setup: null,
        ...ui.parts,
      };
      return createElement("div", { "data-testid": "chat-core" }, scope?.layout?.render(parts));
    },
  };
});

vi.mock("@/components/ai/acp/AcpWorkspaceAssistant", () => ({
  AcpWorkspaceAssistant: (props: NonNullable<typeof ui.acpProps>) => {
    ui.acpProps = props;
    return <div data-testid="acp-assistant" data-project={props.projectId} data-slot={props.slot} />;
  },
}));

const NOTE: NoteItem = { id: "note-1", title: "Masks", project: "Encoder study", updatedAt: 1, author: "you", summary: "" };
const SOURCE = "---\ntitle: Masks\nid: link-1\n---\n\nRatio 0.75.";
const AGENT = {
  definition: { id: "claude", name: "Claude Code" },
  installed: true,
  executable: "/bin/claude",
} as unknown as AcpAgentStatus;

function data(extra: Partial<NotesData> = {}): NotesData {
  return {
    notes: [NOTE, { ...NOTE, id: "note-2", title: "Ablations" }],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    projects: [{ id: "paper", name: "Encoder paper" }],
    loadNote: vi.fn(async (id: string) => ({ text: `# ${id}`, version: "v" })),
    saveNote: vi.fn(),
    ...extra,
  } as NotesData;
}

function bridge(): NoteEditorBridge & { propose: ReturnType<typeof vi.fn> } {
  return { readSource: () => SOURCE, pending: () => 0, propose: vi.fn(() => 1) };
}

function show(options: { note?: NoteItem; notes?: NotesData; bridge?: NoteEditorBridge; viewOnly?: boolean } = {}) {
  const ref = createRef<NoteAssistantHandle>();
  const scope = { current: document.createElement("div") };
  const editor = options.bridge ?? bridge();
  const tree = (note: NoteItem) => (
    <NotesDataProvider value={options.notes ?? data()}>
      <NoteAssistant
        ref={ref}
        note={note}
        bridge={editor}
        shortcutScope={scope}
        viewOnly={options.viewOnly}
      />
    </NotesDataProvider>
  );
  const view = render(tree(options.note ?? NOTE));
  return { ...view, ref, editor, rerenderNote: (note: NoteItem) => view.rerender(tree(note)) };
}

function session(id: string, status: AcpSession["status"]): AcpSession {
  return { id, projectId: "paper", agentId: "claude", status, lastSequence: 0 } as AcpSession;
}

beforeAll(async () => {
  await loadNamespace("notes");
  await loadNamespace("ai");
});

beforeEach(() => {
  localStorage.clear();
  ui.scope = null;
  ui.parts = {};
  ui.acpProps = null;
  for (const fn of Object.values(ui.handle)) fn.mockClear();
  acpLib.acpCancel.mockClear();
  useAssistantRuntimeStore.setState({ runtime: "built-in", handoffRuntime: null, runtimeByScope: {} });
  useAcpSessionsStore.setState({ catalog: [], sessions: {}, activeByProject: {}, events: {}, composers: {} });
  vi.spyOn(useAcpSessionsStore.getState(), "refreshCatalog").mockResolvedValue(true);
  useChatsStore.setState({ shownByScope: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetPendingSuggestionsForTest();
});

describe("the note assistant", () => {
  it("hosts the real assistant scoped to the note", async () => {
    show();
    await waitFor(() => expect(ui.scope?.key).toBe("note:note-1"));
    const scope = ui.scope as AssistantScopeValue;
    expect(scope).toMatchObject({ kind: "note", projectId: "note-1", projectName: "Masks" });
    await waitFor(() => expect(scope.currentTree()).toEqual([{ path: "assets/plot.png", is_dir: false }]));
    expect(tauri.listFiles).toHaveBeenCalledWith("note-1");
    expect(scope.composer?.placeholder).toBe(enNotes.assistant.placeholder);
    expect(scope.excludedNames).toContain("research_task_create");
    expect(scope.mentions?.paths).toEqual(["note:Ablations"]);
    const context = await scope.contextBlock?.("q");
    expect(context).toContain(`Note: "Masks" (id note-1, link id link-1)`);
    expect(scope.systemPrompt?.({ tools: [], context: "", goalLine: "", custom: "" })).toContain(
      "Link to it with oleafly://note/link-1.",
    );
    expect(screen.getByText("Footer here")).toBeInTheDocument();
    expect(screen.queryByText("Messages here")).toBeNull();
  });

  it("uses the project as its folder for a note kept inside a project", async () => {
    show({
      note: { ...NOTE, id: "project-note:paper:p1", relatedProjectId: "paper", home: { projectId: "paper", path: "notes/Plan.md" } },
    });
    await waitFor(() => expect(ui.scope?.key).toBe("note:project-note:paper:p1"));
    expect(ui.scope).toMatchObject({ projectId: "paper" });
    await waitFor(() => expect(tauri.listFiles).toHaveBeenCalledWith("paper"));
    expect(ui.scope?.mainDoc()).toBe("notes/Plan.md");
  });

  it("offers the research actions as slash commands that send their task", async () => {
    const latestRun = vi.fn(() => "Best ratio 0.6");
    show({ notes: data({ latestRun }), note: { ...NOTE, relatedProjectId: "paper" } });
    await waitFor(() => expect(ui.scope).not.toBeNull());
    const send = vi.fn();
    const commands = ui.scope?.composer?.slashCommands?.(send) ?? [];
    expect(commands.map((command) => command.id)).toContain("research:latestRun");
    expect(commands.map((command) => command.id)).toContain("research:claims");
    commands.find((command) => command.id === "research:latestRun")?.action();
    expect(send).toHaveBeenCalledWith(expect.stringContaining("<run>\nBest ratio 0.6\n</run>"));
    expect(ui.scope?.excludedNames).not.toContain("research_task_create");
    expect(latestRun).toHaveBeenCalledWith("note-1");
  });

  it("hides the latest run and claims actions until they can work", async () => {
    show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    const ids = (ui.scope?.composer?.slashCommands?.(vi.fn()) ?? []).map((command) => command.id);
    expect(ids).not.toContain("research:latestRun");
    expect(ids).not.toContain("research:claims");
    expect(ids).toContain("research:proofread");
  });

  it("shows the conversation above the composer, folds it to a strip and opens it again", async () => {
    ui.parts = { hasMessages: true, chatCount: 2 };
    show();
    const region = await screen.findByRole("region", { name: enNotes.assistant.conversation });
    expect(within(region).getByText("Messages here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enNotes.assistant.foldConversation }));
    expect(screen.queryByRole("region", { name: enNotes.assistant.conversation })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: enNotes.assistant.showConversation }));
    expect(screen.getByRole("region", { name: enNotes.assistant.conversation })).toBeInTheDocument();
  });

  it("starts a new chat and opens this note's chats from the conversation", async () => {
    const newChat = vi.fn();
    const openHistory = vi.fn();
    ui.parts = { hasMessages: true, chatCount: 3, newChat, openHistory };
    show();
    fireEvent.click(await screen.findByRole("button", { name: enNotes.assistant.newChat }));
    fireEvent.click(screen.getByRole("button", { name: enAi.header.chatHistory }));
    expect(newChat).toHaveBeenCalledOnce();
    expect(openHistory).toHaveBeenCalledOnce();
  });

  it("offers past chats while the conversation is empty", async () => {
    const openHistory = vi.fn();
    ui.parts = { hasMessages: false, chatCount: 1, openHistory };
    show();
    fireEvent.click(await screen.findByRole("button", { name: enAi.header.chatHistory }));
    expect(openHistory).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: enNotes.assistant.newChat })).toBeNull();
  });

  it("keeps the glow on while a turn runs and stops it from the pill", async () => {
    const stop = vi.fn();
    ui.parts = { working: true, hasMessages: true, stop };
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    show();
    const stopButton = await screen.findByRole("button", { name: enAi.composer.stop });
    fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("folds into the pill from the composer's collapse button", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: enNotes.prompt.collapse }));
    expect(document.querySelector("[data-prompt-state]")).toHaveAttribute("data-prompt-state", "collapsed");
  });

  it("puts a quoted selection at the start of the composer and focuses through its handle", async () => {
    const { ref } = show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    act(() => ref.current?.quote("  "));
    expect(ui.handle.insertText).not.toHaveBeenCalled();
    act(() => ref.current?.quote("mask ratio\nper pixel"));
    await waitFor(() => expect(ui.handle.insertText).toHaveBeenCalledWith("> mask ratio\n> per pixel\n\n"));
    expect(ui.handle.setCaret).toHaveBeenCalledWith(0);
    act(() => ref.current?.focus());
    await waitFor(() => expect(ui.handle.focus).toHaveBeenCalled());
  });

  it("switches to a CLI agent picked in the model menu", async () => {
    useAcpSessionsStore.setState({ catalog: [AGENT] });
    vi.spyOn(await import("@/lib/acp"), "acpUsable").mockReturnValue(true);
    show({ note: { ...NOTE, relatedProjectId: "paper" } });
    await waitFor(() => expect(ui.scope?.composer?.modelGroups?.[0].models).toEqual([{ id: "claude", name: "Claude Code" }]));
    expect(ui.scope?.composer?.onPickModelGroup?.("openai", "gpt")).toBe(false);
    act(() => {
      expect(ui.scope?.composer?.onPickModelGroup?.("note-cli-agents", "claude")).toBe(true);
    });
    expect(selectScopeRuntime("note:note-1")(useAssistantRuntimeStore.getState())).toBe("acp");
    expect(useAcpSessionsStore.getState().composers["paper#note-note-1"]?.agentId).toBe("claude");
    const acp = await screen.findByTestId("acp-assistant");
    expect(acp).toHaveAttribute("data-project", "paper");
    expect(acp).toHaveAttribute("data-slot", "paper#note-note-1");
    expect(ui.acpProps?.variant).toBe("note");
    expect(ui.acpProps?.tree).toBeUndefined();
    const [context] = ui.acpProps?.extraSelections?.() ?? [];
    expect(context?.text).toContain('<note title="Masks">');
    expect(screen.getByRole("group", { name: enAi.runtime.ariaLabel })).toBeInTheDocument();
    expect(screen.getByText(enNotes.assistant.agentCanEdit)).toBeInTheDocument();
    act(() => {
      useAcpSessionsStore.setState({
        sessions: {
          s9: {
            ...session("s9", "running"),
            controls: { models: [], modelId: null, modelConfigId: null, modes: [{ id: "plan", name: "Plan", description: null, blocked: false }], modeId: "plan" },
          },
        },
        activeByProject: { "paper#note-note-1": "s9" },
      });
    });
    expect(screen.queryByText(enNotes.assistant.agentCanEdit)).toBeNull();
  });

  it("runs a CLI agent in the note's folder, turns its replies into suggestions and releases it on close", async () => {
    useAssistantRuntimeStore.getState().setScopeRuntime("note:note-1", "acp");
    const releaseSlot = vi.spyOn(useAcpSessionsStore.getState(), "releaseSlot").mockResolvedValue();
    const editor = bridge();
    const view = show({ bridge: editor, note: { ...NOTE, relatedProjectId: "paper" } });
    await screen.findByTestId("acp-assistant");
    act(() => {
      useAcpSessionsStore.setState({
        sessions: { s1: session("s1", "running") },
        activeByProject: { "paper#note-note-1": "s1" },
      });
    });
    const stopButtons = () => screen.queryAllByRole("button", { name: enAi.composer.stop });
    act(() => {
      localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    });
    expect(document.querySelector("[data-working]")).not.toBeNull();
    const now = Date.now() + 1000;
    const events: AcpEvent[] = [
      { sessionId: "s1", projectId: "paper", agentId: "claude", modelId: null, taskId: null, turnId: "t1", sequence: 1, timestamp: now, kind: "agent_message_chunk", data: { content: { type: "text", text: "<<<<<<< FIND\n0.75\n=======\n0.6\n>>>>>>> REPLACE" } } },
      { sessionId: "s1", projectId: "paper", agentId: "claude", modelId: null, taskId: null, turnId: "t1", sequence: 2, timestamp: now, kind: "turn_complete", data: {} },
    ];
    act(() => {
      useAcpSessionsStore.setState({ events: { s1: events } });
    });
    expect(editor.propose).toHaveBeenCalledWith([{ find: "0.75", replace: "0.6" }]);
    expect(stopButtons()).toHaveLength(0);
    view.unmount();
    expect(releaseSlot).toHaveBeenCalledWith("paper#note-note-1");
  });

  it("stops a running CLI turn from the pill", async () => {
    useAssistantRuntimeStore.getState().setScopeRuntime("note:note-1", "acp");
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    show();
    await screen.findByTestId("acp-assistant");
    expect(ui.acpProps).toMatchObject({ projectId: "note-1", slot: "note-1" });
    expect(ui.acpProps?.tree).toEqual(expect.any(Array));
    act(() => {
      useAcpSessionsStore.setState({ sessions: { s2: session("s2", "running") }, activeByProject: { "note-1": "s2" } });
    });
    fireEvent.click(await screen.findByRole("button", { name: enAi.composer.stop }));
    expect(acpLib.acpCancel).toHaveBeenCalledWith("note-1", "s2");
  });

  it("quotes into the CLI agent's prompt as a selection", async () => {
    useAssistantRuntimeStore.getState().setScopeRuntime("note:note-1", "acp");
    const { ref } = show();
    await screen.findByTestId("acp-assistant");
    act(() => ref.current?.quote("mask ratio"));
    act(() => ref.current?.quote("per pixel"));
    expect(useAcpSessionsStore.getState().composers["note-1"]?.selections?.map((selection) => selection.text)).toEqual([
      "mask ratio",
      "per pixel",
    ]);
  });

  function seedScope() {
    useChatsStore.setState({
      shownByScope: { "note:note-1": { projectId: "note-1", chats: [], activeId: null, skippedOnLoad: 0 } as never },
    });
  }

  it("keeps its run going when the note closes and forgets the scope once the run ends", async () => {
    const view = show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    seedScope();
    const controller = new AbortController();
    const run = beginChatRun(controller, "note-1", "note:note-1");
    view.unmount();
    expect(controller.signal.aborted).toBe(false);
    expect(activeChatRun("note:note-1")).toBe(run);
    expect(useChatsStore.getState().shownByScope["note:note-1"]).toBeDefined();
    endChatRun(run);
    expect(useChatsStore.getState().shownByScope["note:note-1"]).toBeUndefined();
  });

  it("forgets its scope at once when the note closes with nothing running", async () => {
    const view = show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    seedScope();
    view.unmount();
    expect(useChatsStore.getState().shownByScope["note:note-1"]).toBeUndefined();
  });

  it("keeps its scope for a note opened again before the run ends", async () => {
    const view = show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    const run = beginChatRun(new AbortController(), "note-1", "note:note-1");
    view.unmount();
    show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    seedScope();
    endChatRun(run);
    expect(useChatsStore.getState().shownByScope["note:note-1"]).toBeDefined();
  });

  it("reads the saved note and keeps proposed edits for later once the note's editor has closed", async () => {
    const loadNote = vi.fn(async () => ({ text: SOURCE, version: "v" }));
    const view = show({ notes: data({ loadNote }) });
    await waitFor(() => expect(ui.scope).not.toBeNull());
    const confirm = vi.fn(async () => true);
    const tools = ui.scope?.toolAdditions?.({ projectId: "note-1", confirm, onImage: vi.fn(), runId: () => null, isActive: () => true })[0].tools ?? {};
    view.unmount();
    const result = await tools.propose_note_edits.execute?.({ edits: [{ find: "Ratio 0.75.", replace: "Ratio 0.6." }] });
    expect(result).toMatchObject({ success: true, suggestions: 1 });
    expect(pendingBatches("note-1")).toEqual([[{ find: "Ratio 0.75.", replace: "Ratio 0.6." }]]);
    expect(await tools.read_note.execute?.({})).toMatchObject({ markdown: SOURCE.replace("0.75", "0.6") });
    expect(loadNote).toHaveBeenCalledWith("note-1");
    const link = { readSource: () => "---\nid: link-1\n---\n\nOpen again.", propose: vi.fn(() => 2), pending: () => 0 };
    const stop = registerNoteEditor("note-1", link);
    expect(await tools.read_note.execute?.({})).toMatchObject({ markdown: link.readSource() });
    await tools.propose_note_edits.execute?.({ edits: [{ find: "Open again.", replace: "Opened." }] });
    expect(link.propose).toHaveBeenCalledWith([{ find: "Open again.", replace: "Opened." }]);
    stop();
  });

  it("remembers the model picked for each note", async () => {
    const view = show();
    await waitFor(() => expect(ui.scope).not.toBeNull());
    ui.scope?.modelMemory?.save({ providerId: "openai", modelId: "gpt-5" });
    view.unmount();
    show({ note: { ...NOTE, id: "note-9" } });
    await waitFor(() => expect(ui.scope?.key).toBe("note:note-9"));
    expect(ui.scope?.modelMemory?.read()).toEqual({ providerId: "openai", modelId: "gpt-5" });
  });

  it("asks before a linked note's agent without a read-only mode gets a message", async () => {
    useAssistantRuntimeStore.getState().setScopeRuntime("note:note-1", "acp");
    useAcpSessionsStore.setState({ catalog: [{ ...AGENT, definition: { id: "gemini", name: "Gemini CLI" } } as AcpAgentStatus] });
    const sendPrompt = vi.spyOn(useAcpSessionsStore.getState(), "sendPrompt");
    show({ note: { ...NOTE, relatedProjectId: "paper" } });
    await screen.findByTestId("acp-assistant");
    const shown = {
      ...session("g1", "ready"),
      agentId: "gemini",
      controls: { models: [], modelId: null, modelConfigId: null, modes: [{ id: "default", name: "Default", description: null, blocked: false }], modeId: "default" },
    } as AcpSession;
    act(() => {
      useAcpSessionsStore.setState({ sessions: { g1: shown }, activeByProject: { "paper#note-note-1": "g1" }, queues: {}, sending: {} });
    });
    const gated = useAcpSessionsStore.getState().sendPrompt("paper#note-note-1", "g1", {
      text: "Summarise",
      attachments: [],
      mentions: [],
      selections: [],
      skill: null,
    });
    const card = await screen.findByRole("region", { name: enNotes.assistant.allowWritesLabel });
    expect(card).toHaveTextContent("Gemini CLI has no read-only mode, so it could change files in Encoder paper.");
    fireEvent.click(within(card).getByRole("button", { name: enNotes.assistant.dontSend }));
    expect(await gated).toBe(false);
    expect(screen.queryByRole("region", { name: enNotes.assistant.allowWritesLabel })).toBeNull();
    expect(sendPrompt).toHaveBeenCalledOnce();
  });

  it("keeps watching a CLI turn in the note's folder after the note closes", async () => {
    useAssistantRuntimeStore.getState().setScopeRuntime("note:note-1", "acp");
    const loadNote = vi.fn(async () => ({ text: SOURCE, version: "v1" }));
    const saveNote = vi.fn(async (_id: string, text: string, version: string) => ({ text, version }));
    const view = show({ notes: data({ loadNote, saveNote }) });
    await screen.findByTestId("acp-assistant");
    act(() => {
      useAcpSessionsStore.setState({ sessions: { s5: session("s5", "running") }, activeByProject: { "note-1": "s5" }, queues: {}, sending: {} });
    });
    vi.spyOn(useAcpSessionsStore.getState(), "resync").mockResolvedValue();
    listeners.attach.mockClear();
    view.unmount();
    expect(listeners.attach).toHaveBeenCalledOnce();
    await waitFor(() => expect(loadNote).toHaveBeenCalledWith("note-1"));
    loadNote.mockResolvedValue({ text: SOURCE.replace("0.75", "0.6"), version: "v2" });
    act(() => {
      useAcpSessionsStore.setState({ sessions: { s5: session("s5", "ready") } });
    });
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith("note-1", SOURCE, "v2"));
    await waitFor(() => expect(pendingBatches("note-1")).toEqual([[{ find: "Ratio 0.75.", replace: "Ratio 0.6." }]]));
  });

  it("creates notes through the Notes create path when it is offered", async () => {
    const createNoteFrom = vi.fn(async () => "note-new");
    show({ notes: data({ createNoteFrom } as Partial<NotesData>) });
    await waitFor(() => expect(ui.scope).not.toBeNull());
    const confirm = vi.fn(async () => true);
    const tools = ui.scope?.toolAdditions?.({ projectId: "note-1", confirm, onImage: vi.fn(), runId: () => null, isActive: () => true })[0].tools ?? {};
    await tools.create_note.execute?.({ title: "Reading list", body: "- A" });
    expect(createNoteFrom).toHaveBeenCalledWith({ title: "Reading list", body: "- A", tags: [], relatedProject: null });
    await tools.search_notes.execute?.({ query: "ratio" });
    expect(tauri.noteSearch).toHaveBeenCalledWith("ratio", 10);
    await tools.list_knowledge_notes.execute?.({});
    expect(tauri.listNoteTags).toHaveBeenCalled();
    expect(await tools.read_note_by_id.execute?.({ id: "note-2" })).toMatchObject({ markdown: "# note-2" });
    expect(await tools.read_note.execute?.({})).toMatchObject({ markdown: SOURCE });
  });

  it("keeps personal notes out of a shared note's assistant", async () => {
    for (const fn of [tauri.noteSearch, tauri.listNoteTags, tauri.noteHeads]) fn.mockClear();
    show({ note: { ...NOTE, shared: true } });
    await waitFor(() => expect(ui.scope).not.toBeNull());
    const scope = ui.scope as AssistantScopeValue;
    expect(scope.excludedNames).toEqual(expect.arrayContaining(["search_notes", "list_knowledge_notes", "read_note_by_id"]));
    expect(scope.mentions?.paths).toEqual([]);
    const context = await scope.contextBlock?.("q");
    expect(context).not.toContain("Ablations");
    expect(context).toContain(`Note: "Masks" (id note-1, link id link-1)`);
    const tools = scope.toolAdditions?.({ projectId: "note-1", confirm: vi.fn(), onImage: vi.fn(), runId: () => null, isActive: () => true })[0].tools ?? {};
    expect(await tools.search_notes.execute?.({ query: "ratio" })).toMatchObject({ notes: [] });
    expect(await tools.list_knowledge_notes.execute?.({})).toMatchObject({ notes: [] });
    expect(await tools.read_note_by_id.execute?.({ id: "note-2" })).toHaveProperty("error");
    expect(tauri.noteSearch).not.toHaveBeenCalled();
    expect(tauri.listNoteTags).not.toHaveBeenCalled();
    expect(tauri.noteHeads).not.toHaveBeenCalled();
  });

  it("turns the composer into a plain notice for a note the person can only view", async () => {
    const view = show({ viewOnly: true });
    expect(await screen.findByText(enNotes.assistant.viewOnly)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Box" })).toBeNull();
    act(() => view.ref.current?.quote("Ratio 0.75."));
    expect(ui.handle.insertText).not.toHaveBeenCalled();
    view.rerender(
      <NotesDataProvider value={data()}>
        <NoteAssistant note={NOTE} bridge={bridge()} shortcutScope={{ current: null }} />
      </NotesDataProvider>,
    );
    expect(await screen.findByRole("textbox", { name: "Box" })).toBeInTheDocument();
    expect(screen.queryByText(enNotes.assistant.viewOnly)).toBeNull();
  });

  it("shows the view-only notice in place of a CLI agent", async () => {
    useAssistantRuntimeStore.setState({ runtimeByScope: { "note:note-1": "acp" } });
    show({ viewOnly: true, note: { ...NOTE, relatedProjectId: "paper" } });
    expect(await screen.findByText(enNotes.assistant.viewOnly)).toBeInTheDocument();
    expect(screen.queryByTestId("acp-assistant")).toBeNull();
  });

  it("asks for the agent list once when several notes open together", async () => {
    const refresh = vi.mocked(useAcpSessionsStore.getState().refreshCatalog);
    refresh.mockClear();
    render(
      <NotesDataProvider value={data()}>
        <NoteAssistant note={NOTE} bridge={bridge()} shortcutScope={{ current: null }} />
        <NoteAssistant note={{ ...NOTE, id: "note-2", title: "Ablations" }} bridge={bridge()} shortcutScope={{ current: null }} />
      </NotesDataProvider>,
    );
    await waitFor(() => expect(ui.scope).not.toBeNull());
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
