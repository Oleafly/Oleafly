import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getConfig: vi.fn(),
  verifyCitation: vi.fn(),
  createResearchTask: vi.fn(),
  startResearchTask: vi.fn(),
  listResearchTasks: vi.fn(),
}));

const files = vi.hoisted(() => ({ projectId: "paper" as string | null }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/tauri", () => ({ getConfig: mocks.getConfig }));
vi.mock("@/lib/research-literature", () => ({ verifyCitation: mocks.verifyCitation }));
vi.mock("@/lib/ai-rag", () => ({ retrieveProjectChunks: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/research-tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/research-tasks")>()),
  createResearchTask: mocks.createResearchTask,
  startResearchTask: mocks.startResearchTask,
  listResearchTasks: mocks.listResearchTasks,
}));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ projectId: files.projectId }) } }));

import { defaultBrief, normalizeTask, type ResearchTask } from "@/lib/research-tasks";
import { createResearchAiTools, createResearchTaskAiTools } from "./research-tools";

function task(id: string, overrides: Partial<ResearchTask> = {}): ResearchTask {
  return normalizeTask({
    id,
    projectId: "paper",
    status: "queued",
    title: `Task ${id}`,
    prompt: `Complete ${id}`,
    recordSlug: `${id}-ab12`,
    recordDir: `research/${id}-ab12`,
    ...overrides,
  });
}

function changed(path: string) {
  return { path, kind: "modified" as const, beforeSha256: "a", afterSha256: "b", beforeSize: 1, afterSize: 2 };
}

beforeEach(() => {
  for (const f of Object.values(mocks)) f.mockReset();
  files.projectId = "paper";
});

describe("app-level research tools wiring", () => {
  it("wires project_library_search to the real ai-rag retrieval function", async () => {
    const tools = createResearchAiTools();
    const res = await tools.project_library_search.execute({ query: "anything" });
    expect(res).toMatchObject({ chunks: [] });
  });

  it("wires verify_citation to the app's citation check", async () => {
    mocks.verifyCitation.mockResolvedValue({ verified: true, source: "doi", doi: "10.1/x" });
    const tools = createResearchAiTools();
    const res = await tools.verify_citation.execute({ doi: "10.1/x" });
    expect(mocks.verifyCitation).toHaveBeenCalledWith({ doi: "10.1/x" });
    expect(res).toMatchObject({ verified: true });
  });

  it("sends literature_search to the app's search of every index so saved keys apply", async () => {
    const found = {
      records: [{ id: "doi:10.1/x", title: "A Work", sources: ["openalex", "crossref"] }],
      failures: [{ source: "semantic-scholar", message: "Semantic Scholar returned HTTP 429" }],
    };
    mocks.invoke.mockResolvedValue(found);
    const tools = createResearchAiTools();
    const res = await tools.literature_search.execute({ query: "graph neural networks", limit: 5 });
    expect(mocks.invoke).toHaveBeenCalledWith("literature_search_all", {
      query: { query: "graph neural networks", limit: 5, sources: [] },
    });
    expect(res).toEqual(found);
  });

  it("literature_search asks the host's unified search with the clamped limit and the named indexes", async () => {
    mocks.invoke.mockResolvedValue({ records: [], failures: [] });
    const tools = createResearchAiTools();

    await tools.literature_search.execute({ query: "sparse attention", limit: 100, sources: ["arxiv", "bogus"] });

    expect(mocks.invoke).toHaveBeenCalledWith("literature_search_all", {
      query: { query: "sparse attention", limit: 25, sources: ["arxiv"] },
    });
  });

  it("returns a failed search as a tool error", async () => {
    mocks.invoke.mockRejectedValue(new Error("Every index failed. Check your connection."));
    const tools = createResearchAiTools();
    const res = await tools.literature_search.execute({ query: "graph neural networks" });
    expect(res).toEqual({ error: "Every index failed. Check your connection." });
  });

  it("forwards internet approval before invoking citation commands", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchAiTools({ confirm });

    const res = await tools.verify_citation.execute({ doi: "10.1/x" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "verify_citation",
      summary: "Verify citation with Crossref",
    });
    expect(mocks.verifyCitation).not.toHaveBeenCalled();
    expect(res).toMatchObject({ declined: true, tool: "verify_citation" });
  });

  it("gives the chat the research tools and the task tools, and the MCP server only the task tools", () => {
    expect(Object.keys(createResearchAiTools()).sort()).toEqual([
      "literature_search",
      "project_library_search",
      "research_task_create",
      "research_task_status",
      "verify_citation",
    ]);
    expect(Object.keys(createResearchTaskAiTools()).sort()).toEqual(["research_task_create", "research_task_status"]);
  });
});

