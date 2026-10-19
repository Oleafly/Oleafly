import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

const mocks = vi.hoisted(() => ({ setSnapshot: vi.fn(), openTerminalWith: vi.fn() }));

vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpAuthenticate: vi.fn(),
  acpSignInCommand: vi.fn(),
  acpDisconnect: vi.fn(),
  acpReconnect: vi.fn(),
}));
vi.mock("@/lib/terminal-launch", () => {
  class TerminalLaunchError extends Error {
    constructor(readonly reason: string) {
      super(reason === "invalid" ? "This command can't run in the terminal." : reason);
      this.name = "TerminalLaunchError";
    }
  }
  return { TerminalLaunchError, openTerminalWith: mocks.openTerminalWith };
});
vi.mock("@/store/acp-sessions", () => ({
  useAcpSessionsStore: { getState: () => ({ setSnapshot: mocks.setSnapshot }) },
}));

import { acpAuthenticate, acpDisconnect, acpReconnect, acpSignInCommand, type AcpAuthMethod, type AcpSession } from "@/lib/acp";
import { TerminalLaunchError } from "@/lib/terminal-launch";
import { agent, session } from "./tests/ui-fixtures";
import { AcpSignIn } from "./AcpSignIn";

const terminalMethod: AcpAuthMethod = {
  id: "claude-login", name: "Claude login", description: null, kind: "terminal",
  terminalCommand: { command: "claude", args: ["/login"], label: "Claude Code" },
};
const keyMethod: AcpAuthMethod = { id: "api-key", name: "Use an API key", description: null, apiKeyProvider: "Anthropic" };
const oauthMethod: AcpAuthMethod = { id: "oauth", name: "Sign in with the browser", description: null };

function signIn(methods: AcpAuthMethod[], overrides: Partial<AcpSession> = {}, withAgent = true) {
  const perform = vi.fn((action: () => Promise<void>) => { void action().catch(() => {}); });
  const value = session("s", { status: "auth_required", authMethods: methods, ...overrides });
  render(<AcpSignIn projectId="paper" session={value} agent={withAgent ? agent() : undefined} busy={false} perform={perform} />);
  return perform;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(acpSignInCommand).mockResolvedValue({ title: "Sign in to Claude Code", program: "/usr/local/bin/claude", args: ["/login"], env: { CLAUDE_CONFIG_DIR: "/cfg" } });
  vi.mocked(acpAuthenticate).mockResolvedValue({ session: session("s"), permissions: [] });
  vi.mocked(acpReconnect).mockResolvedValue({ session: session("s"), permissions: [] });
  vi.mocked(acpDisconnect).mockResolvedValue();
  mocks.openTerminalWith.mockResolvedValue({ terminalId: "t1" });
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("AcpSignIn", () => {
  it("opens the terminal with the agent's sign-in command", async () => {
    signIn([terminalMethod]);
    expect(screen.getByText("Run research-fixture login")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Claude Code in the terminal" }));
    await waitFor(() => expect(mocks.openTerminalWith).toHaveBeenCalledWith({
      title: "Sign in to Claude Code", command: "/usr/local/bin/claude", args: ["/login"], env: { CLAUDE_CONFIG_DIR: "/cfg" },
    }));
    expect(acpSignInCommand).toHaveBeenCalledWith("paper", "fixture", "s", "claude-login");
    expect(await screen.findByText("Finish signing in in the terminal, then reconnect.")).toBeInTheDocument();
  });

  it("names a terminal method without a label by its own name", () => {
    signIn([{ ...terminalMethod, terminalCommand: null }]);
    expect(screen.getByRole("button", { name: "Claude login in the terminal" })).toBeInTheDocument();
  });

  it("explains why the terminal did not open", async () => {
    mocks.openTerminalWith.mockRejectedValueOnce(new TerminalLaunchError("no-project"));
    signIn([terminalMethod]);
    const button = screen.getByRole("button", { name: "Claude Code in the terminal" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Open a project to sign in from the terminal.");
    mocks.openTerminalWith.mockRejectedValueOnce(new TerminalLaunchError("invalid"));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This command can't run in the terminal."));
    mocks.openTerminalWith.mockRejectedValueOnce(new Error("The shell could not start."));
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The shell could not start."));
    mocks.openTerminalWith.mockRejectedValueOnce("plain failure");
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("plain failure"));
  });

  it("leaves the tab-limit message to the launcher", async () => {
    mocks.openTerminalWith.mockRejectedValueOnce(new TerminalLaunchError("tab-limit"));
    signIn([terminalMethod]);
    fireEvent.click(screen.getByRole("button", { name: "Claude Code in the terminal" }));
    await waitFor(() => expect(mocks.openTerminalWith).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Finish signing in in the terminal, then reconnect.")).toBeNull();
  });

  it("sends an API key once and clears the field", async () => {
    const perform = signIn([keyMethod]);
    const input = screen.getByLabelText("API key for Anthropic") as HTMLInputElement;
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    fireEvent.click(screen.getByRole("button", { name: "Use an API key" }));
    expect(perform).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "  sk-123  " } });
    fireEvent.click(screen.getByRole("button", { name: "Use an API key" }));
    await waitFor(() => expect(acpAuthenticate).toHaveBeenCalledWith("paper", "s", "api-key", "sk-123"));
    expect(acpAuthenticate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(input.value).toBe(""));
    expect(mocks.setSnapshot).toHaveBeenCalledWith({ session: session("s"), permissions: [] });
  });

  it("clears the key even when the agent rejects it", async () => {
    vi.mocked(acpAuthenticate).mockRejectedValueOnce(new Error("Invalid key"));
    signIn([keyMethod]);
    const input = screen.getByLabelText("API key for Anthropic") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-bad" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(acpAuthenticate).toHaveBeenCalled());
    await waitFor(() => expect(input.value).toBe(""));
    expect(mocks.setSnapshot).not.toHaveBeenCalled();
  });

  it("shows the Google sign-in note for Gemini", () => {
    signIn([oauthMethod], { agentId: "gemini" });
    expect(screen.getByText("Signing in with Google no longer works for individual plans. Use a Gemini API key or Vertex AI.")).toBeInTheDocument();
    cleanup();
    signIn([oauthMethod]);
    expect(screen.queryByText(/Signing in with Google/)).toBeNull();
  });

  it("uses the agent's own sign-in flow and reconnects afterwards", async () => {
    signIn([oauthMethod], {}, false);
    expect(screen.getByText("Sign in using this agent's CLI, then reconnect.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with the browser" }));
    await waitFor(() => expect(acpAuthenticate).toHaveBeenCalledWith("paper", "s", "oauth"));
    fireEvent.click(screen.getByRole("button", { name: "Reconnect after sign-in" }));
    await waitFor(() => expect(acpReconnect).toHaveBeenCalledWith("paper", "s"));
    expect(acpDisconnect).toHaveBeenCalledWith("paper", "s");
    expect(mocks.setSnapshot).toHaveBeenCalledTimes(2);
  });
});
