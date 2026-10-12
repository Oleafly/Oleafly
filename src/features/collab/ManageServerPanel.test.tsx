// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import {
  SERVER_ID,
  account,
  capabilities,
  collabError,
  fill,
  member,
  runtimeSettings,
  server,
  signedOutServer,
} from "./tests/fixtures";

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
