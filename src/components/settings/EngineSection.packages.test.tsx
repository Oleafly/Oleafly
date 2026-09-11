// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.error, info: mocks.info, success: mocks.success } }));
import { useEngineStore } from "@/store/engine";
import { EngineSection } from "@/components/settings/EngineSection";

const detail = "tlmgr install: package tikz not present in repository.";
const engine = {
  kind: "system" as const,
  lualatex: "/test/lualatex",
  tlmgr: "/test/tlmgr",
  latexmk: "/test/latexmk",
  version: "test",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "latex_engine_info") return engine;
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
    if (command === "tlmgr_install") throw detail;
    return null;
  });
  useEngineStore.setState({
    info: engine,
    installed: [],
    busyPkg: null,
    loaded: true,
    installing: false,
    packageError: null,
  });
});

it("preserves the installer failure reason in the visible error", async () => {
  await useEngineStore.getState().addPackage("tikz");
  const shown = mocks.error.mock.calls.map((call) => call[0]).join("\n");
  expect(shown).toContain(detail);
});

it("uses the TeX Live package owning tikz.sty when the Settings Add button is clicked", async () => {
  const owner = "pgf";
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "tikz" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === "tlmgr_install")).toBe(true));
  const actual = mocks.invoke.mock.calls.find(([cmd]) => cmd === "tlmgr_install");
  expect(actual).toEqual(["tlmgr_install", { packages: [owner] }]);
});

it("searches TeX Live for packages beyond the suggested list", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "tlmgr_search") return [{ name: "classicthesis", description: "A thesis package" }];
    if (command === "latex_engine_info") return engine;
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    return null;
  });
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "classicthesis" } });
  fireEvent.click(screen.getByRole("button", { name: "Search TeX Live" }));
  await screen.findByText("classicthesis");
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("tlmgr_install", { packages: ["classicthesis"] }),
  );
});

it("recognizes installed packages under their TeX Live names and removes the shared package", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "latex_engine_info") return engine;
    if (command === "tlmgr_installed") return ["pgf", "caption", "tools"];
    if (command === "tex_distributions") return [];
    return null;
  });
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "tikz" } });
  await screen.findByRole("button", { name: "Remove" });
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("tlmgr_remove", { packages: ["pgf"] }));
});

it("shows where a personal-tree installation landed", async () => {
  const notice =
    "[Oleafly] The system TeX tree is not writable, so the packages went into your personal tree at /Users/t/Library/texmf.";
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "latex_engine_info") return engine;
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    if (command === "tlmgr_install") return `${notice}\ntlmgr: installing pgf`;
    return null;
  });
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "tikz" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByText(/personal tree at \/Users\/t\/Library\/texmf/)).toBeInTheDocument();
  expect(mocks.success.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
    "personal tree at /Users/t/Library/texmf",
  );
});

it("lists personal-tree packages and removes them from that tree", async () => {
  mocks.invoke.mockImplementation(async (command: string, args?: { userTree?: boolean }) => {
    if (command === "latex_engine_info") return engine;
    if (command === "tlmgr_installed") return args?.userTree ? ["pgf"] : ["tools"];
    if (command === "tex_distributions") return [];
    return null;
  });
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "tikz" } });
  await screen.findByText("in your personal tree");
  expect(useEngineStore.getState().installed).toEqual(["tools", "pgf"]);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("tlmgr_remove", {
      packages: ["pgf"],
      userTree: true,
    }),
  );
});

it("disables package changes when the detected distribution has no tlmgr", async () => {
  const noManager = { ...engine, tlmgr: null };
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "latex_engine_info" ? noManager : [],
  );
  useEngineStore.setState({ info: noManager });
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "tikz" } });
  expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Search TeX Live" })).toBeDisabled();
});

it("keeps installer details visible after the toast and supports retry", async () => {
  render(<EngineSection />);
  fireEvent.change(screen.getByPlaceholderText("Filter packages…"), { target: { value: "tikz" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(detail);
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "tlmgr_installed" ? ["pgf", "dependency"] : null,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await screen.findByRole("button", { name: "Remove" });
  expect(useEngineStore.getState().installed).toEqual(["pgf", "dependency"]);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("does not replace a newer search with a stale response", async () => {
  let resolve!: (value: unknown) => void;
  const first = new Promise((done) => {
    resolve = done;
  });
  mocks.invoke.mockImplementation(async (command: string, args: { query?: string }) => {
    if (command === "tlmgr_search")
      return args.query === "old" ? first : [{ name: "newthesis", description: "New thesis" }];
    if (command === "latex_engine_info") return engine;
    if (command === "tex_distributions" || command === "tlmgr_installed") return [];
    return null;
  });
  render(<EngineSection />);
  const input = screen.getByPlaceholderText("Filter packages…");
  fireEvent.change(input, { target: { value: "old" } });
  fireEvent.click(screen.getByRole("button", { name: "Search TeX Live" }));
  fireEvent.change(input, { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Search TeX Live" }));
  await screen.findByText("newthesis");
  await act(async () => resolve([{ name: "oldthesis", description: "Old" }]));
  expect(screen.queryByText("oldthesis")).toBeNull();
  expect(screen.getByText("newthesis")).toBeVisible();
});

it("does not let an older package-list read hide a newer install error", async () => {
  let resolve!: (value: string[]) => void;
  const pending = new Promise<string[]>((done) => {
    resolve = done;
  });
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "tlmgr_installed") return pending;
    if (command === "tlmgr_install") throw detail;
    return null;
  });
  const refreshing = useEngineStore.getState().refreshPackages();
  await useEngineStore.getState().addPackage("pgf");
  resolve(["pgf"]);
  await refreshing;
  expect(useEngineStore.getState().packageError).toContain(detail);
});
