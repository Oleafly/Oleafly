import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchTask, ResearchTaskDraft } from "./research-tasks";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

import { ensureResearchStarterTask } from "./research-starter-task";
import { finishResearchProjectSetup } from "./research-workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function input(projectId = "paper") {
  return { projectId, title: "Plan the thesis", prompt: "Outline the methods and evidence for this thesis", starter: "thesis" };
}

beforeEach(() => {
  native.invoke.mockReset();
});

describe("research starter task integration", () => {
  it("creates one queued starter task for concurrent setup attempts and honors the configured provider/model", async () => {
    const listing = deferred<ResearchTask[]>();
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "research_task_list") return listing.promise;
      if (command === "get_config") return { ai_provider: "local-research", ai_model: "study-model" };
      if (command === "research_task_create") return args.draft;
      throw new Error(`Unexpected command: ${command}`);
    });
    const first = ensureResearchStarterTask(input());
    const second = ensureResearchStarterTask(input());
    expect(first).toBe(second);
    listing.resolve([]);
    await Promise.all([first, second]);
    expect(native.invoke.mock.calls).toEqual([
      ["research_task_list", { projectId: "paper" }],
      ["get_config"],
      ["research_task_create", { draft: { projectId: "paper", title: "Plan the thesis", prompt: "Outline the methods and evidence for this thesis", runtimeId: "builtin", agentId: "local-research", modelId: "study-model", skillIds: [], dependencyIds: [] } }],
    ]);
  });

  it("recognizes a persisted starter on reload without duplicating it or requiring provider settings", async () => {
    native.invoke.mockResolvedValue([{ ...input(), status: "queued" }]);
    await ensureResearchStarterTask(input());
    expect(native.invoke.mock.calls).toEqual([["research_task_list", { projectId: "paper" }]]);
  });

  it("does not deduplicate different projects and keeps a new starter's exact prompt", async () => {
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "research_task_list") return [{ title: "Plan the thesis", prompt: "An older prompt" }];
      if (command === "get_config") return {};
      if (command === "research_task_create") return args.draft;
      throw new Error(`Unexpected command: ${command}`);
    });
    await Promise.all([ensureResearchStarterTask(input("first")), ensureResearchStarterTask(input("second"))]);
    const drafts = native.invoke.mock.calls.filter(([command]) => command === "research_task_create").map(([, args]) => args.draft as ResearchTaskDraft);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.projectId).sort()).toEqual(["first", "second"]);
    for (const draft of drafts) expect(draft).toMatchObject({ prompt: input().prompt, runtimeId: "builtin", agentId: "openai", modelId: "" });
  });

  it("retries an ambiguous task-save failure on the existing project and reuses the task already persisted", async () => {
    const tasks: Pick<ResearchTask, "title" | "prompt">[] = [];
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "create_research_project") return "created-project";
      if (command === "research_task_list") return tasks;
      if (command === "get_config") return { ai_provider: "openai", ai_model: "research-model" };
      if (command === "research_task_create") {
        tasks.push(args.draft);
        throw new Error("Task saved, response disconnected");
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    let progress = { projectId: null as string | null, initialTaskReady: false };
    const onCreated = vi.fn();
    const setup = {
      request: { name: "Thesis", engine: "typst" as const, starter: "thesis" as const },
      task: { title: input().title, prompt: input().prompt, starter: "thesis" as const },
      ensureInitialTask: ensureResearchStarterTask,
      onCreated,
      onProgress: (next: typeof progress) => { progress = next; },
    };
    await expect(finishResearchProjectSetup({ ...setup, progress })).rejects.toMatchObject({ stage: "task", projectId: "created-project" });
    expect(progress).toEqual({ projectId: "created-project", initialTaskReady: false });
    expect(onCreated).not.toHaveBeenCalled();
    await finishResearchProjectSetup({ ...setup, progress });
    expect(progress).toEqual({ projectId: "created-project", initialTaskReady: true });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith("created-project");
    expect(native.invoke.mock.calls.filter(([command]) => command === "create_research_project")).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === "research_task_create")).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === "research_task_list")).toHaveLength(2);
  });

  it("allows a later retry after a failed settings read without leaving a stuck pending setup", async () => {
    let failed = true;
    native.invoke.mockImplementation(async (command, args) => {
      if (command === "research_task_list") return [];
      if (command === "get_config") {
        if (failed) throw new Error("Settings unavailable");
        return { ai_provider: "openai", ai_model: "research-model" };
      }
      if (command === "research_task_create") return args.draft;
      throw new Error(`Unexpected command: ${command}`);
    });
    await expect(ensureResearchStarterTask(input())).rejects.toThrow("Settings unavailable");
    failed = false;
    await ensureResearchStarterTask(input());
    expect(native.invoke.mock.calls.filter(([command]) => command === "research_task_create")).toHaveLength(1);
    expect(native.invoke.mock.calls.filter(([command]) => command === "research_task_list")).toHaveLength(2);
  });
});
