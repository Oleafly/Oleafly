// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDate } from "@/lib/intl";
import { DevicesList } from "./DevicesList";
import { collabError, device, fill } from "./tests/fixtures";

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
});
