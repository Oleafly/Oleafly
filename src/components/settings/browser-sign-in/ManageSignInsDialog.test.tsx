// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafSignIns: vi.fn(),
  overleafSignOut: vi.fn(),
  overleafUseAccount: vi.fn(),
  overleafListProjects: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => ({ logError }));

import { useOverleafImportStore } from "@/store/overleaf-import";
import { OverleafSignOutQuestion } from "@/components/library/overleaf/OverleafSignOutQuestion";
import { ManageSignInsDialog } from "./ManageSignInsDialog";

const HERE = "https://www.overleaf.com";
const LAB = "https://latex.lab.org";
const ada = { userId: "u-ada", email: "ada@uni.edu" };
const bea = { userId: "u-bea", email: "bea@lab.org" };
const signedOut = (server: string) => ({ server, signedIn: false, email: null, userId: null, accounts: [] });

function row(server: string, account: { userId: string; email: string | null }, current: boolean, signedInAt: number | null = null) {
  return { server, ...account, current, signedInAt };
}

function show(props: Partial<Parameters<typeof ManageSignInsDialog>[0]> = {}) {
  const spies = { onOpenChange: vi.fn(), onAdd: vi.fn(), onSwitched: vi.fn() };
  render(
    <>
      <ManageSignInsDialog open addLabel="Import more" {...spies} {...props} />
      <OverleafSignOutQuestion />
    </>,
  );
  return spies;
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  logError.mockClear();
  useOverleafImportStore.setState({
    server: HERE,
    status: { server: HERE, signedIn: true, email: ada.email, userId: ada.userId, accounts: [ada] },
    unsent: null,
    unsentAccount: null,
    unsentServer: null,
    phase: "ready",
    importing: false,
    error: null,
  });
});

describe("ManageSignInsDialog", () => {
  it("lists every account with its site and time, and marks the one in use", async () => {
    const now = Math.floor(Date.now() / 1000);
    api.overleafSignIns.mockResolvedValue([
      row(LAB, bea, true, now - 120),
      row(HERE, ada, true, now),
      row(HERE, { userId: "u-cy", email: null }, false, null),
    ]);
    const { onAdd, onOpenChange } = show();
    const rows = await screen.findAllByTestId("saved-sign-in");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("bea@lab.org");
    expect(rows[0]).toHaveTextContent("latex.lab.org · 2 minutes ago");
    expect(within(rows[0]).getByRole("button", { name: "Switch to bea@lab.org" })).toBeEnabled();
    expect(rows[1]).toHaveTextContent("www.overleaf.com · now");
    expect(rows[1]).toHaveTextContent("In use");
    expect(within(rows[1]).queryByRole("button", { name: /Switch/ })).toBeNull();
    expect(rows[2]).toHaveTextContent("u-cy");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Import more" }));
    expect(onAdd).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("removes an account on another server without touching the one in use", async () => {
    api.overleafSignIns
      .mockResolvedValueOnce([row(HERE, ada, true), row(LAB, bea, true)])
      .mockResolvedValue([row(HERE, ada, true)]);
    api.overleafSignOut.mockResolvedValue(signedOut(LAB));
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove bea@lab.org" }));
    await waitFor(() => expect(screen.getAllByTestId("saved-sign-in")).toHaveLength(1));
    expect(api.overleafSignOut).toHaveBeenCalledExactlyOnceWith(LAB, false, "u-bea");
    expect(useOverleafImportStore.getState()).toMatchObject({ phase: "ready", status: { userId: "u-ada" } });
    expect(screen.queryByRole("button", { name: "Remove all" })).toBeNull();
  });

  it("removes them all, one after another", async () => {
    api.overleafSignIns
      .mockResolvedValueOnce([row(HERE, ada, true), row(LAB, bea, true)])
      .mockResolvedValue([]);
    api.overleafSignOut.mockImplementation(async (server: string) => signedOut(server));
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove all" }));
    expect(await screen.findByText("You aren't signed in to any account.")).toBeVisible();
    expect(api.overleafSignOut.mock.calls).toEqual([
      [HERE, false, "u-ada"],
      [LAB, false, "u-bea"],
    ]);
    expect(useOverleafImportStore.getState().phase).toBe("signed-out");
  });

  it("stops at the first account with unsent changes and asks, on that account's server", async () => {
    api.overleafSignIns
      .mockResolvedValueOnce([row(LAB, bea, true), row(HERE, ada, true)])
      .mockResolvedValue([row(HERE, ada, true)]);
    api.overleafSignOut.mockResolvedValueOnce({
      ...signedOut(LAB),
      signedIn: true,
      unsent: [{ project_id: "p1", name: "Thesis", paths: ["main.tex"] }],
    });
    api.overleafSignOut.mockResolvedValue(signedOut(LAB));
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Remove all" }));
    const question = await screen.findByRole("alertdialog");
    expect(question).toHaveTextContent("Thesis");
    expect(api.overleafSignOut).toHaveBeenCalledTimes(1);
    expect(useOverleafImportStore.getState().status?.userId).toBe("u-ada");
    await user.click(within(question).getByText("Sign out anyway"));
    expect(api.overleafSignOut).toHaveBeenLastCalledWith(LAB, true, "u-bea");
    await waitFor(() => expect(screen.getAllByTestId("saved-sign-in")).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("switches accounts and closes", async () => {
    const both = { server: HERE, signedIn: true, email: bea.email, userId: bea.userId, accounts: [bea, ada] };
    api.overleafSignIns.mockResolvedValue([row(HERE, ada, true), row(HERE, bea, false)]);
    api.overleafUseAccount.mockResolvedValue(both);
    api.overleafListProjects.mockResolvedValue({ status: both, projects: [] });
    const { onOpenChange, onSwitched } = show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Switch to bea@lab.org" }));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledOnce());
    expect(api.overleafUseAccount).toHaveBeenCalledWith(HERE, "u-bea");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open and says so when a change or the list fails", async () => {
    api.overleafSignIns.mockResolvedValue([row(HERE, ada, true), row(HERE, bea, false)]);
    api.overleafUseAccount.mockRejectedValue(new Error("no"));
    const { onOpenChange } = show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Switch to bea@lab.org" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Oleafly couldn't change this sign-in. Try again.");
    expect(onOpenChange).not.toHaveBeenCalled();
    api.overleafSignIns.mockRejectedValue(new Error("locked"));
    api.overleafSignOut.mockResolvedValue({ ...signedOut(HERE), signedIn: true, userId: "u-ada", accounts: [ada] });
    await user.click(screen.getByRole("button", { name: "Remove bea@lab.org" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Oleafly couldn't load your sign-ins."));
    expect(logError).toHaveBeenCalledWith("list Overleaf sign-ins", expect.any(Error));
  });
});
