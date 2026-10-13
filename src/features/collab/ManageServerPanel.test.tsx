// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCapabilities } from "@/lib/tauri";
import {
  SERVER_ID,
  account,
  capabilities,
  collabError,
  deferred,
  fill,
  member,
  runtimeSettings,
  server,
  signedOutServer,
} from "./tests/fixtures";
import { allowRadixSelect } from "./tests/select";

const mocks = vi.hoisted(() => ({
  collabAdminMembers: vi.fn(),
  collabServerProbe: vi.fn(),
  collabAdminAllowlist: vi.fn(),
  collabAdminDomainRules: vi.fn(),
  collabAdminSettings: vi.fn(),
  collabAdminSecurityLog: vi.fn(),
  collabAdminPatchMember: vi.fn(),
  collabAdminRemoveMember: vi.fn(),
  collabAdminMemberDevices: vi.fn(),
  collabAdminSignOutDevice: vi.fn(),
  collabAdminAddAllowlist: vi.fn(),
  collabAdminRemoveAllowlist: vi.fn(),
  collabAdminAddDomainRule: vi.fn(),
  collabAdminRemoveDomainRule: vi.fn(),
  collabAdminPatchSettings: vi.fn(),
  collabAdminEmailStatus: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

const consoleMocks = vi.hoisted(() => ({ openAdminConsole: vi.fn() }));

vi.mock("./console/open-console", () => consoleMocks);

import { ManageServerPanel, visibleManageTabs } from "./ManageServerPanel";

const admin = enCollab.admin;

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabAdminMembers.mockResolvedValue([member({ server_role: "admin" })]);
  mocks.collabServerProbe.mockResolvedValue(capabilities());
  mocks.collabAdminAllowlist.mockResolvedValue([]);
  mocks.collabAdminDomainRules.mockResolvedValue([]);
  mocks.collabAdminSettings.mockResolvedValue(runtimeSettings());
  mocks.collabAdminSecurityLog.mockResolvedValue({ items: [], next_cursor: null });
  mocks.collabAdminEmailStatus.mockResolvedValue({
    configured: false,
    from: null,
    notifications: true,
    last_failure: null,
  });
});

describe("visibleManageTabs", () => {
  it("follows the role table", () => {
    expect(visibleManageTabs("admin")).toEqual(["members", "allowlist", "domains", "settings", "email", "log"]);
    expect(visibleManageTabs("maintainer")).toEqual(["members", "allowlist", "domains", "settings", "email", "log"]);
    expect(visibleManageTabs("member")).toEqual([]);
    expect(visibleManageTabs("guest")).toEqual([]);
  });
});

describe("ManageServerPanel", () => {
  it("opens on Members, loads each tab when it is chosen and goes back", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<ManageServerPanel server={server({ account: account({ server_role: "admin" }) })} onBack={onBack} />);
    expect(screen.getByRole("heading", { name: fill(admin.title, { name: "Smith Lab" }) })).toBeInTheDocument();
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
    expect(mocks.collabAdminMembers).toHaveBeenCalledWith(SERVER_ID);
    expect(mocks.collabServerProbe).toHaveBeenCalledWith("https://collab.uni.edu");
    expect(mocks.collabAdminAllowlist).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: admin.tabs.allowlist }));
    expect(await screen.findByText(admin.allowlist.empty)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: admin.tabs.domains }));
    expect(await screen.findByText(admin.domains.empty)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: admin.tabs.settings }));
    expect(await screen.findByRole("switch", { name: admin.settings.directoryVisible.label })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: admin.tabs.email }));
    expect(await screen.findByText(admin.email.off.title)).toBeInTheDocument();
    expect(mocks.collabAdminEmailStatus).toHaveBeenCalledWith(SERVER_ID);
    await user.click(screen.getByRole("tab", { name: admin.tabs.log }));
    expect(await screen.findByText(admin.log.empty)).toBeInTheDocument();
    expect(mocks.collabAdminSecurityLog).toHaveBeenCalledWith(SERVER_ID);

    await user.click(screen.getByRole("button", { name: admin.back }));
    expect(onBack).toHaveBeenCalled();
  });

  it("explains a failed member load and tries again", async () => {
    mocks.collabAdminMembers.mockRejectedValueOnce(collabError("forbidden")).mockResolvedValueOnce([member()]);
    const user = userEvent.setup();
    render(
      <ManageServerPanel server={server({ account: account({ server_role: "maintainer" }) })} onBack={vi.fn()} />,
    );
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();
  });

  it("renders nothing for someone who is not signed in", () => {
    const { container } = render(<ManageServerPanel server={signedOutServer()} onBack={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows no tabs to a signed-in member", async () => {
    render(<ManageServerPanel server={server()} onBack={vi.fn()} />);
    expect(screen.getByRole("heading", { name: fill(admin.title, { name: "Smith Lab" }) })).toBeInTheDocument();
    await waitFor(() => expect(mocks.collabServerProbe).toHaveBeenCalled());
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("offers no sign-in names on the allowed list when the server cannot be asked how people sign in", async () => {
    mocks.collabServerProbe.mockRejectedValue(collabError("unreachable"));
    const user = userEvent.setup();
    render(<ManageServerPanel server={server({ account: account({ server_role: "admin" }) })} onBack={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: admin.tabs.allowlist }));
    await screen.findByText(admin.allowlist.empty);
    await user.click(screen.getByRole("combobox", { name: admin.allowlist.matchLabel }));
    expect(await screen.findByRole("option", { name: admin.allowlist.match.login })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("uses the sign-in options of the server now shown when an older answer comes back late", async () => {
    const slow = deferred<CollabCapabilities>();
    const failing = deferred<CollabCapabilities>();
    mocks.collabServerProbe
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce(capabilities());
    const user = userEvent.setup();
    const adminAccount = account({ server_role: "admin" });
    const { rerender } = render(
      <ManageServerPanel server={server({ url: "https://old.uni.edu", account: adminAccount })} onBack={vi.fn()} />,
    );
    rerender(
      <ManageServerPanel server={server({ url: "https://down.uni.edu", account: adminAccount })} onBack={vi.fn()} />,
    );
    rerender(<ManageServerPanel server={server({ account: adminAccount })} onBack={vi.fn()} />);
    await waitFor(() => expect(mocks.collabServerProbe).toHaveBeenLastCalledWith("https://collab.uni.edu"));
    await act(async () => {
      slow.resolve(capabilities({ providers: [] }));
      failing.reject(collabError("unreachable"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    await user.click(screen.getByRole("tab", { name: admin.tabs.allowlist }));
    await screen.findByText(admin.allowlist.empty);
    await user.click(screen.getByRole("combobox", { name: admin.allowlist.matchLabel }));
    expect(await screen.findByRole("option", { name: admin.allowlist.match.login })).not.toHaveAttribute(
      "aria-disabled",
    );
  });
});

describe("ManageServerPanel admin console", () => {
  it("opens the admin console for the same server", async () => {
    const entry = server({ account: account({ server_role: "maintainer" }) });
    render(<ManageServerPanel server={entry} onBack={vi.fn()} />);
    await screen.findByText("Alice Chen");
    await userEvent.setup().click(screen.getByRole("button", { name: enCollab.console.open }));
    expect(consoleMocks.openAdminConsole).toHaveBeenCalledWith(entry);
  });
});
