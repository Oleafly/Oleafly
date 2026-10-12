// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafSignOut: vi.fn(),
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
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
const shell = vi.hoisted(() => ({ open: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-shell", () => shell);

import { useOverleafImportStore } from "@/store/overleaf-import";
import { OverleafSection } from "./OverleafSection";

const SERVER = "https://www.overleaf.com";

beforeEach(() => {
  api.overleafStatus.mockReset();
  api.overleafSignOut.mockReset();
  useOverleafImportStore.setState({ server: SERVER, status: null, phase: "idle", error: null });
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
    expect(
      await screen.findByText("Not signed in. Oleafly asks you to sign in when you import projects."),
    ).toBeInTheDocument();
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
});
