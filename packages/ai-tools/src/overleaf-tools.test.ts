import { describe, expect, it, vi } from "vitest";
import { createOverleafTools, type OverleafLiveTarget, type OverleafToolsHost } from "./overleaf-tools";

const THESIS: OverleafLiveTarget = { remoteId: "a", name: "Thesis", importedAs: null, stops: null };

function host(overrides: Partial<OverleafToolsHost> = {}): OverleafToolsHost {
  return {
    listProjects: vi.fn(async () => ({
      email: "ada@uni.edu",
      server: "https://www.overleaf.com",
      projects: [
        { id: "a", name: "Thesis", ownerName: "Ada", owned: true, lastUpdated: "2026-10-01", archived: false, importedAs: null },
        { id: "b", name: "Grant", ownerName: "Grace", owned: false, lastUpdated: null, archived: true, importedAs: "local-b" },
      ],
    })),
    importProjects: vi.fn(async (ids: string[]) =>
      ids.map((id) => (id === "bad" ? { remoteId: id, projectId: null, error: "denied" } : { remoteId: id, projectId: `local-${id}`, error: null })),
    ),
    findLive: vi.fn(async () => THESIS),
    openLive: vi.fn(async () => ({ projectId: "local-a", status: "online", role: "owner" })),
    describeError: (error) => `described: ${String(error)}`,
    ...overrides,
  };
}

describe("overleaf AI tools", () => {
  it("lists projects with owners and an optional name filter", async () => {
    const tools = createOverleafTools(host());
    expect(await tools.list_overleaf_projects.execute({})).toEqual({
      server: "https://www.overleaf.com",
      account: "ada@uni.edu",
      total: 2,
      truncated: false,
      projects: [
        { id: "a", name: "Thesis", owner: "you", lastUpdated: "2026-10-01", archived: false, importedAs: null },
        { id: "b", name: "Grant", owner: "Grace", lastUpdated: null, archived: true, importedAs: "local-b" },
      ],
    });
    const filtered = (await tools.list_overleaf_projects.execute({ query: "GRACE" })) as { projects: unknown[] };
    expect(filtered.projects).toHaveLength(1);
  });

  it("reports listing failures as text", async () => {
    const tools = createOverleafTools(host({ listProjects: vi.fn(async () => Promise.reject(new Error("expired"))) }));
    expect(await tools.list_overleaf_projects.execute({})).toEqual({ error: "described: Error: expired" });
  });

  it("validates ids, asks for approval and splits the outcome", async () => {
    const confirm = vi.fn(async () => true);
    const target = host();
    const tools = createOverleafTools(target, { confirm });
    expect(await tools.import_overleaf_projects.execute({ ids: [] })).toEqual({ error: "Provide at least one Overleaf project id." });
    expect(await tools.import_overleaf_projects.execute({ ids: Array.from({ length: 26 }, (_, index) => `p${index}`) })).toEqual({
      error: "Import at most 25 projects at a time.",
    });
    expect(await tools.import_overleaf_projects.execute({ ids: [" a ", "a", "bad", 7] })).toEqual({
      success: false,
      imported: [{ overleafId: "a", projectId: "local-a" }],
      failed: [{ overleafId: "bad", error: "described: denied" }],
    });
    expect(confirm).toHaveBeenCalledWith({ tool: "import_overleaf_projects", summary: "Import 2 projects from Overleaf" });
    expect(target.importProjects).toHaveBeenCalledWith(["a", "bad"]);
    await tools.import_overleaf_projects.execute({ ids: ["a"] });
    expect(confirm).toHaveBeenLastCalledWith({ tool: "import_overleaf_projects", summary: "Import 1 project from Overleaf" });
  });

  it("stops when the user declines and reports import failures", async () => {
    const declined = createOverleafTools(host(), { confirm: vi.fn(async () => false) });
    expect(await declined.import_overleaf_projects.execute({ ids: ["a"] })).toMatchObject({ declined: true });
    const failing = createOverleafTools(host({ importProjects: vi.fn(async () => Promise.reject(new Error("offline"))) }));
    expect(await failing.import_overleaf_projects.execute({ ids: ["a"] })).toEqual({ error: "described: Error: offline" });
    const allGood = createOverleafTools(host());
    expect(await allGood.import_overleaf_projects.execute({ ids: ["a"] })).toMatchObject({ success: true });
  });
});

