// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabServer } from "@/lib/tauri";
import { account, check, collabError, device, fill, server, SERVER_ID, signedOutServer } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServersList: vi.fn(),
  collabServerSignIn: vi.fn(),
  collabServerSignOut: vi.fn(),
  collabServerRemove: vi.fn(),
  collabServerTest: vi.fn(),
  collabServerDevices: vi.fn(),
  collabServerSignOutDevice: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { ServerCard } from "./ServerCard";
import { useCollabStore } from "./store";

const copy = enCollab.section;

function Connected({ onSignIn, onManage }: Readonly<{ onSignIn: () => void; onManage: () => void }>) {
  const entry = useCollabStore((state) => state.servers[0]);
  return entry ? <ServerCard server={entry} defaultOpen onSignIn={onSignIn} onManage={onManage} /> : null;
}

function renderCard(entry: CollabServer = server()) {
  const onSignIn = vi.fn();
  const onManage = vi.fn();
  useCollabStore.setState({ servers: [entry], status: "ready", loadError: null, pending: {} });
  render(<Connected onSignIn={onSignIn} onManage={onManage} />);
  return { onSignIn, onManage };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabServerDevices.mockResolvedValue([]);
});

describe("ServerCard", () => {
  it("shows the server, its address, who is signed in and their devices", async () => {
    mocks.collabServerDevices.mockResolvedValue([device({ device_id: "d-1", current: true })]);
    renderCard();
    expect(screen.getByRole("heading", { name: "Smith Lab" })).toBeInTheDocument();
    expect(screen.getByText("https://collab.uni.edu")).toBeInTheDocument();
    expect(screen.getByText(copy.server.signedIn)).toBeInTheDocument();
    expect(screen.getByText(fill(copy.server.signedInAs, { name: "Alice Chen" }))).toBeInTheDocument();
    expect(screen.getByText("alice@uni.edu")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="avatar"]').length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByTestId("collab-device-d-1")).toBeInTheDocument();
    expect(mocks.collabServerDevices).toHaveBeenCalledWith(SERVER_ID);
  });

  it("signs out and then offers to sign in again", async () => {
    mocks.collabServerSignOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const { onSignIn } = renderCard();
    await user.click(screen.getByRole("button", { name: copy.server.signOut }));
    expect(mocks.collabServerSignOut).toHaveBeenCalledWith(SERVER_ID);
    expect(await screen.findByText(copy.server.signedOut)).toBeInTheDocument();
    expect(screen.getByText(copy.server.signedOutHint)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.server.signIn }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it("treats a server whose session ended as signed out even if it still names the account", () => {
    renderCard(server({ signed_in: false }));
    expect(screen.getByText(copy.server.signedOut)).toBeInTheDocument();
    expect(screen.queryByText(fill(copy.server.signedInAs, { name: "Alice Chen" }))).toBeNull();
    expect(mocks.collabServerDevices).not.toHaveBeenCalled();
  });

  it("says why sign-out failed and stays signed in", async () => {
    mocks.collabServerSignOut.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: copy.server.signOut }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(screen.getByText(copy.server.signedIn)).toBeInTheDocument();
  });

  it("asks before removing a server, and removes it", async () => {
    mocks.collabServerRemove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: copy.server.remove }));
    const dialog = screen.getByRole("alertdialog", { name: fill(copy.server.removeConfirm.title, { name: "Smith Lab" }) });
    expect(dialog).toHaveTextContent(copy.server.removeConfirm.description);
    await user.click(within(dialog).getByRole("button", { name: copy.server.removeConfirm.confirm }));
    expect(mocks.collabServerRemove).toHaveBeenCalledWith(SERVER_ID);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Smith Lab" })).toBeNull());
  });

  it("keeps the server when you change your mind", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: copy.server.remove }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: new RegExp(`^${enCommon.actions.cancel}`) }));
    expect(mocks.collabServerRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Smith Lab" })).toBeInTheDocument();
  });

  it("tests the connection and lists every check", async () => {
    mocks.collabServerTest.mockResolvedValue([check("reachable", "pass"), check("https", "fail", "certificate expired")]);
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: copy.server.test }));
    expect(mocks.collabServerTest).toHaveBeenCalledWith("https://collab.uni.edu");
    expect(await screen.findByRole("heading", { name: copy.checks.title })).toBeInTheDocument();
    expect(screen.getByText(copy.checks.items.https.fail)).toBeInTheDocument();
    expect(screen.getByText("certificate expired")).toBeInTheDocument();
  });

  it("shows progress while the test runs and explains a test that could not run", async () => {
    let finish: (error: unknown) => void = () => undefined;
    mocks.collabServerTest.mockReturnValue(
      new Promise((_resolve, reject) => {
        finish = reject;
      }),
    );
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByRole("button", { name: copy.server.test }));
    expect(screen.getByText(copy.checks.running)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.server.test })).toBeDisabled();
    finish(collabError("internal"));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.internal);
    expect(screen.getByRole("button", { name: copy.server.test })).toBeEnabled();
  });

  it("shows your role and offers Manage server to admins and maintainers only", async () => {
    const user = userEvent.setup();
    const cases = [
      ["admin", true],
      ["maintainer", true],
      ["member", false],
      ["guest", false],
    ] as const;
    for (const [role, offered] of cases) {
      const { onManage } = renderCard(server({ account: account({ server_role: role }) }));
      expect(screen.getByText(fill(copy.server.role, { role: enCollab.roles[role] }))).toBeInTheDocument();
      const manage = screen.queryByRole("button", { name: copy.server.manage });
      expect(manage !== null, role).toBe(offered);
      if (manage) {
        await user.click(manage);
        expect(onManage).toHaveBeenCalled();
      }
      cleanup();
    }
    renderCard(signedOutServer());
    expect(screen.queryByRole("button", { name: copy.server.manage })).toBeNull();
  });
});
