import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOleaflyTools,
  type AiToolsHost,
  type ConfirmFn,
  type ExecAuthorization,
  type IndexUseView,
  type ProjectIndexView,
} from "./tools";
import type { CuaSurface } from "./cua";

function makeHost(overrides: Partial<AiToolsHost> = {}): AiToolsHost {
  return {
    getProjectId: vi.fn(() => "proj"),
    prepareExternalMutation: vi.fn(async () => 1),
    recompile: vi.fn(async () => ({ ok: true, errors: [], has_pdf: true, log: "done" })),
    getCompileLog: vi.fn(() => null),
    getPdfBytes: vi.fn(() => null),
    extractPdfText: vi.fn(async () => ({ pages: [], numPages: 0 })),
    getProjectIndex: vi.fn(async () => null),
    pdfToPng: vi.fn(async (_bytes: Uint8Array, page: number) => `data:image/png;base64,P${page}`),
    getAgentTodos: vi.fn(() => []),
    setAgentTodos: vi.fn(),
    getAiPdfCaptureEnabled: vi.fn(() => true),
    rememberNote: vi.fn((content: string) => ({ id: "n1", content })),
    forgetNote: vi.fn(() => ({ success: true })),
    listNotes: vi.fn(() => [{ id: "n1", content: "Use British spelling" }]),
    ...overrides,
  } as unknown as AiToolsHost;
}

const PDF = new Uint8Array([37, 80, 68, 70]);

describe("multi-agent tools outside an agentic run", () => {
  it.each(["spawn_agent", "send_message", "followup_task", "wait_agent", "interrupt_agent", "list_agents", "close_agent"])(
    "%s explains that subagents need an agentic run",
    async (name) => {
      const tools = createOleaflyTools(makeHost());
      expect(await tools[name].execute({})).toEqual({
        error: "subagents are only available in agentic runs",
      });
    },
  );
});

describe("compile", () => {
  it("returns the build outcome with the tail of the log", async () => {
    const log = `${"a".repeat(5000)}END`;
    const host = makeHost({
      recompile: vi.fn(async () => ({ ok: false, errors: [{ line: 3 }], has_pdf: false, log })),
    });
    const result = (await createOleaflyTools(host).compile.execute({})) as Record<string, unknown>;
    expect(result).toMatchObject({ success: false, errors: [{ line: 3 }], has_pdf: false });
    expect(result.log_tail).toHaveLength(4000);
    expect(String(result.log_tail).endsWith("END")).toBe(true);
  });

  it("treats a missing result as a failed build with no PDF", async () => {
    const host = makeHost({ recompile: vi.fn(async () => null) });
    expect(await createOleaflyTools(host).compile.execute({})).toEqual({
      success: false,
      errors: [],
      has_pdf: false,
      log_tail: "",
    });
  });

  it("returns a thrown compile as an error", async () => {
    const host = makeHost({
      recompile: vi.fn(async () => {
        throw new Error("no main document");
      }),
    });
    expect(await createOleaflyTools(host).compile.execute({})).toEqual({ error: "Error: no main document" });
  });
});

describe("get_log", () => {
  it("asks for a compile first when there is no log", async () => {
    expect(await createOleaflyTools(makeHost()).get_log.execute({})).toEqual({
      error: "No compile log yet. Run compile first.",
    });
  });

  it("returns the last 20,000 characters of the log", async () => {
    const host = makeHost({ getCompileLog: vi.fn(() => `${"x".repeat(25_000)}!`) });
    const result = (await createOleaflyTools(host).get_log.execute({})) as { log: string };
    expect(result.log).toHaveLength(20_000);
    expect(result.log.endsWith("!")).toBe(true);
  });
});