describe("creating research tasks from the assistant", () => {
  it("creates a task in the open project with the default brief and starts it", async () => {
    mocks.getConfig.mockResolvedValue({});
    mocks.createResearchTask.mockResolvedValue(task("t1", { title: "Survey" }));
    mocks.startResearchTask.mockResolvedValue(task("t1", { title: "Survey", status: "running" }));
    const tools = createResearchTaskAiTools();

    const res = await tools.research_task_create.execute({
      title: "Survey",
      prompt: "Find papers on sparse attention",
    });

    expect(mocks.createResearchTask).toHaveBeenCalledWith({
      projectId: "paper",
      title: "Survey",
      prompt: "Find papers on sparse attention",
      runtimeId: "builtin",
      agentId: "openai",
      modelId: "",
      skillIds: [],
      dependencyIds: [],
      brief: defaultBrief("Find papers on sparse attention"),
    });
    expect(mocks.startResearchTask).toHaveBeenCalledWith("t1");
    expect(res).toEqual({ id: "t1", title: "Survey", status: "running" });
  });

  it("uses the brief the agent gives over the research settings and leaves the task queued when asked", async () => {
    mocks.getConfig.mockResolvedValue({
      ai_provider: "anthropic",
      ai_model: "claude-test",
      research_command_network: true,
      research_time_budget_minutes: 240,
    });
    mocks.createResearchTask.mockResolvedValue(task("t2", { title: "Ablation" }));
    const tools = createResearchTaskAiTools();

    const res = await tools.research_task_create.execute({
      title: "Ablation",
      prompt: "Run the dropout ablation",
      skills: ["oleafly-experiment-loop"],
      goal: "Find the dropout rate with the lowest validation loss",
      success_criteria: ["val_loss below 0.3"],
      review_plan_first: true,
      network: false,
      time_budget_minutes: 30,
      start: false,
    });

    expect(mocks.createResearchTask).toHaveBeenCalledWith({
      projectId: "paper",
      title: "Ablation",
      prompt: "Run the dropout ablation",
      runtimeId: "builtin",
      agentId: "anthropic",
      modelId: "claude-test",
      skillIds: ["oleafly-experiment-loop"],
      dependencyIds: [],
      brief: {
        ...defaultBrief("Find the dropout rate with the lowest validation loss"),
        successCriteria: ["val_loss below 0.3"],
        reviewPlanFirst: true,
        permissions: { network: false, commands: "allow", desktopApps: false },
        budget: { wallClockMinutes: 30, usdCap: null, maxRuns: null, runTimeoutMinutes: 60 },
      },
    });
    expect(mocks.startResearchTask).not.toHaveBeenCalled();
    expect(res).toEqual({ id: "t2", title: "Ablation", status: "queued" });
  });

  it("takes network access and the time budget from the research settings when the agent leaves them out", async () => {
    mocks.getConfig.mockResolvedValue({ research_command_network: true, research_time_budget_minutes: 240 });
    mocks.createResearchTask.mockResolvedValue(task("t3"));
    const tools = createResearchTaskAiTools();

    await tools.research_task_create.execute({ title: "Sweep", prompt: "Sweep the literature", start: false });

    const [draft] = mocks.createResearchTask.mock.calls[0];
    expect(draft.brief).toMatchObject({
      goal: "Sweep the literature",
      permissions: { network: true },
      budget: { wallClockMinutes: 240 },
    });
  });

  it("refuses to create a task without an open project", async () => {
    files.projectId = null;
    const tools = createResearchTaskAiTools();

    const res = await tools.research_task_create.execute({ title: "Survey", prompt: "Find papers" });

    expect(res).toEqual({ error: "Open a project first." });
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.createResearchTask).not.toHaveBeenCalled();
  });

  it("asks before it creates a task and does nothing when the user declines", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const tools = createResearchAiTools({ confirm });

    const res = await tools.research_task_create.execute({ title: "Survey", prompt: "Find papers" });

    expect(confirm).toHaveBeenCalledWith({
      tool: "research_task_create",
      summary: 'Create the research task "Survey" and start it',
    });
    expect(res).toMatchObject({ declined: true, tool: "research_task_create" });
    expect(mocks.createResearchTask).not.toHaveBeenCalled();
  });
});

