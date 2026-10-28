// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDate } from "@/lib/intl";
import { DevicesList } from "./DevicesList";
import { collabError, deferred, device, fill } from "./tests/fixtures";

const devices = enCollab.section.devices;
const members = enCollab.admin.members;
const laptop = device({ device_id: "d-1", name: "Alice's MacBook", platform: "macos", current: true });
const desktop = device({ device_id: "d-2", name: "Lab desktop", platform: "linux", last_seen_at: null });
const load = vi.fn();
const signOut = vi.fn();

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DevicesList", () => {
  it("lists your devices and marks this computer", async () => {
    load.mockResolvedValue([laptop, desktop]);
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    expect(screen.getByRole("heading", { name: devices.title })).toBeInTheDocument();
    const mine = await screen.findByTestId("collab-device-d-1");
    expect(load).toHaveBeenCalledTimes(1);
    expect(mine).toHaveTextContent("Alice's MacBook");
    expect(mine).toHaveTextContent("macOS");
    expect(mine).toHaveTextContent(devices.current);
    expect(within(mine).queryByRole("button")).toBeNull();
    const other = screen.getByTestId("collab-device-d-2");
    expect(other).toHaveTextContent("Linux");
    expect(other).toHaveTextContent(fill(devices.added, { date: formatDate(desktop.created_at) }));
    expect(other).toHaveTextContent(devices.neverSeen);
  });

  it("signs another device out after asking", async () => {
    load.mockResolvedValue([laptop, desktop]);
    signOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    await user.click(await screen.findByRole("button", { name: fill(devices.signOutNamed, { name: "Lab desktop" }) }));
    const dialog = screen.getByRole("alertdialog", { name: fill(devices.signOutConfirm.title, { name: "Lab desktop" }) });
    await user.click(within(dialog).getByRole("button", { name: devices.signOutConfirm.confirm }));
    expect(signOut).toHaveBeenCalledWith("d-2");
    await waitFor(() => expect(screen.queryByTestId("collab-device-d-2")).toBeNull());
    expect(screen.getByTestId("collab-device-d-1")).toBeInTheDocument();
  });

  it("keeps a device busy until its own sign-out ends, whatever another device does", async () => {
    const tablet = device({ device_id: "d-3", name: "Lab tablet", platform: "linux" });
    const forDesktop = deferred<undefined>();
    const forTablet = deferred<undefined>();
    load.mockResolvedValue([laptop, desktop, tablet]);
    signOut.mockImplementation((id: string) => (id === "d-2" ? forDesktop.promise : forTablet.promise));
    const user = userEvent.setup();
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    for (const name of ["Lab desktop", "Lab tablet"]) {
      await user.click(await screen.findByRole("button", { name: fill(devices.signOutNamed, { name }) }));
      await user.click(screen.getByRole("button", { name: devices.signOutConfirm.confirm }));
    }
    await act(async () => forDesktop.resolve(undefined));
    await waitFor(() => expect(screen.queryByTestId("collab-device-d-2")).toBeNull());
    expect(screen.getByRole("button", { name: fill(devices.signOutNamed, { name: "Lab tablet" }) })).toBeDisabled();
    expect(signOut).toHaveBeenCalledTimes(2);
    await act(async () => forTablet.resolve(undefined));
    await waitFor(() => expect(screen.queryByTestId("collab-device-d-3")).toBeNull());
  });

  it("says why a device could not be signed out", async () => {
    load.mockResolvedValue([laptop, desktop]);
    signOut.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    await user.click(await screen.findByRole("button", { name: fill(devices.signOutNamed, { name: "Lab desktop" }) }));
    await user.click(screen.getByRole("button", { name: devices.signOutConfirm.confirm }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(screen.getByTestId("collab-device-d-2")).toBeInTheDocument();
  });

  it("explains a failed load and tries again", async () => {
    load.mockRejectedValueOnce(collabError("unauthorized")).mockResolvedValueOnce([laptop]);
    const user = userEvent.setup();
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    expect(await screen.findByText(devices.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.unauthorized)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByTestId("collab-device-d-1")).toBeInTheDocument();
  });

  it("uses the member wording for an admin looking at someone else's devices", async () => {
    load.mockResolvedValue([device({ device_id: "d-9", name: "Bob's laptop" })]);
    signOut.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DevicesList variant="member" ownerName="Bob Smith" load={load} signOut={signOut} />);
    expect(screen.getByRole("heading", { name: fill(members.devicesTitle, { name: "Bob Smith" }) })).toBeInTheDocument();
    expect(screen.getByText(members.devicesLoading)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: fill(devices.signOutNamed, { name: "Bob's laptop" }) }));
    const dialog = screen.getByRole("alertdialog", {
      name: fill(members.deviceSignOutConfirm.title, { name: "Bob's laptop" }),
    });
    expect(dialog).toHaveTextContent(members.deviceSignOutConfirm.description);
    await user.click(within(dialog).getByRole("button", { name: members.deviceSignOutConfirm.confirm }));
    expect(signOut).toHaveBeenCalledWith("d-9");
    expect(await screen.findByText(devices.empty)).toBeInTheDocument();
  });

  it("uses the member wording when someone else's devices cannot be loaded", async () => {
    load.mockRejectedValueOnce(collabError("forbidden"));
    render(<DevicesList variant="member" ownerName="Bob Smith" load={load} signOut={signOut} />);
    expect(await screen.findByText(members.devicesLoadFailed)).toBeInTheDocument();
    expect(screen.queryByText(devices.loadFailed)).toBeNull();
    expect(screen.getByText(enCollab.errors.forbidden)).toBeInTheDocument();
  });

  it("shows a platform this version does not know as the server wrote it", async () => {
    load.mockResolvedValue([device({ device_id: "d-5", name: "Lab server", platform: "freebsd" })]);
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    expect(await screen.findByTestId("collab-device-d-5")).toHaveTextContent("freebsd");
  });

  it("names a browser session in words", async () => {
    load.mockResolvedValue([device({ device_id: "d-6", name: "Firefox", platform: "web" })]);
    render(<DevicesList variant="own" load={load} signOut={signOut} />);
    const row = await screen.findByTestId("collab-device-d-6");
    expect(row).toHaveTextContent(devices.browser);
    expect(row).not.toHaveTextContent(/\bweb\b/);
  });

  it("ignores a failure from a list that was already closed", async () => {
    const slow = deferred<ReturnType<typeof device>[]>();
    const first = vi.fn(() => slow.promise);
    load.mockResolvedValue([laptop]);
    const { rerender } = render(<DevicesList key="bob" variant="member" ownerName="Bob" load={first} signOut={signOut} />);
    rerender(<DevicesList key="carol" variant="member" ownerName="Carol" load={load} signOut={signOut} />);
    expect(await screen.findByTestId("collab-device-d-1")).toBeInTheDocument();
    await act(async () => {
      slow.reject(collabError("forbidden"));
      await slow.promise.catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("collab-device-d-1")).toBeInTheDocument();
  });
});