describe("get_pdf_text", () => {
  it("asks for a compile first when there is no PDF", async () => {
    expect(await createOleaflyTools(makeHost()).get_pdf_text.execute({})).toEqual({
      error: "No PDF available. Run compile first.",
    });
  });

  it("labels each page and caps the text per page", async () => {
    const host = makeHost({
      getPdfBytes: vi.fn(() => PDF),
      extractPdfText: vi.fn(async () => ({ pages: ["Intro", "y".repeat(3000)], numPages: 2 })),
    });
    const result = (await createOleaflyTools(host).get_pdf_text.execute({})) as {
      numPages: number;
      text: string;
    };
    expect(host.extractPdfText).toHaveBeenCalledWith(PDF);
    expect(result.numPages).toBe(2);
    expect(result.text).toBe(`--- Page 1/2 ---\nIntro\n\n--- Page 2/2 ---\n${"y".repeat(2000)}`);
  });

  it("returns an extraction failure as an error", async () => {
    const host = makeHost({
      getPdfBytes: vi.fn(() => PDF),
      extractPdfText: vi.fn(async () => {
        throw new Error("encrypted");
      }),
    });
    expect(await createOleaflyTools(host).get_pdf_text.execute({})).toEqual({ error: "Error: encrypted" });
  });
});

describe("project_map", () => {
  it("reports no project when the host has no index", async () => {
    expect(await createOleaflyTools(makeHost()).project_map.execute({})).toEqual({ error: "No project open" });
  });

  it("summarizes the index into outline, keys, edges and unresolved links", async () => {
    const resolved = new Set(["sec:intro", "knuth84"]);
    const index: ProjectIndexView = {
      defs: [
        { kind: "file", name: "main.tex" },
        { kind: "section", name: "Introduction", level: 1, file: "main.tex", line: 4 },
        { kind: "label", name: "sec:intro" },
        { kind: "bibentry", name: "knuth84" },
        { kind: "macro", name: "\\R" },
        { kind: "theorem", name: "lemma" },
        { kind: "glossary", name: "api" },
      ],
      uses: [
        { kind: "inputedge", name: "ch1", file: "main.tex", target: "ch1.tex" },
        { kind: "ref", name: "sec:intro" },
        { kind: "ref", name: "sec:missing" },
        { kind: "ref", name: "sec:missing" },
        { kind: "cite", name: "knuth84" },
        { kind: "cite", name: "lamport94" },
        { kind: "atuse", name: "fig1" },
        { kind: "atuse", name: "fig1" },
      ],
      definitionFor: (use: IndexUseView) => (resolved.has(use.name) ? {} : null),
    };
    const host = makeHost({ getProjectIndex: vi.fn(async () => index) });
    expect(await createOleaflyTools(host).project_map.execute({})).toEqual({
      files: ["main.tex"],
      sections: [{ title: "Introduction", level: 1, file: "main.tex", line: 4 }],
      labels: ["sec:intro"],
      bibKeys: ["knuth84"],
      macros: ["\\R"],
      theorems: ["lemma"],
      glossary: ["api"],
      inputGraph: [{ from: "main.tex", to: "ch1.tex" }],
      unresolvedRefs: ["sec:missing"],
      unresolvedCites: ["lamport94"],
      ambiguousTypstAtUses: ["fig1"],
    });
  });
});

describe("agent checklist", () => {
  it("cleans the list before storing it", async () => {
    const host = makeHost();
    const todos = [
      { id: "1", content: "Draft", status: "in_progress" },
      { id: "2", content: "", status: "pending" },
      null,
      { id: "3".repeat(100), content: "c".repeat(300), status: "someday" },
    ];
    const result = await createOleaflyTools(host).update_todos.execute({ todos });
    const stored = [
      { id: "1", content: "Draft", status: "in_progress" },
      { id: "3".repeat(64), content: "c".repeat(240), status: "pending" },
    ];
    expect(host.setAgentTodos).toHaveBeenCalledWith(stored);
    expect(result).toEqual({ success: true, count: 2, todos: stored });
  });

  it("keeps at most 30 items and treats a missing list as empty", async () => {
    const host = makeHost();
    const tools = createOleaflyTools(host);
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: String(index),
      content: `step ${index}`,
      status: "completed",
    }));
    expect(await tools.update_todos.execute({ todos: many })).toMatchObject({ count: 30 });
    expect(await tools.update_todos.execute({})).toEqual({ success: true, count: 0, todos: [] });
  });

  it("asks before replacing the checklist for an external request and honours a decline", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => false);
    const host = makeHost();
    const tools = createOleaflyTools(host, { confirm, mutationAllowed: () => true });
    expect(await tools.update_todos.execute({ todos: [] })).toMatchObject({
      declined: true,
      tool: "update_todos",
    });
    expect(confirm).toHaveBeenCalledWith({ tool: "update_todos", summary: "Replace the agent checklist" });
    expect(host.setAgentTodos).not.toHaveBeenCalled();
  });

  it("reads the current checklist back", async () => {
    const todos = [{ id: "1", content: "Draft", status: "pending" }];
    const host = makeHost({ getAgentTodos: vi.fn(() => todos) });
    expect(await createOleaflyTools(host).get_todos.execute({})).toEqual({ todos });
  });
});

