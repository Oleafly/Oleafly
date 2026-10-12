import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafListProjects: vi.fn(),
}));
const store = vi.hoisted(() => {
  const state = { server: "https://www.overleaf.com", importSelected: vi.fn() };
  return { state, setState: vi.fn(), getState: () => state };
});
const files = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => {}) }));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/store/overleaf-import", () => ({ useOverleafImportStore: store }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));

import { createOverleafAiTools } from "./overleaf-ai-tools";

const SERVER = "https://www.overleaf.com";
const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };
const expired = '@oleafly/error:{"code":"overleaf.session_expired","params":{}}';

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  store.setState.mockReset();
  store.state.importSelected.mockReset();
  files.refreshProjects.mockClear();
});

describe("overleaf AI tool host", () => {
  it("lists right away when signed in", async () => {
    api.overleafStatus.mockResolvedValue(signedIn);
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [] });
    const tools = createOverleafAiTools();
    expect(await tools.list_overleaf_projects.execute({})).toMatchObject({ account: "ada@uni.edu", total: 0 });
    expect(api.overleafSignIn).not.toHaveBeenCalled();
  });

  it("opens the sign-in window first, and again when the session expired", async () => {
    api.overleafStatus.mockResolvedValueOnce({ ...signedIn, signedIn: false }).mockResolvedValueOnce({ ...signedIn, signedIn: false });
    api.overleafSignIn.mockResolvedValue(signedIn);
    api.overleafListProjects.mockRejectedValueOnce(expired).mockResolvedValueOnce({ status: signedIn, projects: [] });
    const tools = createOverleafAiTools();
    expect(await tools.list_overleaf_projects.execute({})).toMatchObject({ total: 0 });
    expect(api.overleafSignIn).toHaveBeenCalledTimes(2);
    expect(api.overleafSignIn).toHaveBeenCalledWith(SERVER, "Sign in to Overleaf");
    expect(store.setState).toHaveBeenCalledWith({ status: signedIn });
  });

  it("passes other listing errors through as text", async () => {
    api.overleafStatus.mockResolvedValue(signedIn);
    api.overleafListProjects.mockRejectedValue('@oleafly/error:{"code":"overleaf.unrecognized","params":{}}');
    const tools = createOverleafAiTools();
    const result = (await tools.list_overleaf_projects.execute({})) as { error: string };
    expect(result.error).toContain(".zip");
  });

  it("imports through the store and refreshes the library", async () => {
    api.overleafStatus.mockResolvedValue(signedIn);
    store.state.importSelected.mockResolvedValue([{ remoteId: "a", projectId: "local-a", error: null }]);
    const tools = createOverleafAiTools({ confirm: async () => true });
    expect(await tools.import_overleaf_projects.execute({ ids: ["a"] })).toMatchObject({ success: true });
    expect(store.state.importSelected).toHaveBeenCalledWith(["a"]);
    expect(files.refreshProjects).toHaveBeenCalledOnce();

    store.state.importSelected.mockResolvedValue([{ remoteId: "a", projectId: null, error: "x" }]);
    await tools.import_overleaf_projects.execute({ ids: ["a"] });
    expect(files.refreshProjects).toHaveBeenCalledOnce();
  });
});