describe("research task status for the assistant", () => {
  it("reports one task with its budget, waiting requests and result", async () => {
    const working = task("t1", {
      title: "Survey",
      status: "awaiting_review",
      phase: "checking_evidence",
      activeMs: 90_000,
      pendingApprovals: 2,
      error: null,
      result: {
        summary: "x".repeat(2_500),
        changedFiles: [changed("main.tex"), changed("refs.bib"), changed("research/t1-ab12/ledger.tsv")],
        artifacts: [],
        nativeSessionId: null,
        inputTokens: null,
        outputTokens: null,
      },
    });
    mocks.listResearchTasks.mockResolvedValue([task("t0"), working]);
    const tools = createResearchTaskAiTools();

    const res = await tools.research_task_status.execute({ id: " t1 " });

    expect(mocks.listResearchTasks).toHaveBeenCalledWith("paper");
    expect(res).toEqual({
      id: "t1",
      title: "Survey",
      status: "awaiting_review",
      phase: "checking_evidence",
      budgetUsedMinutes: 2,
      timeBudgetMinutes: 120,
      pendingApprovals: 2,
      resultSummary: "x".repeat(2_000),
      changedFiles: 3,
      recordDir: "research/t1-ab12",
      error: null,
    });
  });

  it("says when the project has no task with that id", async () => {
    mocks.listResearchTasks.mockResolvedValue([task("t0")]);
    const tools = createResearchTaskAiTools();

    await expect(tools.research_task_status.execute({ id: "missing" })).resolves.toEqual({
      error: "No task with that id in this project.",
    });
  });

  it("reports the latest ten tasks without an id", async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => task(`t${index}`, { error: index === 0 ? "Stopped." : null }));
    mocks.listResearchTasks.mockResolvedValue(tasks);
    const tools = createResearchTaskAiTools();

    const res = (await tools.research_task_status.execute({})) as { tasks: Array<Record<string, unknown>> };

    expect(res.tasks.map((entry) => entry.id)).toEqual(tasks.slice(0, 10).map((entry) => entry.id));
    expect(res.tasks[0]).toEqual({
      id: "t0",
      title: "Task t0",
      status: "queued",
      phase: null,
      budgetUsedMinutes: 0,
      timeBudgetMinutes: 120,
      pendingApprovals: 0,
      resultSummary: "",
      changedFiles: 0,
      recordDir: "research/t0-ab12",
      error: "Stopped.",
    });
  });

  it("reports status only in an open project", async () => {
    files.projectId = null;
    const tools = createResearchTaskAiTools();

    await expect(tools.research_task_status.execute({})).resolves.toEqual({ error: "Open a project first." });
    expect(mocks.listResearchTasks).not.toHaveBeenCalled();
  });
});
