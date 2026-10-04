import { describe, expect, it, vi } from "vitest";
import { createOleaflyTools, type AiToolsHost, type ConfirmFn } from "./tools";

const LIMIT = 16 * 1024 * 1024;
const TWO_BYTE_CHAR = String.fromCodePoint(0xe9);

function makeHost(initial: Record<string, string> = {}, overrides: Partial<AiToolsHost> = {}) {
  const files = new Map(Object.entries(initial));
  let generation = 0;
  const host = {
    getProjectId: vi.fn(() => "proj"),
    readFileContent: vi.fn(async (_id: string, path: string) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`missing ${path}`);
      return text;
    }),
    writeFileContent: vi.fn(async (_id: string, path: string, content: string) => {
      files.set(path, content);
      return {};
    }),
    createFile: vi.fn(async () => ({})),
    deleteFile: vi.fn(async () => ({})),
    renameFile: vi.fn(async () => ({})),
    setMainDoc: vi.fn(async (_id: string, path: string) => ({ main_doc: path })),
    listFiles: vi.fn(async () => [{ path: "main.tex" }]),
    searchProject: vi.fn(async () => [{ path: "main.tex", line: 3 }]),
    prepareExternalMutation: vi.fn(async () => {
      generation += 1;
      return generation;
    }),
    applyExternalWrite: vi.fn(() => true),
    applyExternalRename: vi.fn(() => true),
    applyExternalDelete: vi.fn(() => true),
    refreshTree: vi.fn(async () => {}),
    ...overrides,
  } as unknown as AiToolsHost;
  return { host, files };
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

describe("file tools without an open project", () => {
  it.each([
    ["read_file", { path: "main.tex" }],
    ["write_file", { path: "main.tex", content: "x" }],
    ["replace_in_file", { path: "main.tex", find: "a", replace: "b" }],
    ["create_file", { path: "new.tex" }],
    ["rename_file", { from: "a.tex", to: "b.tex" }],
    ["delete_file", { path: "a.tex" }],
    ["set_main_doc", { path: "a.tex" }],
    ["search_project", { query: "intro" }],
    ["list_files", {}],
  ])("%s reports that no project is open", async (name, input) => {
    const confirm = vi.fn(async () => true);
    const { host } = makeHost({}, { getProjectId: vi.fn(() => null) });
    const result = await createOleaflyTools(host, { confirm })[name].execute(input);
    expect(result).toEqual({ error: "No project open" });
    expect(confirm).not.toHaveBeenCalled();
    expect(host.prepareExternalMutation).not.toHaveBeenCalled();
  });
});

describe("read_file", () => {
  it("returns a short file whole with its line counts", async () => {
    const { host } = makeHost({ "main.tex": "a\nb\nc" });
    expect(await createOleaflyTools(host).read_file.execute({ path: "main.tex" })).toEqual({
      path: "main.tex",
      offset: 1,
      lines_returned: 3,
      total_lines: 3,
      truncated: false,
      content: "a\nb\nc",
    });
  });

  it("reads the slice an offset and limit select and flags the rest as truncated", async () => {
    const { host } = makeHost({ "main.tex": lines(10) });
    expect(
      await createOleaflyTools(host).read_file.execute({ path: "main.tex", offset: 3.9, limit: 2 }),
    ).toMatchObject({
      offset: 3,
      lines_returned: 2,
      total_lines: 10,
      truncated: true,
      content: "line 3\nline 4",
    });
  });

  it("caps one read at 800 lines whatever limit is asked for", async () => {
    const { host } = makeHost({ "big.tex": lines(1000) });
    const tools = createOleaflyTools(host);
    for (const limit of [5000, 0, undefined]) {
      expect(await tools.read_file.execute({ path: "big.tex", limit })).toMatchObject({
        lines_returned: 800,
        total_lines: 1000,
        truncated: true,
      });
    }
  });

  it("cuts content over 40,000 characters", async () => {
    const { host } = makeHost({ "wide.tex": "x".repeat(50_000) });
    const result = (await createOleaflyTools(host).read_file.execute({ path: "wide.tex" })) as {
      content: string;
      truncated: boolean;
      lines_returned: number;
    };
    expect(result.content).toHaveLength(40_000);
    expect(result.truncated).toBe(true);
    expect(result.lines_returned).toBe(1);
  });

  it("returns nothing for an offset past the end and starts at line 1 for a bad offset", async () => {
    const { host } = makeHost({ "main.tex": "a\nb" });
    const tools = createOleaflyTools(host);
    expect(await tools.read_file.execute({ path: "main.tex", offset: 99 })).toMatchObject({
      offset: 99,
      lines_returned: 0,
      truncated: false,
      content: "",
    });
    expect(await tools.read_file.execute({ path: "main.tex", offset: "soon" })).toMatchObject({
      offset: 1,
      content: "a\nb",
    });
  });

  it("warns the model when the file decoded lossily from a legacy encoding", async () => {
    const replacement = String.fromCodePoint(0xfffd);
    const { host } = makeHost({ "old.tex": `caf${replacement}` });
    expect(await createOleaflyTools(host).read_file.execute({ path: "old.tex" })).toMatchObject({
      encoding: "lossy-utf8",
      encoding_note: expect.stringContaining("legacy encoding"),
      content: `caf${replacement}`,
    });
  });

  it("returns read failures as an error", async () => {
    const { host } = makeHost();
    expect(await createOleaflyTools(host).read_file.execute({ path: "gone.tex" })).toEqual({
      error: "Error: missing gone.tex",
    });
  });
});