describe("project memory notes", () => {
  it("saves, forgets and lists notes through the host", async () => {
    const host = makeHost();
    const tools = createOleaflyTools(host);
    expect(await tools.remember_note.execute({ content: "Use British spelling" })).toEqual({
      id: "n1",
      content: "Use British spelling",
    });
    expect(await tools.forget_note.execute({ id: "n1" })).toEqual({ success: true });
    expect(host.forgetNote).toHaveBeenCalledWith("n1");
    expect(await tools.list_notes.execute({})).toEqual({
      notes: [{ id: "n1", content: "Use British spelling" }],
    });
  });

  it("passes empty strings for missing fields", async () => {
    const host = makeHost();
    const tools = createOleaflyTools(host);
    await tools.remember_note.execute({});
    await tools.forget_note.execute({});
    expect(host.rememberNote).toHaveBeenCalledWith("");
    expect(host.forgetNote).toHaveBeenCalledWith("");
  });

  it("does not touch notes when an external request is declined", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => false);
    const host = makeHost();
    const tools = createOleaflyTools(host, { confirm, mutationAllowed: () => true });
    expect(await tools.remember_note.execute({ content: "x" })).toMatchObject({ declined: true, tool: "remember_note" });
    expect(await tools.forget_note.execute({ id: "n1" })).toMatchObject({ declined: true, tool: "forget_note" });
    expect(confirm).toHaveBeenCalledWith({ tool: "remember_note", summary: "Save a project memory note" });
    expect(confirm).toHaveBeenCalledWith({ tool: "forget_note", summary: "Remove a project memory note" });
    expect(host.rememberNote).not.toHaveBeenCalled();
    expect(host.forgetNote).not.toHaveBeenCalled();
  });
});

