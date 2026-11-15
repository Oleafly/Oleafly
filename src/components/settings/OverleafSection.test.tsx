// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafSignOut: vi.fn(),
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
import { OverleafSection } from "./OverleafSection";

const SERVER = "https://www.overleaf.com";

beforeEach(() => {
  api.overleafStatus.mockReset();
  api.overleafSignOut.mockReset();
  api.overleafSignInWithAppCookies.mockReset();
  api.overleafSignInBrowsers.mockReset().mockResolvedValue([]);
  api.overleafSignInWithBrowser.mockReset();
  api.overleafListProjects.mockReset();
  localStorage.clear();
  cookies.detectBrowserCookieSources.mockReset().mockResolvedValue([]);
  cookies.importBrowserCookies.mockReset();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.scrollIntoView = vi.fn();
  useOverleafImportStore.setState({ server: SERVER, status: null, phase: "idle", signingWith: null, error: null });
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

  it("saves, replaces and removes the Git token for sync", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    git.overleafGitTokenStatus.mockResolvedValueOnce(false);
    render(<OverleafSection />);
    expect(await screen.findByText(/No Git token yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("overleaf-git-token-input"), { target: { value: "  olp_token_value  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(git.overleafGitTokenSet).toHaveBeenCalledWith(SERVER, "olp_token_value"));
    expect(await screen.findByText(/A Git token is saved/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("overleaf-git-token-clear"));
    await waitFor(() => expect(git.overleafGitTokenClear).toHaveBeenCalledWith(SERVER));
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
});