describe("write_file", () => {
  it("writes against the prepared generation when no approval is needed", async () => {
    const { host, files } = makeHost();
    const result = await createOleaflyTools(host).write_file.execute({ path: "a.tex", content: "hello" });
    expect(host.writeFileContent).toHaveBeenCalledWith("proj", "a.tex", "hello", 1);
    expect(host.applyExternalWrite).toHaveBeenCalledWith("proj", "a.tex", "hello");
    expect(files.get("a.tex")).toBe("hello");
    expect(result).toEqual({ success: true, path: "a.tex", bytes: 5 });
  });

  it("reports a conflict when the editor refuses the external write", async () => {
    const { host } = makeHost({}, { applyExternalWrite: vi.fn(() => false) });
    expect(await createOleaflyTools(host).write_file.execute({ path: "a.tex", content: "x" })).toEqual({
      error: expect.stringContaining("a.tex changed locally while the external write was running"),
      conflict: true,
    });
  });

  it("refuses content over the write limit before touching the project", async () => {
    const { host } = makeHost();
    const tools = createOleaflyTools(host);
    expect(await tools.write_file.execute({ path: "a.tex", content: "x".repeat(LIMIT + 1) })).toEqual({
      error: "File content exceeds the 16 MiB write limit.",
    });
    expect(
      await tools.write_file.execute({ path: "a.tex", content: TWO_BYTE_CHAR.repeat(LIMIT / 2 + 1) }),
    ).toEqual({ error: "File content exceeds the 16 MiB write limit." });
    expect(host.prepareExternalMutation).not.toHaveBeenCalled();
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("asks for approval with a before/after diff and writes against the fresh generation", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost({ "a.tex": "old" });
    const result = await createOleaflyTools(host, { confirm }).write_file.execute({
      path: "a.tex",
      content: "new",
    });
    expect(confirm).toHaveBeenCalledWith({
      tool: "write_file",
      summary: "Write a.tex",
      path: "a.tex",
      diff: { path: "a.tex", oldText: "old", newText: "new" },
    });
    expect(host.writeFileContent).toHaveBeenCalledWith("proj", "a.tex", "new", 2);
    expect(result).toEqual({ success: true, path: "a.tex", bytes: 3 });
  });

  it("shows a new file as all additions", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost();
    await createOleaflyTools(host, { confirm }).write_file.execute({ path: "new.tex", content: "body" });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ diff: { path: "new.tex", oldText: "", newText: "body" } }),
    );
    expect(host.writeFileContent).toHaveBeenCalledOnce();
  });

  it("leaves the file alone when the user declines", async () => {
    const { host } = makeHost({ "a.tex": "old" });
    const result = await createOleaflyTools(host, { confirm: async () => false }).write_file.execute({
      path: "a.tex",
      content: "new",
    });
    expect(result).toEqual({
      message: "The user declined this change.",
      declined: true,
      status: "declined",
      tool: "write_file",
    });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("refuses to write when the file changed while approval was pending", async () => {
    const { host, files } = makeHost({ "a.tex": "old" });
    const confirm = vi.fn<ConfirmFn>(async () => {
      files.set("a.tex", "edited meanwhile");
      return true;
    });
    expect(
      await createOleaflyTools(host, { confirm }).write_file.execute({ path: "a.tex", content: "new" }),
    ).toEqual({ error: "a.tex changed while approval was pending. Review and retry." });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("refuses to write when the project switched during approval", async () => {
    const getProjectId = vi.fn(() => "proj");
    const { host } = makeHost({ "a.tex": "old" }, { getProjectId });
    const confirm = vi.fn<ConfirmFn>(async () => {
      getProjectId.mockReturnValue("other");
      return true;
    });
    expect(
      await createOleaflyTools(host, { confirm }).write_file.execute({ path: "a.tex", content: "new" }),
    ).toEqual({
      error: "Error: Project changed or the external request was cancelled before mutation.",
    });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("does not prepare a mutation for a cancelled external request", async () => {
    const { host } = makeHost();
    const result = await createOleaflyTools(host, { mutationAllowed: () => false }).write_file.execute({
      path: "a.tex",
      content: "x",
    });
    expect(result).toEqual({
      error: "Error: Project changed or the external request was cancelled before mutation.",
    });
    expect(host.prepareExternalMutation).not.toHaveBeenCalled();
  });

  it("returns a failed write as an error", async () => {
    const { host } = makeHost(
      {},
      {
        writeFileContent: vi.fn(async () => {
          throw new Error("read-only folder");
        }),
      },
    );
    expect(await createOleaflyTools(host).write_file.execute({ path: "a.tex", content: "x" })).toEqual({
      error: "Error: read-only folder",
    });
    expect(host.applyExternalWrite).not.toHaveBeenCalled();
  });
});

describe("replace_in_file", () => {
  it("replaces only the first occurrence by default and keeps $ patterns verbatim", async () => {
    const { host, files } = makeHost({ "a.tex": "x + x + x" });
    const result = await createOleaflyTools(host).replace_in_file.execute({
      path: "a.tex",
      find: "x",
      replace: "$&y",
    });
    expect(files.get("a.tex")).toBe("$&y + x + x");
    expect(result).toEqual({ success: true, path: "a.tex", replacements: 1 });
  });

  it("replaces every occurrence with replace_all", async () => {
    const { host, files } = makeHost({ "a.tex": "x + x + x" });
    const result = await createOleaflyTools(host).replace_in_file.execute({
      path: "a.tex",
      find: "x",
      replace: "$1",
      replace_all: true,
    });
    expect(files.get("a.tex")).toBe("$1 + $1 + $1");
    expect(result).toEqual({ success: true, path: "a.tex", replacements: 3 });
  });

  it("rejects an empty find string", async () => {
    const { host } = makeHost({ "a.tex": "x" });
    expect(
      await createOleaflyTools(host).replace_in_file.execute({ path: "a.tex", find: "", replace: "y" }),
    ).toEqual({ error: "find must not be empty" });
    expect(host.prepareExternalMutation).not.toHaveBeenCalled();
  });

  it("errors without asking when the find string is absent", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost({ "a.tex": "abc" });
    expect(
      await createOleaflyTools(host, { confirm }).replace_in_file.execute({
        path: "a.tex",
        find: "zzz",
        replace: "y",
      }),
    ).toEqual({ error: "find string not found in file", path: "a.tex" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects a replacement whose output would exceed the write limit", async () => {
    const { host } = makeHost({ "a.tex": "a".repeat(1000) });
    expect(
      await createOleaflyTools(host).replace_in_file.execute({
        path: "a.tex",
        find: "a",
        replace: "b".repeat(20_000),
        replace_all: true,
      }),
    ).toEqual({ error: "Replacement output exceeds the 16 MiB write limit." });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("rejects more than 100,000 replacements", async () => {
    const { host } = makeHost({ "a.tex": "a".repeat(100_001) });
    expect(
      await createOleaflyTools(host).replace_in_file.execute({
        path: "a.tex",
        find: "a",
        replace: "b",
        replace_all: true,
      }),
    ).toEqual({ error: "Replacement count exceeds the 100,000 operation limit." });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("rejects output whose UTF-8 size exceeds the limit even when its length fits", async () => {
    const { host } = makeHost({ "a.tex": "x" });
    expect(
      await createOleaflyTools(host).replace_in_file.execute({
        path: "a.tex",
        find: "x",
        replace: TWO_BYTE_CHAR.repeat(LIMIT / 2 + 1),
      }),
    ).toEqual({ error: "File content exceeds the 16 MiB write limit." });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("sends the applied diff for approval and leaves the file alone when declined", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => false);
    const { host, files } = makeHost({ "a.tex": "alpha beta" });
    const result = await createOleaflyTools(host, { confirm }).replace_in_file.execute({
      path: "a.tex",
      find: "beta",
      replace: "gamma",
    });
    expect(confirm).toHaveBeenCalledWith({
      tool: "replace_in_file",
      summary: "Edit a.tex",
      path: "a.tex",
      diff: { path: "a.tex", oldText: "alpha beta", newText: "alpha gamma" },
    });
    expect(result).toMatchObject({ declined: true, tool: "replace_in_file" });
    expect(files.get("a.tex")).toBe("alpha beta");
  });

  it("refuses to write when the file changed while approval was pending", async () => {
    const { host, files } = makeHost({ "a.tex": "alpha beta" });
    const confirm = vi.fn<ConfirmFn>(async () => {
      files.set("a.tex", "alpha beta delta");
      return true;
    });
    expect(
      await createOleaflyTools(host, { confirm }).replace_in_file.execute({
        path: "a.tex",
        find: "beta",
        replace: "gamma",
      }),
    ).toEqual({ error: "a.tex changed while approval was pending. Review and retry." });
    expect(host.writeFileContent).not.toHaveBeenCalled();
  });

  it("writes against the generation prepared after approval", async () => {
    const { host } = makeHost({ "a.tex": "alpha beta" });
    await createOleaflyTools(host, { confirm: async () => true }).replace_in_file.execute({
      path: "a.tex",
      find: "beta",
      replace: "gamma",
    });
    expect(host.writeFileContent).toHaveBeenCalledWith("proj", "a.tex", "alpha gamma", 2);
  });

  it("reports a conflict when the editor refuses the external edit", async () => {
    const { host } = makeHost({ "a.tex": "alpha" }, { applyExternalWrite: vi.fn(() => false) });
    expect(
      await createOleaflyTools(host).replace_in_file.execute({ path: "a.tex", find: "alpha", replace: "b" }),
    ).toEqual({
      error: expect.stringContaining("a.tex changed locally while the external edit was running"),
      conflict: true,
    });
  });

  it("returns a failed read as an error", async () => {
    const { host } = makeHost();
    expect(
      await createOleaflyTools(host).replace_in_file.execute({ path: "gone.tex", find: "a", replace: "b" }),
    ).toEqual({ error: "Error: missing gone.tex" });
  });
});

describe("create_file", () => {
  it("creates a file, refreshes the tree, and defaults to a file", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost();
    const result = await createOleaflyTools(host, { confirm }).create_file.execute({ path: "ch1.tex" });
    expect(confirm).toHaveBeenCalledWith({ tool: "create_file", summary: "Create file ch1.tex", path: "ch1.tex" });
    expect(host.createFile).toHaveBeenCalledWith("proj", "ch1.tex", false, 1);
    expect(host.refreshTree).toHaveBeenCalledWith("proj");
    expect(result).toEqual({ success: true, path: "ch1.tex", is_dir: false });
  });

  it("names folders as folders in the approval request", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost();
    const result = await createOleaflyTools(host, { confirm }).create_file.execute({
      path: "figures",
      is_dir: true,
    });
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ summary: "Create folder figures" }));
    expect(host.createFile).toHaveBeenCalledWith("proj", "figures", true, 1);
    expect(result).toEqual({ success: true, path: "figures", is_dir: true });
  });

  it("does nothing when declined", async () => {
    const { host } = makeHost();
    expect(
      await createOleaflyTools(host, { confirm: async () => false }).create_file.execute({ path: "x.tex" }),
    ).toMatchObject({ declined: true, tool: "create_file" });
    expect(host.createFile).not.toHaveBeenCalled();
  });

  it("returns a failed create as an error", async () => {
    const { host } = makeHost(
      {},
      {
        createFile: vi.fn(async () => {
          throw new Error("exists");
        }),
      },
    );
    expect(await createOleaflyTools(host).create_file.execute({ path: "x.tex" })).toEqual({
      error: "Error: exists",
    });
    expect(host.refreshTree).not.toHaveBeenCalled();
  });
});

describe("rename_file", () => {
  it("renames after approval and syncs the open editors", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost();
    const result = await createOleaflyTools(host, { confirm }).rename_file.execute({ from: "a.tex", to: "b.tex" });
    expect(confirm).toHaveBeenCalledWith({ tool: "rename_file", summary: "Rename a.tex → b.tex", path: "a.tex" });
    expect(host.renameFile).toHaveBeenCalledWith("proj", "a.tex", "b.tex", 1);
    expect(host.applyExternalRename).toHaveBeenCalledWith("proj", "a.tex", "b.tex");
    expect(result).toEqual({ success: true, from: "a.tex", to: "b.tex" });
  });

  it("does nothing when declined", async () => {
    const { host } = makeHost();
    expect(
      await createOleaflyTools(host, { confirm: async () => false }).rename_file.execute({ from: "a", to: "b" }),
    ).toMatchObject({ declined: true, tool: "rename_file" });
    expect(host.renameFile).not.toHaveBeenCalled();
  });

  it("reports a conflict when the project changed during the rename", async () => {
    const { host } = makeHost({}, { applyExternalRename: vi.fn(() => false) });
    expect(await createOleaflyTools(host).rename_file.execute({ from: "a", to: "b" })).toEqual({
      error: "Project changed while the rename was running.",
      conflict: true,
    });
  });

  it("returns a failed rename as an error", async () => {
    const { host } = makeHost(
      {},
      {
        renameFile: vi.fn(async () => {
          throw new Error("target exists");
        }),
      },
    );
    expect(await createOleaflyTools(host).rename_file.execute({ from: "a", to: "b" })).toEqual({
      error: "Error: target exists",
    });
  });
});

describe("delete_file", () => {
  it("deletes after approval and syncs the open editors", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost();
    const result = await createOleaflyTools(host, { confirm }).delete_file.execute({ path: "old.tex" });
    expect(confirm).toHaveBeenCalledWith({ tool: "delete_file", summary: "Delete old.tex", path: "old.tex" });
    expect(host.deleteFile).toHaveBeenCalledWith("proj", "old.tex", 1);
    expect(host.applyExternalDelete).toHaveBeenCalledWith("proj", "old.tex");
    expect(result).toEqual({ success: true, path: "old.tex" });
  });

  it("does nothing when declined", async () => {
    const { host } = makeHost();
    expect(
      await createOleaflyTools(host, { confirm: async () => false }).delete_file.execute({ path: "old.tex" }),
    ).toMatchObject({ declined: true, tool: "delete_file" });
    expect(host.deleteFile).not.toHaveBeenCalled();
  });

  it("reports a conflict when unsaved local edits raced the delete", async () => {
    const { host } = makeHost({}, { applyExternalDelete: vi.fn(() => false) });
    expect(await createOleaflyTools(host).delete_file.execute({ path: "old.tex" })).toEqual({
      error: expect.stringContaining("Unsaved local edits were restored"),
      conflict: true,
    });
  });

  it("returns a failed delete as an error", async () => {
    const { host } = makeHost(
      {},
      {
        deleteFile: vi.fn(async () => {
          throw new Error("busy");
        }),
      },
    );
    expect(await createOleaflyTools(host).delete_file.execute({ path: "old.tex" })).toEqual({
      error: "Error: busy",
    });
  });
});

describe("set_main_doc", () => {
  it("sets the main document after approval and echoes what the backend stored", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    const { host } = makeHost({}, { setMainDoc: vi.fn(async () => ({ main_doc: "thesis.tex" })) });
    const result = await createOleaflyTools(host, { confirm }).set_main_doc.execute({ path: "thesis.tex" });
    expect(confirm).toHaveBeenCalledWith({
      tool: "set_main_doc",
      summary: "Set main document to thesis.tex",
      path: "thesis.tex",
    });
    expect(host.prepareExternalMutation).toHaveBeenCalledWith("proj");
    expect(result).toEqual({ success: true, main_doc: "thesis.tex" });
  });

  it("does nothing when declined", async () => {
    const { host } = makeHost();
    expect(
      await createOleaflyTools(host, { confirm: async () => false }).set_main_doc.execute({ path: "a.tex" }),
    ).toMatchObject({ declined: true, tool: "set_main_doc" });
    expect(host.setMainDoc).not.toHaveBeenCalled();
  });

  it("returns the backend refusal as an error", async () => {
    const { host } = makeHost(
      {},
      {
        setMainDoc: vi.fn(async () => {
          throw new Error("read-only folder");
        }),
      },
    );
    expect(await createOleaflyTools(host).set_main_doc.execute({ path: "a.tex" })).toEqual({
      error: "Error: read-only folder",
    });
  });
});

describe("search_project and list_files", () => {
  it("returns every search hit with its total", async () => {
    const { host } = makeHost();
    expect(await createOleaflyTools(host).search_project.execute({ query: "intro" })).toEqual({
      results: [{ path: "main.tex", line: 3 }],
      total: 1,
    });
    expect(host.searchProject).toHaveBeenCalledWith("proj", "intro");
  });

  it("lists the project's files", async () => {
    const { host } = makeHost();
    expect(await createOleaflyTools(host).list_files.execute({})).toEqual({ files: [{ path: "main.tex" }] });
  });

  it("returns search and listing failures as errors", async () => {
    const { host } = makeHost(
      {},
      {
        searchProject: vi.fn(async () => {
          throw new Error("index busy");
        }),
        listFiles: vi.fn(async () => {
          throw new Error("disk gone");
        }),
      },
    );
    const tools = createOleaflyTools(host);
    expect(await tools.search_project.execute({ query: "q" })).toEqual({ error: "Error: index busy" });
    expect(await tools.list_files.execute({})).toEqual({ error: "Error: disk gone" });
  });
});
