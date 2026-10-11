// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafSignOut: vi.fn(),
  overleafImportProjects: vi.fn(),
}));
const files = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => {}) }));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));

import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import { OverleafImportView } from "./OverleafImportView";

const SERVER = "https://www.overleaf.com";
const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };

function project(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    ownerName: "Ada Lovelace",
    owned: true,
    access: "owner",
    lastUpdated: new Date().toISOString(),
    lastUpdatedBy: null,
    archived: false,
    importedAs: null,
    ...extra,
  };
}

const PROJECTS = [
  project("a1", "Thesis"),
  project("b2", "Shared paper", { owned: false, ownerName: "Grace Hopper", archived: true }),
  project("c3", "Old notes", { importedAs: "local-c3" }),
];

function resetStore() {
  useOverleafImportStore.setState({
    server: SERVER,
    status: null,
    projects: [],
    phase: "idle",
    error: null,
    selected: [],
    progress: {},
    importing: false,
  });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  files.refreshProjects.mockClear();
  localStorage.clear();
  resetStore();
  useSettingsStore.getState().setHomeProjectLayout("list");
  api.overleafStatus.mockResolvedValue(signedIn);
  api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: PROJECTS });
});

describe("OverleafImportView", () => {
  it("asks to sign in, opens the sign-in window and then lists projects", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    api.overleafSignIn.mockResolvedValue(signedIn);
    render(<OverleafImportView onOpenProject={vi.fn()} />);

    const panel = await screen.findByTestId("overleaf-sign-in-panel");
    expect(panel).toHaveTextContent("Server: www.overleaf.com");
    fireEvent.click(screen.getByTestId("overleaf-sign-in"));

    expect(await screen.findByTestId("overleaf-import-view")).toBeInTheDocument();
    expect(api.overleafSignIn).toHaveBeenCalledWith(SERVER, "Sign in to Overleaf");
    expect(screen.getByText("Signed in as ada@uni.edu")).toBeInTheDocument();
  });

  it("switches to another server and back to overleaf.com", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    await screen.findByTestId("overleaf-sign-in-panel");

    fireEvent.click(screen.getByTestId("overleaf-change-server"));
    fireEvent.change(screen.getByTestId("overleaf-server-input"), { target: { value: "https://latex.uni.edu" } });
    api.overleafStatus.mockResolvedValue({ server: "https://latex.uni.edu", signedIn: false, email: null });
    fireEvent.click(screen.getByRole("button", { name: "Use this server" }));

    await waitFor(() => expect(api.overleafStatus).toHaveBeenLastCalledWith("https://latex.uni.edu"));
    expect(await screen.findByText(/Server: latex\.uni\.edu/)).toBeInTheDocument();
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    fireEvent.click(screen.getByRole("button", { name: "Use overleaf.com" }));
    await waitFor(() => expect(api.overleafStatus).toHaveBeenLastCalledWith(SERVER));
  });

  it("shows why sign-in is needed again and any sign-in failure", async () => {
    api.overleafListProjects.mockRejectedValueOnce('@oleafly/error:{"code":"overleaf.session_expired","params":{}}');
    const { unmount } = render(<OverleafImportView onOpenProject={vi.fn()} />);
    expect(await screen.findByText("Your Overleaf sign-in expired. Sign in again to see your projects.")).toBeInTheDocument();
    unmount();

    resetStore();
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    api.overleafSignIn.mockRejectedValue('@oleafly/error:{"code":"overleaf.sign_in_failed","params":{}}');
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("overleaf-sign-in"));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm your Overleaf sign-in");
  });

  it("searches, filters and selects what is visible", async () => {
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    expect(screen.getByPlaceholderText("Search 3 projects")).toBeInTheDocument();
    expect(within(screen.getByTestId("overleaf-project-b2")).getByText("Archived")).toBeInTheDocument();
    expect(within(screen.getByTestId("overleaf-project-b2")).getByText(/Owned by Grace Hopper/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("overleaf-filter-shared"));
    expect(screen.queryByTestId("overleaf-project-a1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-filter-owned"));
    expect(screen.queryByTestId("overleaf-project-b2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-filter-all"));

    fireEvent.change(screen.getByTestId("overleaf-search"), { target: { value: "thesis" } });
    expect(screen.getByTestId("overleaf-project-a1")).toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-project-c3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-select-all"));
    expect(useOverleafImportStore.getState().selected).toEqual(["a1"]);
    fireEvent.click(screen.getByTestId("overleaf-select-all"));
    expect(useOverleafImportStore.getState().selected).toEqual([]);

    fireEvent.change(screen.getByTestId("overleaf-search"), { target: { value: "zzz" } });
    expect(screen.getByText("No projects match your search.")).toBeInTheDocument();
  });

  it("imports the selection with progress, then offers to open each project", async () => {
    const onOpenProject = vi.fn();
    let finish: (value: unknown) => void = () => {};
    api.overleafImportProjects.mockImplementation((_server: string, _ids: string[], onEvent: (event: unknown) => void) => {
      onEvent({ phase: "downloading", remoteId: "a1", received: 50, total: 100 });
      onEvent({ phase: "importing", remoteId: "c3" });
      return new Promise((resolve) => {
        finish = (value) => {
          onEvent({ phase: "done", remoteId: "a1", projectId: "local-a1", mainDoc: null, compiler: null });
          resolve(value);
        };
      });
    });
    render(<OverleafImportView onOpenProject={onOpenProject} />);
    await screen.findByTestId("overleaf-import-view");

    fireEvent.click(screen.getByText("Thesis"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Old notes" }));
    expect(screen.getByTestId("overleaf-selection-summary")).toHaveTextContent("2 projects selected");
    expect(screen.getByText("Projects already in your library come in as a new copy.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-import-selected"));

    expect(await screen.findByText("Downloading 50%")).toBeInTheDocument();
    expect(screen.getByText("Setting up")).toBeInTheDocument();
    await act(async () => {
      finish([
        { remoteId: "a1", projectId: "local-a1", error: null },
        { remoteId: "c3", projectId: null, error: '@oleafly/error:{"code":"overleaf.project_unavailable","params":{}}' },
      ]);
    });

    await waitFor(() => expect(files.refreshProjects).toHaveBeenCalledOnce());
    expect(screen.getByTestId("overleaf-selection-summary")).toHaveTextContent(
      "Imported 1 project. 1 project could not be imported.",
    );
    const imported = screen.getByTestId("overleaf-status-a1");
    fireEvent.click(within(imported).getByRole("button", { name: "Open" }));
    expect(onOpenProject).toHaveBeenCalledWith("local-a1");

    api.overleafImportProjects.mockResolvedValue([{ remoteId: "c3", projectId: "local-c3b", error: null }]);
    const failed = screen.getByTestId("overleaf-status-c3");
    expect(failed).toHaveTextContent("You may no longer have access to it.");
    fireEvent.click(within(failed).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.overleafImportProjects).toHaveBeenLastCalledWith(SERVER, ["c3"], expect.any(Function)));
  });

  it("shows projects as books in the grid layout", async () => {
    useSettingsStore.getState().setHomeProjectLayout("grid");
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    const book = screen.getByTestId("overleaf-project-a1");
    fireEvent.click(within(book).getByRole("checkbox", { name: "Select Thesis" }));
    expect(useOverleafImportStore.getState().selected).toEqual(["a1"]);
    expect(within(screen.getByTestId("overleaf-project-c3")).getByText("Imported")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(useSettingsStore.getState().homeProjectLayout).toBe("list");
  });

  it("explains an empty account and signs out", async () => {
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [] });
    api.overleafSignOut.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    expect(await screen.findByText("There are no projects in this Overleaf account yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-sign-out"));
    expect(await screen.findByTestId("overleaf-sign-in-panel")).toBeInTheDocument();
  });

  it("offers a retry when the list cannot load", async () => {
    api.overleafListProjects.mockRejectedValueOnce(new Error("socket hang up"));
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Oleafly could not load your Overleaf projects.");
    expect(screen.getByText(/socket hang up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("overleaf-import-view")).toBeInTheDocument();
  });

  it("names a page it cannot read and suggests the zip instead", async () => {
    api.overleafListProjects.mockRejectedValueOnce('@oleafly/error:{"code":"overleaf.unrecognized","params":{}}');
    render(<OverleafImportView onOpenProject={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Download the project as a .zip");
  });
});
