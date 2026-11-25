// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafSignInWithAppCookies: vi.fn(),
  overleafSignInBrowsers: vi.fn(),
  overleafSignInWithBrowser: vi.fn(),
  overleafSignOut: vi.fn(),
  overleafImportProjects: vi.fn(),
  overleafUseAccount: vi.fn(),
}));
const cookies = vi.hoisted(() => ({
  detectBrowserCookieSources: vi.fn(async () => [] as unknown[]),
  importBrowserCookies: vi.fn(),
}));
const files = vi.hoisted(() => ({ refreshProjects: vi.fn(async () => {}) }));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...cookies,
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
    signingWith: null,
    error: null,
    selected: [],
    progress: {},
    importing: false,
    run: null,
  });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.overleafSignInBrowsers.mockResolvedValue([]);
  cookies.detectBrowserCookieSources.mockReset().mockResolvedValue([]);
  cookies.importBrowserCookies.mockReset();
  files.refreshProjects.mockClear();
  localStorage.clear();
  resetStore();
  useOverleafImportStore.getState().setLayout("list");
  api.overleafStatus.mockResolvedValue(signedIn);
  api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: PROJECTS });
});

describe("OverleafImportView", () => {
  it("asks to sign in, opens the sign-in window and then lists projects", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    api.overleafSignIn.mockResolvedValue(signedIn);
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);

    const panel = await screen.findByTestId("overleaf-sign-in-panel");
    expect(panel).toHaveTextContent("Server: www.overleaf.com");
    expect(screen.getByTestId("overleaf-passkey-hint")).toHaveTextContent(
      "If your passkey doesn't work in the sign-in window, pick another option there",
    );
    fireEvent.click(screen.getByTestId("overleaf-sign-in"));

    expect(await screen.findByTestId("overleaf-import-view")).toBeInTheDocument();
    expect(api.overleafSignIn).toHaveBeenCalledWith(SERVER, "Sign in to Overleaf");
    expect(screen.getByText("Signed in as ada@uni.edu")).toBeInTheDocument();
  });

  it("copies the sign-in from a browser and lists that account's projects, not the one that expired", async () => {
    const user = userEvent.setup();
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.scrollIntoView = vi.fn();
    api.overleafStatus
      .mockResolvedValueOnce({ ...signedIn, email: "bea@lab.org", userId: "u-bea" })
      .mockResolvedValue({ ...signedIn, userId: "u-ada" });
    api.overleafListProjects.mockImplementation(async (_server: string, account: string) => {
      if (account === "u-bea") throw '@oleafly/error:{"code":"overleaf.session_expired","params":{}}';
      return { status: { ...signedIn, userId: "u-ada" }, projects: PROJECTS };
    });
    cookies.detectBrowserCookieSources.mockResolvedValue([
      { browser: "chrome", browserName: "Google Chrome", profile: "Default", profileName: "Default", status: "available", detail: "Ready" },
    ]);
    cookies.importBrowserCookies.mockResolvedValue({ imported: 2, browserName: "Google Chrome", profileName: "Default", domain: "www.overleaf.com" });
    api.overleafSignInWithAppCookies.mockResolvedValue(signedIn);
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);

    await screen.findByTestId("overleaf-sign-in-panel");
    await user.click(await screen.findByRole("button", { name: "Copy the sign-in from your browser" }));
    await user.click(await screen.findByLabelText(/Google Chrome/));
    await user.click(screen.getByRole("button", { name: "Copy sign-in" }));

    expect(await screen.findByTestId("overleaf-import-view")).toBeInTheDocument();
    expect(cookies.importBrowserCookies).toHaveBeenCalledWith({ browser: "chrome", profile: "Default", domain: "www.overleaf.com" });
    expect(api.overleafSignIn).not.toHaveBeenCalled();
    expect(api.overleafListProjects).toHaveBeenLastCalledWith(SERVER, "u-ada");
  });

  it("signs in with an installed browser, names it while waiting, then lists projects", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    api.overleafSignInBrowsers.mockResolvedValue([
      { key: "firefox", name: "Firefox" },
      { key: "chrome", name: "Google Chrome" },
    ]);
    let finish: (status: typeof signedIn) => void = () => {};
    api.overleafSignInWithBrowser.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: PROJECTS });
    const user = userEvent.setup();
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    const panel = await screen.findByTestId("overleaf-sign-in-panel");
    expect(within(panel).getByRole("combobox", { name: "Browser to sign in with" })).toHaveTextContent("Firefox");
    await user.click(await within(panel).findByRole("button", { name: "Sign in with your browser" }));
    expect(api.overleafSignInWithBrowser).toHaveBeenCalledWith(SERVER, "firefox");
    expect(
      await within(panel).findByText("Finish signing in to Overleaf in Firefox. The window closes by itself once you're in. Closing it cancels."),
    ).toBeVisible();
    expect(screen.getByTestId("overleaf-sign-in")).toBeDisabled();
    expect(screen.getByTestId("overleaf-change-server")).toBeDisabled();
    await act(async () => finish(signedIn));
    expect(await screen.findByTestId("overleaf-import-view")).toBeInTheDocument();
    expect(api.overleafSignIn).not.toHaveBeenCalled();
  });

  it("offers no browser copy when no browser profile can be read", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-sign-in-panel");
    await waitFor(() => expect(cookies.detectBrowserCookieSources).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Copy the sign-in from your browser" })).toBeNull();
  });

  it("switches to another server and back to overleaf.com", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
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
    const { unmount } = render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText("Your Overleaf sign-in expired. Sign in again to see your projects.")).toBeInTheDocument();
    unmount();

    resetStore();
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    api.overleafSignIn.mockRejectedValue('@oleafly/error:{"code":"overleaf.sign_in_failed","params":{}}');
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("overleaf-sign-in"));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not confirm your Overleaf sign-in");
  });

  it("searches, filters and selects what is visible", async () => {
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
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
    expect(screen.getByTestId("overleaf-select-all")).toHaveTextContent("Select all");
    fireEvent.click(screen.getByTestId("overleaf-select-all"));
    expect(useOverleafImportStore.getState().selected).toEqual(["a1"]);
    expect(screen.getByTestId("overleaf-select-all")).toHaveTextContent("Clear selection");
    fireEvent.click(screen.getByTestId("overleaf-select-all"));
    expect(useOverleafImportStore.getState().selected).toEqual([]);

    fireEvent.change(screen.getByTestId("overleaf-search"), { target: { value: "zzz" } });
    expect(screen.getByText("No projects match your search.")).toBeInTheDocument();
  });

  it("moves the selection into an import view with progress, then closes on Done", async () => {
    const onOpenProject = vi.fn();
    const onDone = vi.fn();
    let finish: (value: unknown) => void = () => {};
    api.overleafImportProjects.mockImplementation((_server: string, _ids: string[], onEvent: (event: unknown) => void) => {
      onEvent({ phase: "downloading", remoteId: "a1", received: 50, total: 100 });
      onEvent({ phase: "importing", remoteId: "b2" });
      return new Promise((resolve) => {
        finish = (value) => {
          onEvent({ phase: "done", remoteId: "a1", projectId: "local-a1", mainDoc: null, compiler: null });
          resolve(value);
        };
      });
    });
    render(<OverleafImportView onOpenProject={onOpenProject} onDone={onDone} />);
    await screen.findByTestId("overleaf-import-view");

    expect(screen.getByRole("button", { name: "Select Old notes" })).toBeDisabled();
    fireEvent.click(screen.getByText("Thesis"));
    const shared = screen.getByRole("button", { name: "Select Shared paper" });
    fireEvent.click(shared);
    expect(shared).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("overleaf-selection-summary")).toHaveTextContent("2 projects selected");
    expect(screen.getByText("Comments, tracked changes, chat and history stay on Overleaf.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-import-selected"));

    expect(await screen.findByTestId("overleaf-import-run")).toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-project-c3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-import-selected")).not.toBeInTheDocument();
    expect(screen.getByTestId("overleaf-run-summary")).toHaveTextContent("Importing your projects");
    expect(screen.getByTestId("overleaf-import-done")).toBeDisabled();
    expect(await screen.findByText("Downloading 50%")).toBeInTheDocument();
    expect(screen.getByText("Setting up")).toBeInTheDocument();
    await act(async () => {
      finish([
        { remoteId: "a1", projectId: "local-a1", error: null },
        { remoteId: "b2", projectId: null, error: '@oleafly/error:{"code":"overleaf.project_unavailable","params":{}}' },
      ]);
    });

    await waitFor(() => expect(files.refreshProjects).toHaveBeenCalledOnce());
    expect(screen.getByTestId("overleaf-run-summary")).toHaveTextContent(
      "Imported 1 project. 1 project could not be imported.",
    );
    const imported = screen.getByTestId("overleaf-status-a1");
    fireEvent.click(within(imported).getByRole("button", { name: "Open Thesis" }));
    expect(onOpenProject).toHaveBeenCalledWith("local-a1");

    api.overleafImportProjects.mockResolvedValue([{ remoteId: "b2", projectId: "local-b2", error: null }]);
    const failed = screen.getByTestId("overleaf-status-b2");
    expect(failed).toHaveTextContent("You may no longer have access to it.");
    fireEvent.click(within(failed).getByRole("button", { name: "Try again Shared paper" }));
    await waitFor(() => expect(api.overleafImportProjects).toHaveBeenLastCalledWith(SERVER, ["b2"], expect.any(Function), undefined));
    await waitFor(() => expect(screen.getByTestId("overleaf-import-done")).toBeEnabled());
    fireEvent.click(screen.getByTestId("overleaf-import-done"));
    expect(onDone).toHaveBeenCalledOnce();
    expect(useOverleafImportStore.getState().run).toBeNull();
    expect(useOverleafImportStore.getState().selected).toEqual([]);
  });

  it("shows projects as books in the grid layout, and its view switch leaves Home alone", async () => {
    useOverleafImportStore.getState().setLayout("grid");
    useSettingsStore.getState().setHomeProjectLayout("grid");
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    await screen.findByTestId("overleaf-import-view");
    const book = screen.getByTestId("overleaf-project-a1");
    expect(within(book).queryByRole("checkbox")).not.toBeInTheDocument();
    const select = within(book).getByRole("button", { name: "Select Thesis" });
    expect(book.querySelector('[data-slot="check-badge"]')).toBeNull();
    fireEvent.click(select);
    expect(useOverleafImportStore.getState().selected).toEqual(["a1"]);
    expect(select).toHaveAttribute("aria-pressed", "true");
    expect(select.querySelector('[data-slot="check-badge"]')).not.toBeNull();
    fireEvent.click(select);
    expect(useOverleafImportStore.getState().selected).toEqual([]);
    expect(book.querySelector('[data-slot="check-badge"]')).toBeNull();
    fireEvent.click(select);
    expect(within(screen.getByTestId("overleaf-project-c3")).getByText("Imported")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "List view" }));
    expect(useOverleafImportStore.getState().layout).toBe("list");
    expect(localStorage.getItem("oleafly.overleaf.importLayout")).toBe("list");
    expect(useSettingsStore.getState().homeProjectLayout).toBe("grid");
  });

  it("explains an empty account and signs out", async () => {
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [] });
    api.overleafSignOut.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText("There are no projects in this Overleaf account yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-sign-out"));
    expect(await screen.findByTestId("overleaf-sign-in-panel")).toBeInTheDocument();
  });

  it("switches between two signed-in accounts and lists each one's projects", async () => {
    const ada = { userId: "u-ada", email: "ada@uni.edu" };
    const bea = { userId: "u-bea", email: "bea@lab.org" };
    const asAda = { server: SERVER, signedIn: true, email: ada.email, userId: ada.userId, accounts: [ada, bea] };
    const asBea = { ...asAda, email: bea.email, userId: bea.userId, accounts: [bea, ada] };
    api.overleafStatus.mockResolvedValue(asAda);
    api.overleafListProjects.mockImplementation(async (_server: string, account: string | null) => ({
      status: account === "u-bea" ? asBea : asAda,
      projects: account === "u-bea" ? [project("z9", "Lab notes")] : PROJECTS,
    }));
    api.overleafUseAccount.mockResolvedValue(asBea);
    const user = userEvent.setup();
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText("Thesis")).toBeInTheDocument();
    expect(api.overleafListProjects).toHaveBeenLastCalledWith(SERVER, "u-ada");
    const picker = screen.getByTestId("overleaf-account-picker");
    expect(picker).toHaveTextContent("ada@uni.edu");
    await user.click(picker);
    await user.click(await screen.findByRole("option", { name: "bea@lab.org" }));
    expect(api.overleafUseAccount).toHaveBeenCalledWith(SERVER, "u-bea");
    expect(await screen.findByText("Lab notes")).toBeInTheDocument();
    expect(screen.queryByText("Thesis")).not.toBeInTheDocument();
    expect(api.overleafListProjects).toHaveBeenLastCalledWith(SERVER, "u-bea");
  });

  it("shows no account picker with one account", async () => {
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText("Thesis")).toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-account-picker")).not.toBeInTheDocument();
    expect(screen.getByText("Signed in as ada@uni.edu")).toBeInTheDocument();
  });

  it("offers a retry when the list cannot load", async () => {
    api.overleafListProjects.mockRejectedValueOnce(new Error("socket hang up"));
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Oleafly could not load your Overleaf projects.");
    expect(screen.getByText(/socket hang up/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("overleaf-import-view")).toBeInTheDocument();
  });

  it("lets another server be chosen when the saved one cannot be reached", async () => {
    api.overleafListProjects.mockRejectedValueOnce(new Error("connection refused"));
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Oleafly could not load your Overleaf projects.");
    fireEvent.click(screen.getByTestId("overleaf-change-server"));
    fireEvent.change(screen.getByTestId("overleaf-server-input"), { target: { value: "https://latex.uni.edu" } });
    api.overleafStatus.mockResolvedValue({ server: "https://latex.uni.edu", signedIn: false, email: null });
    fireEvent.click(screen.getByRole("button", { name: "Use this server" }));
    await waitFor(() => expect(api.overleafStatus).toHaveBeenLastCalledWith("https://latex.uni.edu"));
    expect(await screen.findByTestId("overleaf-sign-in-panel")).toBeInTheDocument();
  });

  it("names a page it cannot read and suggests the zip instead", async () => {
    api.overleafListProjects.mockRejectedValueOnce('@oleafly/error:{"code":"overleaf.unrecognized","params":{}}');
    render(<OverleafImportView onOpenProject={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Download the project as a .zip");
  });
});