describe("open_overleaf_live", () => {
  it("takes one id or address and nothing else", () => {
    const schema = createOverleafTools(host()).open_overleaf_live.inputSchema;
    expect(schema.required).toEqual(["id"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.id).toMatchObject({ type: "string", maxLength: 2048 });
  });

  it("refuses an empty or oversized id before reaching Overleaf", async () => {
    const target = host();
    const tools = createOverleafTools(target);
    const missing = { error: "Provide the Overleaf project id or the project's address." };
    expect(await tools.open_overleaf_live.execute({ id: "  " })).toEqual(missing);
    expect(await tools.open_overleaf_live.execute({ id: 7 })).toEqual(missing);
    expect(await tools.open_overleaf_live.execute({ id: "x".repeat(2049) })).toEqual(missing);
    expect(target.findLive).not.toHaveBeenCalled();
  });

  it("asks first, naming the project and the live project that stops, then reports the session", async () => {
    const confirm = vi.fn(async () => true);
    const target = host({ findLive: vi.fn(async () => ({ ...THESIS, stops: "Grant" })) });
    const tools = createOverleafTools(target, { confirm });
    expect(await tools.open_overleaf_live.execute({ id: " https://www.overleaf.com/project/a " })).toEqual({
      success: true,
      projectId: "local-a",
      status: "online",
      role: "owner",
    });
    expect(target.findLive).toHaveBeenCalledWith("https://www.overleaf.com/project/a");
    expect(confirm).toHaveBeenCalledWith({
      tool: "open_overleaf_live",
      summary: "Open \u201cThesis\u201d from Overleaf with live editing. Live editing stops in \u201cGrant\u201d.",
    });
    expect(target.openLive).toHaveBeenCalledWith({ ...THESIS, stops: "Grant" }, expect.any(Function));

    await createOverleafTools(host(), { confirm }).open_overleaf_live.execute({ id: "a" });
    expect(confirm).toHaveBeenLastCalledWith({
      tool: "open_overleaf_live",
      summary: "Open \u201cThesis\u201d from Overleaf with live editing",
    });
  });

  it("asks before looking the project up when the client has no project list of its own", async () => {
    const order: string[] = [];
    const confirm = vi.fn(async () => {
      order.push("confirm");
      return true;
    });
    const target = host({
      findLive: vi.fn(async () => {
        order.push("find");
        return THESIS;
      }),
    });
    const tools = createOverleafTools(target, { confirm, approveBeforeLookup: true });
    expect(await tools.open_overleaf_live.execute({ id: " 64f1c2a3b4c5d6e7f80901aa " })).toMatchObject({ success: true });
    expect(order).toEqual(["confirm", "find"]);
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      tool: "open_overleaf_live",
      summary: "Open the Overleaf project \u201c64f1c2a3b4c5d6e7f80901aa\u201d with live editing. Live editing in any other project stops.",
    });

    const declinedHost = host();
    const declined = createOverleafTools(declinedHost, { confirm: vi.fn(async () => false), approveBeforeLookup: true });
    expect(await declined.open_overleaf_live.execute({ id: "a" })).toMatchObject({ declined: true });
    expect(declinedHost.findLive).not.toHaveBeenCalled();
    expect(declinedHost.openLive).not.toHaveBeenCalled();
  });

  it("opens nothing when the user declines or the request was cancelled", async () => {
    const target = host();
    const declined = createOverleafTools(target, { confirm: vi.fn(async () => false) });
    expect(await declined.open_overleaf_live.execute({ id: "a" })).toEqual({
      message: "The user declined opening the project.",
      declined: true,
      status: "declined",
      tool: "open_overleaf_live",
    });
    let allowed = true;
    const cancelled = createOverleafTools(target, {
      confirm: vi.fn(async () => {
        allowed = false;
        return true;
      }),
      mutationAllowed: () => allowed,
    });
    expect(await cancelled.open_overleaf_live.execute({ id: "a" })).toEqual({
      error: "The request was cancelled before the project opened.",
      code: "cancelled",
    });
    expect(target.openLive).not.toHaveBeenCalled();
  });

  it("tells only the app's chat that opening a project ends its run", () => {
    const ends = "Opening another project ends the current run, so make this the last call.";
    expect(createOverleafTools(host()).open_overleaf_live.description).toContain(ends);
    expect(createOverleafTools(host(), { endsChatRun: false }).open_overleaf_live.description).not.toContain(ends);
  });

  it("hands the request's own check to the host", async () => {
    const target = host();
    const mutationAllowed = vi.fn(() => true);
    await createOverleafTools(target, { mutationAllowed }).open_overleaf_live.execute({ id: "a" });
    const shouldContinue = vi.mocked(target.openLive).mock.calls[0][1];
    mutationAllowed.mockReturnValue(false);
    expect(shouldContinue()).toBe(false);
  });

  it("says why it could not open, with the detail the host gave", async () => {
    const refusedBy = (refusal: Awaited<ReturnType<OverleafToolsHost["openLive"]>>) =>
      createOverleafTools(host({ openLive: vi.fn(async () => refusal) })).open_overleaf_live.execute({ id: "a" });
    expect(await refusedBy({ refused: "live_elsewhere", detail: "the command line, process 41" })).toEqual({
      error: "This project is already live in another Oleafly window or on the command line. (the command line, process 41)",
      code: "live_elsewhere",
    });
    expect(await refusedBy({ refused: "ended", detail: "access_ended" })).toEqual({
      error: "Live editing stopped before it connected. (access_ended)",
      code: "ended",
    });
    const off = createOverleafTools(host({ findLive: vi.fn(async () => ({ refused: "switch_off" as const })) }));
    expect(await off.open_overleaf_live.execute({ id: "a" })).toEqual({
      error:
        "Live editing with Overleaf is turned off. Ask the user to turn it on in Settings, under Experimentation, then try again.",
      code: "switch_off",
    });
  });

  it("reports a session that is still connecting without calling it a success", async () => {
    const tools = createOverleafTools(
      host({ openLive: vi.fn(async () => ({ projectId: "local-a", status: "connecting", role: null })) }),
    );
    expect(await tools.open_overleaf_live.execute({ id: "a" })).toEqual({
      projectId: "local-a",
      status: "connecting",
      role: null,
      message: "The project is open, but live editing hasn't connected yet. It keeps trying in the background.",
    });
  });

  it("describes a failure the host threw", async () => {
    const tools = createOverleafTools(host({ openLive: vi.fn(async () => Promise.reject(new Error("offline"))) }));
    expect(await tools.open_overleaf_live.execute({ id: "a" })).toEqual({ error: "described: Error: offline" });
  });
});
