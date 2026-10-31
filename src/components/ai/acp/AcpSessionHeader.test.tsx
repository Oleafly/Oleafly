import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { initTestI18n, installUiDom } = await import("./tests/ui-fixtures");
  await initTestI18n();
  return installUiDom();
});

vi.mock("@/lib/acp", async (original) => ({
  ...await original<typeof import("@/lib/acp")>(),
  acpFork: vi.fn(),
  acpLogout: vi.fn(),
  acpSessionRename: vi.fn(),
  acpSessionDelete: vi.fn(),
  acpSnapshot: vi.fn(),
  acpEvents: vi.fn(),
}));

import { acpEvents, acpFork, acpLogout, acpSessionDelete, acpSessionRename, acpSnapshot, type AcpSession } from "@/lib/acp";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { session } from "./tests/ui-fixtures";
import { AcpSessionHeader } from "./AcpSessionHeader";

function header(value: AcpSession, busy = false) {
  const perform = vi.fn((action: () => Promise<void>) => { void action().catch(() => {}); });
  render(<AcpSessionHeader projectId="paper" session={value} agentName="Codex" busy={busy} perform={perform} />);
  return perform;
}

async function openMenu(): Promise<HTMLElement> {
  fireEvent.pointerDown(screen.getByTestId("acp-session-menu"), { button: 0, ctrlKey: false, pointerType: "mouse" });
  return await waitFor(() => {
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    if (!menu) throw new Error("The menu did not open.");
    return menu;
  });
}

const capabilities = (extra: Partial<AcpSession["capabilities"]>) => ({ ...session("s").capabilities, ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  useAcpSessionsStore.setState({ sessions: { s: session("s") }, events: {}, activeByProject: { paper: "s" }, permissions: {}, elicitations: {} });
  vi.mocked(acpEvents).mockResolvedValue({ events: [], hasMore: false });
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(restore);

describe("AcpSessionHeader", () => {
  it("shows the revision the conversation started from", () => {
    header(session("s", { startRevision: "abc1234def5678", startDirty: true }));
    expect(screen.getByTestId("acp-start-revision")).toHaveTextContent("Started at abc1234 with uncommitted changes");
    cleanup();
    header(session("s", { startRevision: "abc1234def5678", startDirty: false }));
    expect(screen.getByTestId("acp-start-revision")).toHaveTextContent("Started at abc1234");
    cleanup();
    header(session("s"));
    expect(screen.queryByTestId("acp-start-revision")).toBeNull();
  });

  it("marks draft-protocol and remote conversations", () => {
    header(session("s", { capabilities: capabilities({ protocol: 2 }), remote: { host: "lab", folder: "/paper" } }));
    expect(screen.getByText("Protocol preview")).toBeInTheDocument();
    expect(screen.getByText("Remote")).toBeInTheDocument();
    cleanup();
    header(session("s", { title: "" }));
    expect(screen.getByTestId("acp-session-title")).toHaveTextContent("Untitled conversation");
    expect(screen.queryByText("Protocol preview")).toBeNull();
  });

  it("renames the conversation from its title", async () => {
    vi.mocked(acpSessionRename).mockResolvedValue(session("s", { title: "Introduction" }));
    header(session("s", { title: "Conversation s" }));
    fireEvent.click(screen.getByTestId("acp-session-title"));
    const input = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(input, { target: { value: "Introduction" } });
    fireEvent.blur(input);
    await waitFor(() => expect(acpSessionRename).toHaveBeenCalledWith("paper", "s", "Introduction"));
    await waitFor(() => expect(useAcpSessionsStore.getState().sessions.s).toMatchObject({ title: "Introduction", titleLocked: true }));
  });

  it("keeps the title when the edit is empty, unchanged or cancelled", () => {
    header(session("s", { title: "Conversation s" }));
    fireEvent.click(screen.getByTestId("acp-session-title"));
    fireEvent.blur(screen.getByRole("textbox", { name: "Conversation name" }));
    fireEvent.click(screen.getByTestId("acp-session-title"));
    const input = screen.getByRole("textbox", { name: "Conversation name" });
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByTestId("acp-session-title"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Conversation name" }), { key: "Escape" });
    expect(screen.getByTestId("acp-session-title")).toBeInTheDocument();
    expect(acpSessionRename).not.toHaveBeenCalled();
  });

  it("forks when the agent supports it", async () => {
    const forked = session("fork", { title: "Fork of s", forkedFrom: "s" });
    vi.mocked(acpFork).mockResolvedValue({ session: forked, permissions: [] });
    vi.mocked(acpSnapshot).mockResolvedValue({ session: forked, permissions: [] });
    header(session("s", { capabilities: capabilities({ fork: true }) }));
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Fork conversation/ }));
    await waitFor(() => expect(acpFork).toHaveBeenCalledWith("paper", "s"));
    await waitFor(() => expect(useAcpSessionsStore.getState().activeByProject.paper).toBe("fork"));
    expect(acpSnapshot).toHaveBeenCalledWith("paper", "fork");
    expect(useAcpSessionsStore.getState().sessions.fork).toMatchObject({ forkedFrom: "s" });
  });

  it("explains when forking is not possible", async () => {
    header(session("s"));
    let menu = await openMenu();
    let item = within(menu).getByRole("menuitem", { name: /Fork conversation/ });
    expect(item).toHaveTextContent("This agent cannot fork conversations.");
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    cleanup();
    header(session("s", { status: "running", capabilities: capabilities({ fork: true }) }));
    menu = await openMenu();
    item = within(menu).getByRole("menuitem", { name: /Fork conversation/ });
    expect(item).toHaveTextContent("Wait for the agent to finish before you fork.");
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    expect(acpFork).not.toHaveBeenCalled();
  });

  it("signs out of the agent when it can", async () => {
    vi.mocked(acpLogout).mockResolvedValue({ session: session("s", { status: "auth_required" }), permissions: [] });
    header(session("s", { capabilities: capabilities({ logout: true }) }));
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Sign out of Codex?")).toBeInTheDocument();
    expect(acpLogout).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(acpLogout).toHaveBeenCalledWith("paper", "s"));
    await waitFor(() => expect(useAcpSessionsStore.getState().sessions.s.status).toBe("auth_required"));
  });

  it("asks before signing out, names the account and leaves the agent signed in when cancelled", async () => {
    header(session("s", {
      capabilities: capabilities({ logout: true }),
      usage: { auth: { kind: "account", label: "Claude Max" } },
    }));
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sign out" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Signed in with Claude Max")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("terminal");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(acpLogout).not.toHaveBeenCalled();
  });

  it("offers no sign-out to agents without it", async () => {
    header(session("s"));
    const menu = await openMenu();
    expect(within(menu).queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });

  it("deletes the conversation after asking", async () => {
    vi.mocked(acpSessionDelete).mockResolvedValue({ agentDeleted: false, agentError: null });
    header(session("s", { capabilities: capabilities({ delete: true }) }));
    let menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Cancel/ }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("checkbox", { name: "Also delete it from Codex" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(acpSessionDelete).toHaveBeenCalledWith("paper", "s", false));
    await waitFor(() => expect(useAcpSessionsStore.getState().sessions.s).toBeUndefined());
  });
});
