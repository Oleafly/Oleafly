import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: mocks.Channel,
  isTauri: () => false,
}));
vi.mock("@/lib/pdf-text", () => ({ extractPdfText: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/toast", () => ({
  notifyError: vi.fn(),
  toast: {
    info: vi.fn(),
    infoUnique: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    errorUnique: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("@/components/editor/wysiwyg/controller", () => ({
  flushWysiwygPendingEdits: vi.fn(),
  invalidateWysiwygProjectSession: vi.fn(),
}));

import { applyLocale } from "@/i18n";
import deErrors from "@/i18n/locales/de/errors.json" with { type: "json" };
import { runAgentHarness } from "@/components/ai/agent-turn";
import type { AgentEvent } from "@/lib/agent-backend";
import { createOleaflyTools } from "@/lib/ai-tools";
import type { ToolSet } from "@/lib/chat-types";
import { LATEX_ENGINE } from "@/lib/document-engine";
import { SaveFlushError, useFilesStore } from "@/store/files";

const refused = `@oleafly/error:${JSON.stringify({
  code: "project.folder_read_only",
  params: { name: "figures/notes.tex" },
  detail: null,
})}`;
const german = deErrors.project.folder_read_only.replace("{{name}}", "figures/notes.tex");

function handlers() {
  return {
    onActivity: vi.fn(),
    onThinking: vi.fn(),
    onText: vi.fn(),
    onReasoningStart: vi.fn(),
    onReasoningDelta: vi.fn(),
    onReasoningEnd: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onUsage: vi.fn(),
    onStep: vi.fn(),
    onRetry: vi.fn(),
    onSubagentUpdate: vi.fn(),
    onSteered: vi.fn(),
  };
}

describe("a write tool stopped by an open file that cannot be saved", () => {
  const posted: unknown[] = [];
  const written: string[] = [];

  beforeEach(async () => {
    await applyLocale("de");
    posted.length = 0;
    written.length = 0;
    mocks.invoke.mockReset().mockImplementation(async (command: string, args: Record<string, unknown>) => {
      if (command === "write_file") {
        written.push(String(args.path));
        if (args.path === "figures/notes.tex") throw refused;
        return { path: args.path, generation: 1 };
      }
      if (command === "project_mutation_generation") return 0;
      if (command === "agent_tool_result") {
        posted.push(args.output);
        return undefined;
      }
      if (command === "agent_run") {
        const channel = args.onEvent as { onmessage: ((event: AgentEvent) => void) | null };
        channel.onmessage?.({
          kind: "toolRequest",
          id: "tool-1-1-call_1",
          name: "write_file",
          arguments: JSON.stringify({ path: "main.tex", content: "revised" }),
        });
        await vi.waitFor(() => expect(posted).toHaveLength(1));
        channel.onmessage?.({ kind: "runEnd" });
        return { text: "", usage: { input: 0, output: 0 }, steps: 1, stopped_at_cap: false, error: null };
      }
      return undefined;
    });
    useFilesStore.setState({
      projectId: "proj",
      mainDoc: "main.tex",
      manifestHome: "device",
      engine: LATEX_ENGINE,
      engineLoaded: true,
      files: { "figures/notes.tex": { content: "notes", dirty: true } },
      openTabs: ["figures/notes.tex"],
      activePath: "figures/notes.tex",
    });
  });

  afterEach(async () => {
    useFilesStore.setState({ projectId: null, files: {}, openTabs: [], activePath: null });
    await applyLocale("en");
  });

  it("keeps the coded error on the failure and shows the sentence in the interface language", async () => {
    const failure = await useFilesStore
      .getState()
      .prepareExternalMutation("proj")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SaveFlushError);
    expect((failure as SaveFlushError).failures).toEqual([{ path: "figures/notes.tex", reason: refused }]);
    expect((failure as SaveFlushError).message).toBe(`figures/notes.tex: ${german}`);
  });

  it("hands the backend the exact coded error, not the German sentence", async () => {
    const outcome = handlers();

    await runAgentHarness({
      system: "sys",
      messages: [{ role: "user", content: "revise main.tex" }],
      tools: createOleaflyTools() as unknown as ToolSet,
      signal: new AbortController().signal,
      handlers: outcome,
    });

    expect(written).toEqual(["figures/notes.tex"]);
    expect(posted).toEqual([{ output: JSON.stringify({ error: refused }), images: [] }]);
    expect(outcome.onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: "write_file", output: { error: refused } }),
    );
    expect(useFilesStore.getState().files["figures/notes.tex"]).toMatchObject({ dirty: true });
  });
});
