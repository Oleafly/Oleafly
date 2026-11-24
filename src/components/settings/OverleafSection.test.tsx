// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafSignOut: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafUseAccount: vi.fn(),
  overleafSignInWithAppCookies: vi.fn(),
  overleafSignInBrowsers: vi.fn(async () => [] as unknown[]),
  overleafSignInWithBrowser: vi.fn(),
  overleafListProjects: vi.fn(),
}));
const cookies = vi.hoisted(() => ({
  detectBrowserCookieSources: vi.fn(async () => [] as unknown[]),
  importBrowserCookies: vi.fn(),
}));
const git = vi.hoisted(() => ({
  overleafGitTokenStatus: vi.fn(async () => false),
  overleafGitTokenSet: vi.fn(async () => undefined),
  overleafGitTokenClear: vi.fn(async () => undefined),
}));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/overleaf-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-sync")>()),
  ...git,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...cookies,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
const shell = vi.hoisted(() => ({ open: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => shell);

import { useOverleafImportStore } from "@/store/overleaf-import";
import { useSettingsStore } from "@/store/settings";
import { OverleafSection } from "./OverleafSection";

const SERVER = "https://www.overleaf.com";

beforeEach(() => {
  api.overleafStatus.mockReset();
  api.overleafSignOut.mockReset();
  api.overleafSignIn.mockReset();
  api.overleafUseAccount.mockReset();
  git.overleafGitTokenStatus.mockClear();
  api.overleafSignInWithAppCookies.mockReset();
  api.overleafSignInBrowsers.mockReset().mockResolvedValue([]);
  api.overleafSignInWithBrowser.mockReset();
  api.overleafListProjects.mockReset();
  localStorage.clear();
  cookies.detectBrowserCookieSources.mockReset().mockResolvedValue([]);
  cookies.importBrowserCookies.mockReset();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  useOverleafImportStore.setState({
    server: SERVER,
    status: null,
    unsent: null,
    unsentAccount: null,
    phase: "idle",
    signingWith: null,
    error: null,
  });
});

describe("OverleafSection", () => {
  it("shows the signed-in account and signs out", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    api.overleafSignOut.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafSection />);
    expect(await screen.findByTestId("overleaf-connected")).toHaveTextContent(
      "Signed in as ada@uni.edu on www.overleaf.com",
    );
    fireEvent.click(screen.getByTestId("overleaf-settings-sign-out"));
    await waitFor(() => expect(screen.queryByTestId("overleaf-connected")).not.toBeInTheDocument());
    expect(screen.queryByText(/Not signed in/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a row per account, picks the one for imports and signs out of one", async () => {
    const ada = { userId: "u-ada", email: "ada@uni.edu" };
    const bea = { userId: "u-bea", email: "bea@lab.org" };
    const both = { server: SERVER, signedIn: true, email: bea.email, userId: bea.userId, accounts: [bea, ada] };
    api.overleafStatus.mockResolvedValue(both);
    api.overleafUseAccount.mockResolvedValue({ ...both, email: ada.email, userId: ada.userId, accounts: [ada, bea] });
    api.overleafSignOut.mockResolvedValue({ server: SERVER, signedIn: true, email: ada.email, userId: ada.userId, accounts: [ada] });
    const user = userEvent.setup();
    render(<OverleafSection />);
    await waitFor(() => expect(screen.getAllByTestId("overleaf-connected")).toHaveLength(2));
    const rows = screen.getAllByTestId("overleaf-account");
    expect(rows[0]).toHaveTextContent("Signed in as bea@lab.org on www.overleaf.com");
    expect(rows[1]).toHaveTextContent("Signed in as ada@uni.edu on www.overleaf.com");
    expect(await screen.findByText("Git token for bea@lab.org")).toBeInTheDocument();
    expect(git.overleafGitTokenStatus).toHaveBeenLastCalledWith(SERVER, "u-bea");
    const picker = screen.getByTestId("overleaf-account-picker");
    expect(within(picker).getByRole("combobox", { name: "Account for importing" })).toHaveTextContent("bea@lab.org");
    await user.click(within(picker).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "ada@uni.edu" }));
    expect(api.overleafUseAccount).toHaveBeenCalledWith(SERVER, "u-ada");
    expect(await screen.findByText("Git token for ada@uni.edu")).toBeInTheDocument();
    await waitFor(() => expect(git.overleafGitTokenStatus).toHaveBeenLastCalledWith(SERVER, "u-ada"));
    const beaRow = screen.getAllByTestId("overleaf-account")[1];
    expect(beaRow).toHaveTextContent("bea@lab.org");
    await user.click(within(beaRow).getByTestId("overleaf-settings-sign-out"));
    expect(api.overleafSignOut).toHaveBeenCalledWith(SERVER, false, "u-bea");
    await waitFor(() => expect(screen.getAllByTestId("overleaf-connected")).toHaveLength(1));
    expect(screen.getByTestId("overleaf-connected")).toHaveTextContent("ada@uni.edu");
    expect(screen.queryByTestId("overleaf-account-picker")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("adds another account through a fresh sign-in window and says what a browser sign-in uses", async () => {
    const ada = { userId: "u-ada", email: "ada@uni.edu" };
    const bea = { userId: "u-bea", email: "bea@lab.org" };
    const one = { server: SERVER, signedIn: true, email: ada.email, userId: ada.userId, accounts: [ada] };
    const two = { server: SERVER, signedIn: true, email: bea.email, userId: bea.userId, accounts: [bea, ada] };
    api.overleafStatus.mockResolvedValue(one);
    api.overleafSignIn.mockResolvedValue(two);
    api.overleafListProjects.mockResolvedValue({ status: two, projects: [] });
    const user = userEvent.setup();
    render(<OverleafSection />);
    await screen.findByTestId("overleaf-connected");
    expect(screen.queryByTestId("window-sign-in-row")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("overleaf-add-account"));
    const options = screen.getByTestId("overleaf-add-account-options");
    expect(options).toHaveTextContent("uses the account that browser is signed in to");
    await user.click(within(options).getByTestId("window-sign-in"));
    expect(api.overleafSignIn).toHaveBeenCalledWith(SERVER, expect.any(String));
    await waitFor(() => expect(screen.getAllByTestId("overleaf-connected")).toHaveLength(2));
    expect(screen.queryByTestId("overleaf-add-account-options")).not.toBeInTheDocument();
    expect(screen.getByTestId("overleaf-add-account")).toBeInTheDocument();
  });

  it("names the server when the account has no email and reports a failed sign-out", async () => {
    api.overleafStatus.mockResolvedValue({ server: "https://latex.uni.edu", signedIn: true, email: null });
    api.overleafSignOut.mockRejectedValue(new Error("locked"));
    render(<OverleafSection />);
    expect(await screen.findByTestId("overleaf-connected")).toHaveTextContent("Signed in on latex.uni.edu");
    fireEvent.click(screen.getByTestId("overleaf-settings-sign-out"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Oleafly could not sign out of Overleaf."),
    );
  });

  it("asks before signing out with unsent changes, then signs out and keeps them", async () => {
    const thesis = { project_id: "p1", name: "Thesis", changes: 2, paths: ["main.tex", "intro.tex"] };
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    api.overleafSignOut
      .mockResolvedValueOnce({ server: SERVER, signedIn: true, email: "ada@uni.edu", unsent: [thesis] })
      .mockResolvedValueOnce({ server: SERVER, signedIn: false, email: null, unsent: [thesis] });
    render(<OverleafSection />);
    await screen.findByTestId("overleaf-connected");
    fireEvent.click(screen.getByTestId("overleaf-settings-sign-out"));
    const question = await screen.findByRole("alertdialog");
    expect(question).toHaveTextContent("Some changes haven't been sent to Overleaf");
    expect(within(question).getByTestId("overleaf-unsent-projects")).toHaveTextContent(
      "ThesisNot sent yet: main.tex, intro.tex",
    );
    expect(screen.getByTestId("overleaf-connected")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(within(question).getByRole("button", { name: /^Sign out anyway/ }));
    await waitFor(() => expect(screen.queryByTestId("overleaf-connected")).not.toBeInTheDocument());
    expect(api.overleafSignOut.mock.calls).toEqual([
      [SERVER, false, null],
      [SERVER, true, null],
    ]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("stays signed in when asked about unsent changes", async () => {
    const thesis = { project_id: "p1", name: "Thesis", changes: 1, paths: ["main.tex"] };
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    api.overleafSignOut.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu", unsent: [thesis] });
    render(<OverleafSection />);
    await screen.findByTestId("overleaf-connected");
    fireEvent.click(screen.getByTestId("overleaf-settings-sign-out"));
    const question = await screen.findByRole("alertdialog");
    await userEvent.click(within(question).getByRole("button", { name: /^Stay signed in/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("overleaf-connected")).toBeInTheDocument();
    expect(api.overleafSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves, replaces and removes the Git token for sync", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    git.overleafGitTokenStatus.mockResolvedValueOnce(false);
    render(<OverleafSection />);
    expect(await screen.findByText(/No Git token yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("overleaf-git-token-input"), { target: { value: "  olp_token_value  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(git.overleafGitTokenSet).toHaveBeenCalledWith(SERVER, "olp_token_value", null));
    expect(await screen.findByText(/A Git token is saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-git-token-clear"));
    await waitFor(() => expect(git.overleafGitTokenClear).toHaveBeenCalledWith(SERVER, null));
    expect(await screen.findByText(/No Git token yet/)).toBeInTheDocument();
    git.overleafGitTokenSet.mockRejectedValueOnce(new Error("io"));
    fireEvent.change(screen.getByTestId("overleaf-git-token-input"), { target: { value: "olp_other" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Oleafly could not save the Git token. Check that you pasted the whole token.")).toBeInTheDocument();
  });

  it("links to the Overleaf page that makes Git tokens and names the plan it needs", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafSection />);
    const link = await screen.findByTestId("overleaf-git-token-page");
    expect(link).toHaveTextContent("Open Overleaf account settings");
    expect(screen.getByText("Git integration needs a paid or university Overleaf plan for the project's owner.")).toBeInTheDocument();
    fireEvent.click(link);
    expect(shell.open).toHaveBeenCalledWith("https://www.overleaf.com/user/settings");
  });

  it("offers the browser sign-in copy while signed out and refreshes after it signs in", async () => {
    api.overleafStatus
      .mockResolvedValueOnce({ server: SERVER, signedIn: false, email: null })
      .mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    cookies.detectBrowserCookieSources.mockResolvedValue([
      { browser: "chrome", browserName: "Google Chrome", profile: "Default", profileName: "Default", status: "available", detail: "Ready" },
    ]);
    cookies.importBrowserCookies.mockResolvedValue({ imported: 2, browserName: "Google Chrome", profileName: "Default", domain: "www.overleaf.com" });
    api.overleafSignInWithAppCookies.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    const user = userEvent.setup();
    render(<OverleafSection />);
    expect(await screen.findByTestId("browser-sign-in-copy-row")).toBeInTheDocument();
    await user.click(screen.getByTestId("browser-sign-in-copy"));
    await user.click(await screen.findByLabelText(/Google Chrome/));
    await user.click(screen.getByRole("button", { name: "Review import" }));
    await user.click(screen.getByRole("button", { name: "Copy sign-in" }));
    await waitFor(() =>
      expect(cookies.importBrowserCookies).toHaveBeenCalledWith({ browser: "chrome", profile: "Default", domain: "www.overleaf.com" }),
    );
    expect(await screen.findByTestId("overleaf-connected")).toHaveTextContent("Signed in as ada@uni.edu");
    expect(screen.queryByTestId("browser-sign-in-copy-row")).not.toBeInTheDocument();
  });

  it("hides the browser sign-in copy while signed in", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    cookies.detectBrowserCookieSources.mockResolvedValue([
      { browser: "chrome", browserName: "Google Chrome", profile: "Default", profileName: "Default", status: "available", detail: "Ready" },
    ]);
    render(<OverleafSection />);
    expect(await screen.findByTestId("overleaf-connected")).toBeInTheDocument();
    expect(screen.queryByTestId("browser-sign-in-copy-row")).not.toBeInTheDocument();
  });

  it("signs in with an installed browser while signed out and shows the account", async () => {
    const signedIn = { server: SERVER, signedIn: true, email: "ada@uni.edu" };
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    api.overleafSignInBrowsers.mockResolvedValue([{ key: "edge", name: "Microsoft Edge" }]);
    api.overleafSignInWithBrowser.mockResolvedValue(signedIn);
    api.overleafListProjects.mockResolvedValue({ status: signedIn, projects: [] });
    const user = userEvent.setup();
    render(<OverleafSection />);
    const row = await screen.findByTestId("browser-sign-in-row");
    await user.click(within(row).getByRole("button", { name: "Sign in" }));
    expect(api.overleafSignInWithBrowser).toHaveBeenCalledWith(SERVER, "edge");
    expect(await screen.findByTestId("overleaf-connected")).toHaveTextContent("Signed in as ada@uni.edu on www.overleaf.com");
    expect(screen.queryByTestId("browser-sign-in-row")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-change-server")).not.toBeInTheDocument();
  });

  it("changes the server from Settings and checks the sign-in there", async () => {
    const custom = "https://latex.uni.edu";
    api.overleafStatus.mockImplementation(async (server: string) => ({ server, signedIn: false, email: null }));
    api.overleafSignInBrowsers.mockResolvedValue([{ key: "chrome", name: "Google Chrome" }]);
    render(<OverleafSection />);
    expect(await screen.findByText("Server: www.overleaf.com")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-change-server"));
    fireEvent.change(screen.getByTestId("overleaf-server-input"), { target: { value: custom } });
    fireEvent.click(screen.getByRole("button", { name: "Use this server" }));
    await waitFor(() => expect(api.overleafStatus).toHaveBeenLastCalledWith(custom));
    expect(await screen.findByText("Server: latex.uni.edu")).toBeInTheDocument();
    expect(await screen.findByTestId("browser-sign-in-row")).toHaveTextContent("Oleafly opens latex.uni.edu");
    expect(localStorage.getItem("oleafly.overleaf.server")).toBe(custom);
    fireEvent.click(screen.getByRole("button", { name: "Use overleaf.com" }));
    expect(await screen.findByText("Server: www.overleaf.com")).toBeInTheDocument();
    await waitFor(() => expect(api.overleafStatus).toHaveBeenLastCalledWith(SERVER));
  });

  it("offers the delete choice for live projects only, asking by default", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    useSettingsStore.setState({ overleafLive: false, overleafDeletes: "ask" });
    const { rerender } = render(<OverleafSection />);
    await screen.findByTestId("overleaf-connected");
    expect(screen.queryByTestId("overleaf-live-deletes")).not.toBeInTheDocument();
    useSettingsStore.setState({ overleafLive: true });
    rerender(<OverleafSection />);
    const field = screen.getByTestId("overleaf-live-deletes");
    expect(field).toHaveTextContent("When you delete a file in a live project");
    expect(within(field).getByRole("combobox", { name: "When you delete a file in a live project" })).toHaveTextContent(
      "Ask each time",
    );
    const user = userEvent.setup();
    await user.click(within(field).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Keep it on Overleaf" }));
    expect(useSettingsStore.getState().overleafDeletes).toBe("never");
    expect(localStorage.getItem("oleafly.overleafDeletes")).toBe("never");
  });
});
