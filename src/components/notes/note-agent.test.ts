import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpAgentStatus } from "@/lib/acp";
import type { AppConfig } from "@/lib/tauri";
import type { EditRequest } from "./types";

const backend = vi.hoisted(() => ({ streamViaBackend: vi.fn() }));
const route = vi.hoisted(() => ({ withCliAgentErrors: vi.fn() }));

vi.mock("@/lib/agent-backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-backend")>()),
  ...backend,
}));
vi.mock("@/lib/ai-route", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai-route")>()),
  ...route,
}));

const {
  choiceIn,
  defaultChoice,
  hiddenActions,
  NOTE_AGENT_STORAGE_KEY,
  NOTE_AGENT_SYSTEM,
  noteAgentGroups,
  notePrompt,
  parseNoteEdits,
  readSavedAgent,
  runNoteAgent,
  saveAgent,
} = await import("./note-agent");

const REQUEST: EditRequest = {
  noteId: "n",
  agent: { providerId: "acp:claude", modelId: "default", label: "Claude Code" },
  actionId: null,
  prompt: "",
  quote: null,
  source: "---\ntitle: T\n---\n\nThe ratio is 0.75.\n",
};

function agent(id: string, overrides: Partial<AcpAgentStatus> = {}): AcpAgentStatus {
  return {
    definition: { id, name: id.toUpperCase() },
    installed: true,
    bridge: { found: true },
    cli: { found: true },
    ...overrides,
  } as unknown as AcpAgentStatus;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function brokenStorage() {
  const fail = () => {
    throw new Error("storage is off");
  };
  return { getItem: vi.fn(fail), setItem: vi.fn(fail) };
}

beforeEach(() => {
  vi.clearAllMocks();
  route.withCliAgentErrors.mockImplementation((_route: unknown, work: () => Promise<unknown>) => work());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the note agent prompt", () => {
  it("names the task, the request, the selection and the note", () => {
    const prompt = notePrompt({ ...REQUEST, actionId: "shorter", prompt: "Keep it formal", quote: "The ratio" });
    expect(prompt).toContain("Task: Make the text shorter.");
    expect(prompt).toContain("Request: Keep it formal");
    expect(prompt).toContain("<selection>\nThe ratio\n</selection>");
    expect(prompt).toContain(`<note>\n${REQUEST.source}\n</note>`);
  });

  it("lists the project's references only for the citations action", () => {
    const citations = [{ key: "he2022", label: "He et al. 2022" }];
    expect(notePrompt({ ...REQUEST, actionId: "citations" }, citations)).toContain("- [@he2022] He et al. 2022");
    expect(notePrompt({ ...REQUEST, actionId: "citations" }, [])).toContain("no references in this project yet");
    expect(notePrompt({ ...REQUEST, actionId: "proofread" }, citations)).not.toContain("he2022");
  });

  it("hides the latest run action until there is a run, and always hides the claims check", () => {
    expect([...hiddenActions(false)].sort()).toEqual(["claims", "latestRun"]);
    expect([...hiddenActions(true)]).toEqual(["claims"]);
    expect(NOTE_AGENT_SYSTEM).toContain("<<<<<<< FIND");
  });

  it("hands the latest research task to the latest run action", () => {
    const run = "Task: Sweep mask ratios\nSummary:\nBest ratio 0.6";
    const prompt = notePrompt({ ...REQUEST, actionId: "latestRun", latestRun: run });
    expect(prompt).toContain("Task: Update the note with the results of the latest research task below.");
    expect(prompt).toContain(`The latest research task:\n<run>\n${run}\n</run>`);
    expect(prompt.indexOf("<run>")).toBeLessThan(prompt.indexOf("<note>"));
  });

  it("leaves the run out when there is none or another action runs", () => {
    expect(notePrompt({ ...REQUEST, actionId: "latestRun" })).not.toContain("<run>");
    expect(notePrompt({ ...REQUEST, actionId: "latestRun", latestRun: "" })).not.toContain("<run>");
    expect(notePrompt({ ...REQUEST, actionId: "proofread", latestRun: "Task: x" })).not.toContain("<run>");
    expect(notePrompt({ ...REQUEST, latestRun: "Task: x" })).not.toContain("<run>");
  });
});

describe("reading the agent's reply", () => {
  it("reads find and replace blocks, multi-line text and an empty find", () => {
    const reply = [
      "Here are the edits.",
      "```",
      "<<<<<<< FIND",
      "The ratio is 0.75.",
      "=======",
      "The ratio is 0.60.",
      "",
      "A new line.",
      ">>>>>>> REPLACE",
      "```",
      "<<<<<<< FIND",
      "=======",
      "Appended.",
      ">>>>>>> REPLACE",
    ].join("\n");
    expect(parseNoteEdits(reply)).toEqual({
      edits: [
        { find: "The ratio is 0.75.", replace: "The ratio is 0.60.\n\nA new line." },
        { find: "", replace: "Appended." },
      ],
      noChanges: false,
    });
  });

  it("drops edits that change nothing and blocks that never close", () => {
    const reply = "<<<<<<< FIND\nsame\n=======\nsame\n>>>>>>> REPLACE\n<<<<<<< FIND\nopen\n=======\nnever closed";
    expect(parseNoteEdits(reply)).toEqual({ edits: [], noChanges: false });
  });

  it("knows when the agent has nothing to change", () => {
    expect(parseNoteEdits("NO CHANGES")).toEqual({ edits: [], noChanges: true });
    expect(parseNoteEdits("I would not change anything.")).toEqual({ edits: [], noChanges: false });
  });

  it("accepts Windows line endings", () => {
    expect(parseNoteEdits("<<<<<<< FIND\r\na\r\n=======\r\nb\r\n>>>>>>> REPLACE\r\n").edits).toEqual([
      { find: "a", replace: "b" },
    ]);
  });
});

describe("choosing an agent", () => {
  const cfg = {
    ai_keys: { anthropic: "key" },
    ai_custom_providers: [],
    ai_provider_models: {},
  } as unknown as AppConfig;

  it("offers configured models and ready CLI agents that can stay read-only", () => {
    const groups = noteAgentGroups(cfg, [
      agent("claude", { runtime: { models: [{ modelId: "sonnet", name: "Sonnet" }] } } as Partial<AcpAgentStatus>),
      agent("codex", { runtime: { readOnly: false } } as Partial<AcpAgentStatus>),
      agent("missing", { installed: false, cli: { found: false } } as unknown as Partial<AcpAgentStatus>),
    ]);
    const cli = groups.filter((group) => group.id.startsWith("acp:"));
    expect(cli.map((group) => group.id)).toEqual(["acp:claude"]);
    expect(cli[0].models.map((model) => model.id)).toEqual(["default", "sonnet"]);
    expect(groups.some((group) => group.id === "anthropic")).toBe(true);
  });

  it("keeps an agent's own default model when it offers one", () => {
    const groups = noteAgentGroups({ ...cfg, ai_keys: {} } as AppConfig, [
      agent("claude", { runtime: { models: [{ modelId: "default", name: "Default" }] } } as Partial<AcpAgentStatus>),
    ]);
    expect(groups.find((group) => group.id === "acp:claude")?.models.map((model) => model.id)).toEqual(["default"]);
  });

  it("offers a ready agent with only its default model when the settings and the agent list nothing", () => {
    const groups = noteAgentGroups({} as AppConfig, [agent("gemini")]);
    expect(groups.find((group) => group.id === "acp:gemini")?.models.map((model) => model.id)).toEqual(["default"]);
    expect(groups.some((group) => group.id === "anthropic")).toBe(false);
  });

  it("labels CLI agents by agent and models by model", () => {
    const groups = [
      { id: "acp:claude", name: "Claude Code", models: [{ id: "default", name: "Default" }] },
      { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT" }] },
    ];
    expect(choiceIn(groups, "acp:claude", "default")).toEqual({ providerId: "acp:claude", modelId: "default", label: "Claude Code" });
    expect(choiceIn(groups, "openai", "gpt")).toEqual({ providerId: "openai", modelId: "gpt", label: "GPT" });
    expect(choiceIn(groups, "openai", "missing")).toBeNull();
    expect(choiceIn(groups, "gone", "gpt")).toBeNull();
  });

  it("prefers the saved choice, then the app's model, then the first one listed", () => {
    const groups = [
      { id: "empty", name: "Empty", models: [] },
      { id: "openai", name: "OpenAI", models: [{ id: "gpt", name: "GPT" }, { id: "mini", name: "Mini" }] },
    ];
    expect(defaultChoice(groups, { providerId: "openai", modelId: "mini" }, null)?.modelId).toBe("mini");
    expect(defaultChoice(groups, { providerId: "gone", modelId: "x" }, { providerId: "openai", modelId: "gpt" })?.modelId).toBe("gpt");
    expect(defaultChoice(groups, null, null)?.modelId).toBe("gpt");
    expect(defaultChoice([], null, null)).toBeNull();
  });
});

describe("remembering the agent", () => {
  it("reads back the saved provider and model", () => {
    vi.stubGlobal(
      "localStorage",
      memoryStorage({ [NOTE_AGENT_STORAGE_KEY]: JSON.stringify({ providerId: "openai", modelId: "gpt", label: "GPT" }) }),
    );
    expect(readSavedAgent()).toEqual({ providerId: "openai", modelId: "gpt" });
  });

  it.each([
    ["nothing saved", null],
    ["a saved number", "42"],
    ["a provider that is not text", JSON.stringify({ providerId: 1, modelId: "gpt" })],
    ["a missing model", JSON.stringify({ providerId: "openai" })],
    ["text that is not JSON", "{oops"],
  ])("reads nothing back from %s", (_label, stored) => {
    vi.stubGlobal("localStorage", memoryStorage(stored === null ? {} : { [NOTE_AGENT_STORAGE_KEY]: stored }));
    expect(readSavedAgent()).toBeNull();
  });

  it("reads nothing back when storage is unavailable", () => {
    vi.stubGlobal("localStorage", brokenStorage());
    expect(readSavedAgent()).toBeNull();
  });

  it("saves only the provider and model", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    saveAgent({ providerId: "acp:claude", modelId: "default", label: "Claude Code" });
    expect(storage.setItem).toHaveBeenCalledWith(
      NOTE_AGENT_STORAGE_KEY,
      JSON.stringify({ providerId: "acp:claude", modelId: "default" }),
    );
    expect(readSavedAgent()).toEqual({ providerId: "acp:claude", modelId: "default" });
  });

  it("keeps going when the choice cannot be saved", () => {
    vi.stubGlobal("localStorage", brokenStorage());
    expect(() => saveAgent({ providerId: "openai", modelId: "gpt", label: "GPT" })).not.toThrow();
  });
});

describe("running the note agent", () => {
  it("streams the reply from the chosen model and returns its edits", async () => {
    backend.streamViaBackend.mockImplementation(async (_request, onEvent: (event: unknown) => void) => {
      onEvent({ kind: "textDelta", text: "<<<<<<< FIND\nThe ratio is 0.75.\n=======\n" });
      onEvent({ kind: "usage" });
      onEvent({ kind: "textDelta", text: "The ratio is 0.60.\n>>>>>>> REPLACE\n" });
    });
    const signal = new AbortController().signal;
    const edits = await runNoteAgent({ providerId: "openai", modelId: "gpt", label: "GPT" }, REQUEST, signal);
    expect(edits).toEqual([{ find: "The ratio is 0.75.", replace: "The ratio is 0.60." }]);
    const [request, , passedSignal, override] = backend.streamViaBackend.mock.calls[0];
    expect(request.system).toBe(NOTE_AGENT_SYSTEM);
    expect(request.messages[0].content[0].text).toContain(REQUEST.source);
    expect(passedSignal).toBe(signal);
    expect(override).toEqual({ provider_id: "openai", model_id: "gpt" });
    expect(route.withCliAgentErrors).toHaveBeenCalledWith(null, expect.any(Function));
  });

  it("explains a CLI agent's failure in the app's words", async () => {
    backend.streamViaBackend.mockResolvedValue(undefined);
    await runNoteAgent({ providerId: "acp:claude", modelId: "default", label: "Claude Code" }, REQUEST, new AbortController().signal);
    expect(route.withCliAgentErrors).toHaveBeenCalledWith(
      { provider_id: "acp:claude", model_id: "default", agent: "Claude Code" },
      expect.any(Function),
    );
  });
});