describe("toggle_theme", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubWindow() {
    const target = new EventTarget();
    const seen = vi.fn();
    target.addEventListener("oleafly:toggle-theme", seen);
    vi.stubGlobal("window", target);
    return seen;
  }

  it("asks the app to toggle its theme", async () => {
    const seen = stubWindow();
    expect(await createOleaflyTools(makeHost()).toggle_theme.execute({})).toEqual({ success: true });
    expect(seen).toHaveBeenCalledOnce();
  });

  it("asks an external request for approval and honours a decline", async () => {
    const seen = stubWindow();
    const confirm = vi.fn<ConfirmFn>(async () => false);
    const tools = createOleaflyTools(makeHost(), { confirm, mutationAllowed: () => true });
    expect(await tools.toggle_theme.execute({})).toMatchObject({ declined: true, tool: "toggle_theme" });
    expect(confirm).toHaveBeenCalledWith({ tool: "toggle_theme", summary: "Toggle the application theme" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("refuses an external request when no project is open", async () => {
    const seen = stubWindow();
    const tools = createOleaflyTools(makeHost({ getProjectId: vi.fn(() => null) }), {
      mutationAllowed: () => true,
    });
    expect(await tools.toggle_theme.execute({})).toEqual({ error: "Error: No project open" });
    expect(seen).not.toHaveBeenCalled();
  });

  it("stops when the external request is cancelled after approval", async () => {
    const seen = stubWindow();
    const mutationAllowed = vi.fn(() => false).mockReturnValueOnce(true);
    const tools = createOleaflyTools(makeHost(), { confirm: async () => true, mutationAllowed });
    expect(await tools.toggle_theme.execute({})).toEqual({
      error: "The external request was cancelled before mutation.",
    });
    expect(seen).not.toHaveBeenCalled();
  });

  it("stops when the external request was cancelled before approval finished", async () => {
    const seen = stubWindow();
    const tools = createOleaflyTools(makeHost(), { confirm: async () => true, mutationAllowed: () => false });
    expect(await tools.toggle_theme.execute({})).toEqual({
      error: "Error: Project changed or the external request was cancelled before mutation.",
    });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("verify_pdf_pages", () => {
  function pdfHost(numPages: number, overrides: Partial<AiToolsHost> = {}) {
    return makeHost({
      getPdfBytes: vi.fn(() => PDF),
      extractPdfText: vi.fn(async () => ({
        pages: Array.from({ length: numPages }, (_, index) => `text of page ${index + 1}`),
        numPages,
      })),
      ...overrides,
    });
  }

  it("refuses when PDF page capture is turned off", async () => {
    const host = pdfHost(3, { getAiPdfCaptureEnabled: vi.fn(() => false) });
    expect(await createOleaflyTools(host).verify_pdf_pages.execute({})).toMatchObject({
      capture_disabled: true,
      error: expect.stringContaining("Allow PDF page capture for AI"),
    });
    expect(host.extractPdfText).not.toHaveBeenCalled();
  });

  it("asks for a compile when there is no PDF and reports an empty one", async () => {
    expect(await createOleaflyTools(makeHost()).verify_pdf_pages.execute({})).toEqual({
      error: "No PDF available. Run compile first (and ensure it succeeds).",
    });
    expect(await createOleaflyTools(pdfHost(0)).verify_pdf_pages.execute({})).toEqual({
      error: "PDF has no pages.",
    });
  });

  it("captures the requested pages, deduplicated, sorted and within range", async () => {
    const onImage = vi.fn();
    const host = pdfHost(5);
    const result = await createOleaflyTools(host, { onImage }).verify_pdf_pages.execute({
      pages: [4, 2.7, 2, 9, 0],
    });
    expect(host.pdfToPng).toHaveBeenCalledTimes(2);
    expect(host.pdfToPng).toHaveBeenCalledWith(PDF, 2, 1.5);
    expect(host.pdfToPng).toHaveBeenCalledWith(PDF, 4, 1.5);
    expect(onImage.mock.calls).toEqual([["data:image/png;base64,P2"], ["data:image/png;base64,P4"]]);
    expect(result).toEqual({
      success: true,
      numPages: 5,
      pages: [2, 4],
      images_captured: 2,
      text: "--- Page 2/5 ---\ntext of page 2\n\n--- Page 4/5 ---\ntext of page 4",
      note: expect.stringContaining("Page images were attached"),
    });
  });

  it("limits explicit pages to max_pages, which is clamped to six", async () => {
    const host = pdfHost(10);
    const tools = createOleaflyTools(host);
    expect(await tools.verify_pdf_pages.execute({ pages: [1, 2, 3, 4], max_pages: 2 })).toMatchObject({
      pages: [1, 2],
    });
    expect(
      await tools.verify_pdf_pages.execute({ pages: [1, 2, 3, 4, 5, 6, 7, 8], max_pages: 50 }),
    ).toMatchObject({ pages: [1, 2, 3, 4, 5, 6] });
  });

  it("picks first, last and the cursor page when no pages are given", async () => {
    const host = pdfHost(20, { getPdfCursorPage: vi.fn(() => 12) });
    expect(await createOleaflyTools(host).verify_pdf_pages.execute({ max_pages: 3 })).toMatchObject({
      pages: [1, 12, 20],
    });
  });

  it("shows an empty excerpt for a page the text layer did not cover", async () => {
    const host = makeHost({
      getPdfBytes: vi.fn(() => PDF),
      extractPdfText: vi.fn(async () => ({ pages: ["only page one"], numPages: 3 })),
    });
    expect(await createOleaflyTools(host).verify_pdf_pages.execute({ pages: [1, 3] })).toMatchObject({
      text: "--- Page 1/3 ---\nonly page one\n\n--- Page 3/3 ---\n",
    });
  });

  it("falls back to text excerpts when no page could be rastered", async () => {
    const onImage = vi.fn();
    const host = pdfHost(1, {
      pdfToPng: vi.fn(async () => {
        throw new Error("canvas lost");
      }),
    });
    expect(await createOleaflyTools(host, { onImage }).verify_pdf_pages.execute({})).toMatchObject({
      success: true,
      pages: [1],
      images_captured: 0,
      note: "No images captured. Inspect text excerpts only.",
    });
    expect(onImage).not.toHaveBeenCalled();
  });

  it("returns an extraction failure as an error", async () => {
    const host = makeHost({
      getPdfBytes: vi.fn(() => PDF),
      extractPdfText: vi.fn(async () => {
        throw new Error("bad xref");
      }),
    });
    expect(await createOleaflyTools(host).verify_pdf_pages.execute({})).toEqual({ error: "Error: bad xref" });
  });
});

describe("run_command", () => {
  const authorization: ExecAuthorization = { approvalToken: "tok", runId: "run-1" };
  const execResult = {
    command: "make",
    output: "ok\n",
    exit_code: 0,
    status: "completed",
    truncated: false,
    timed_out: false,
  };

  function execOptions(overrides: Record<string, unknown> = {}) {
    return {
      confirm: vi.fn<ConfirmFn>(async () => true),
      resolveExecCwd: vi.fn(async () => "/work/proj"),
      authorizeExec: vi.fn(async () => authorization),
      execCommand: vi.fn(async () => execResult),
      ...overrides,
    };
  }

  it("is only offered when exec cwd, authorization and execution are all wired", () => {
    const { confirm, resolveExecCwd, authorizeExec } = execOptions();
    expect(createOleaflyTools(makeHost(), { confirm, resolveExecCwd, authorizeExec }).run_command).toBeUndefined();
    expect(createOleaflyTools(makeHost(), execOptions()).run_command).toBeDefined();
  });

  it("requires a command and an open project", async () => {
    const opts = execOptions();
    expect(await createOleaflyTools(makeHost(), opts).run_command.execute({ command: "   " })).toEqual({
      error: "command is required",
    });
    expect(await createOleaflyTools(makeHost(), opts).run_command.execute({})).toEqual({
      error: "command is required",
    });
    expect(
      await createOleaflyTools(makeHost({ getProjectId: vi.fn(() => null) }), opts).run_command.execute({
        command: "ls",
      }),
    ).toEqual({ error: "No project open" });
    expect(opts.execCommand).not.toHaveBeenCalled();
  });

  it("declines every command when there is no approval flow", async () => {
    const opts = execOptions({ confirm: undefined });
    expect(await createOleaflyTools(makeHost(), opts).run_command.execute({ command: "ls" })).toMatchObject({
      declined: true,
      tool: "run_command",
      command: "ls",
    });
    expect(opts.resolveExecCwd).not.toHaveBeenCalled();
  });

  it("shows the command and directory for approval, then authorizes and runs it", async () => {
    const opts = execOptions();
    const host = makeHost({ refreshOpenFiles: vi.fn() });
    const result = await createOleaflyTools(host, opts).run_command.execute({
      command: " make ",
      __execOwner: "sub-7",
    });
    expect(opts.confirm).toHaveBeenCalledWith({
      tool: "run_command",
      summary: "$ make",
      projectId: "proj",
      command: "make",
      cwd: "/work/proj",
    });
    expect(host.prepareExternalMutation).toHaveBeenCalledWith("proj");
    expect(opts.authorizeExec).toHaveBeenCalledWith("proj", "make", "sub-7");
    expect(opts.execCommand).toHaveBeenCalledWith("proj", "make", authorization);
    expect(host.refreshOpenFiles).toHaveBeenCalledWith("proj");
    expect(result).toEqual({
      exec: true,
      command: "make",
      output: "ok\n",
      exit_code: 0,
      status: "completed",
      timed_out: false,
    });
  });

  it("uses the run's own owner when none is given", async () => {
    const opts = execOptions();
    await createOleaflyTools(makeHost(), opts).run_command.execute({ command: "ls", __execOwner: 4 });
    expect(opts.authorizeExec).toHaveBeenCalledWith("proj", "ls", undefined);
  });

  it("does not authorize a declined command", async () => {
    const opts = execOptions({ confirm: vi.fn<ConfirmFn>(async () => false) });
    expect(await createOleaflyTools(makeHost(), opts).run_command.execute({ command: "rm -rf build" })).toMatchObject({
      declined: true,
      command: "rm -rf build",
    });
    expect(opts.authorizeExec).not.toHaveBeenCalled();
  });

  it("refuses to run when the project switched while approval was pending", async () => {
    const getProjectId = vi.fn(() => "proj");
    const opts = execOptions({
      confirm: vi.fn<ConfirmFn>(async () => {
        getProjectId.mockReturnValue("other");
        return true;
      }),
    });
    expect(
      await createOleaflyTools(makeHost({ getProjectId }), opts).run_command.execute({ command: "ls" }),
    ).toEqual({ error: "Error: Project changed or the external request was cancelled before mutation." });
    expect(opts.execCommand).not.toHaveBeenCalled();
  });

  it("rereads open files even when the command fails", async () => {
    const opts = execOptions({
      execCommand: vi.fn(async () => {
        throw new Error("spawn failed");
      }),
    });
    const host = makeHost({ refreshOpenFiles: vi.fn() });
    expect(await createOleaflyTools(host, opts).run_command.execute({ command: "ls" })).toEqual({
      error: "Error: spawn failed",
    });
    expect(host.refreshOpenFiles).toHaveBeenCalledWith("proj");
  });
});

describe("computer_use", () => {
  function nativeSurface(): CuaSurface & { navigated: string[] } {
    const navigated: string[] = [];
    return {
      get document(): Document {
        throw new Error("separate window");
      },
      url: () => "https://example.org/",
      navigate(url: string) {
        navigated.push(url);
      },
      navigated,
    };
  }

  it("is absent unless a browser surface is wired", () => {
    expect(createOleaflyTools(makeHost()).computer_use).toBeUndefined();
  });

  it("describes the stricter approval policy when every action needs confirming", () => {
    const strict = createOleaflyTools(makeHost(), {
      cuaSurface: () => null,
      alwaysConfirmComputerUse: true,
    }).computer_use;
    const relaxed = createOleaflyTools(makeHost(), { cuaSurface: () => null }).computer_use;
    expect(strict.description).toContain("Every navigation requires explicit user approval");
    expect(relaxed.description).toContain("follows the active approval policy");
  });

  it("explains when the browser window is unavailable", async () => {
    const tools = createOleaflyTools(makeHost(), { cuaSurface: () => null });
    expect(await tools.computer_use.execute({ action: "wait" })).toEqual({
      error: "The browser window is unavailable. Enable the web browser to use computer_use.",
    });
  });

  it("waits without asking", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const surface = nativeSurface();
    const tools = createOleaflyTools(makeHost(), { confirm, cuaSurface: () => surface });
    expect(await tools.computer_use.execute({ action: "wait", amount: 0 })).toEqual({ ok: true, message: "Waited" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("navigates only after approval naming the URL", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const surface = nativeSurface();
    const tools = createOleaflyTools(makeHost(), { confirm, cuaSurface: () => surface });
    const result = await tools.computer_use.execute({ action: "navigate", text: "https://arxiv.org/" });
    expect(confirm).toHaveBeenCalledWith({ tool: "computer_use", summary: "navigate https://arxiv.org/" });
    expect(surface.navigated).toEqual(["https://arxiv.org/"]);
    expect(result).toMatchObject({ ok: true, message: "Navigated to https://arxiv.org/" });
  });

  it("declines a navigation with no approval flow or a refused approval", async () => {
    const surface = nativeSurface();
    const unapproved = createOleaflyTools(makeHost(), { cuaSurface: () => surface });
    expect(await unapproved.computer_use.execute({ action: "navigate", text: "https://a.org/" })).toMatchObject({
      declined: true,
      tool: "computer_use",
    });
    const refused = createOleaflyTools(makeHost(), {
      confirm: async () => false,
      cuaSurface: () => surface,
    });
    expect(await refused.computer_use.execute({ action: "navigate", text: "https://a.org/" })).toMatchObject({
      declined: true,
    });
    expect(surface.navigated).toEqual([]);
  });

  it("confirms even a wait when every action must be approved", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const tools = createOleaflyTools(makeHost(), {
      confirm,
      cuaSurface: () => nativeSurface(),
      alwaysConfirmComputerUse: true,
    });
    await tools.computer_use.execute({ action: "wait", amount: 0 });
    expect(confirm).toHaveBeenCalledWith({ tool: "computer_use", summary: "wait" });
  });
});
