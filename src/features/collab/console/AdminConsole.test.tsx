// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SERVER_ID, account, check, collabError, fill, member, runtimeSettings, server } from "../tests/fixtures";
import { overview, projectsPage } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabAdminOverview: vi.fn(),
  collabAdminProjects: vi.fn(),
  collabAdminMembers: vi.fn(),
  collabAdminAllowlist: vi.fn(),
  collabAdminDomainRules: vi.fn(),
  collabAdminSettings: vi.fn(),
  collabAdminSecurityLog: vi.fn(),
  collabServerTest: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

vi.mock("../EmailTab", () => ({
  EmailTab: ({ server: entry, actor }: { server: { server_id: string }; actor: string }) => (
    <p>{`Email tab for ${entry.server_id} as ${actor}`}</p>
  ),
}));

import { AdminConsole } from "./AdminConsole";

const copy = enCollab.console;
const ADMIN = server({ account: account({ server_role: "admin" }) });

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.collabAdminOverview.mockResolvedValue(overview());
  mocks.collabAdminProjects.mockResolvedValue(projectsPage([]));
  mocks.collabAdminMembers.mockResolvedValue([member({ server_role: "admin" })]);
  mocks.collabAdminAllowlist.mockResolvedValue([]);
  mocks.collabAdminDomainRules.mockResolvedValue([]);
  mocks.collabAdminSettings.mockResolvedValue(runtimeSettings());
  mocks.collabAdminSecurityLog.mockResolvedValue({ items: [], next_cursor: null });
  mocks.collabServerTest.mockResolvedValue([check("reachable", "pass")]);
});

function navItem(section: keyof typeof copy.sections): HTMLElement {
  return screen.getByRole("button", { name: copy.sections[section] });
}

function health(): HTMLElement | null {
  return screen.queryByRole("status", { name: /Server health/ });
}

describe("AdminConsole", () => {
  it("names the server, its address, your role and its health", async () => {
    render(<AdminConsole server={ADMIN} actor="admin" />);
    expect(screen.getByRole("heading", { level: 1, name: "Smith Lab" })).toBeInTheDocument();
    expect(screen.getByText("https://collab.uni.edu")).toBeInTheDocument();
    expect(screen.getByText(fill(enCollab.section.server.role, { role: "Admin" }))).toBeInTheDocument();
    expect(health()).toHaveTextContent(copy.health.checking);
    await waitFor(() => expect(health()).toHaveTextContent(copy.health.ok));
    expect(health()).toHaveAccessibleName(fill(copy.health.label, { status: copy.health.ok }));
    expect(screen.getByRole("navigation", { name: copy.sectionsLabel })).toBeInTheDocument();
  });

  it("says when the server needs attention or cannot be reached", async () => {
    mocks.collabAdminOverview.mockResolvedValueOnce(
      overview({ health: { status: "warning", issues: ["no_sign_in_provider"] } }),
    );
    const { unmount } = render(<AdminConsole server={ADMIN} actor="admin" />);
    await waitFor(() => expect(health()).toHaveTextContent(copy.health.warning));
    unmount();
    mocks.collabAdminOverview.mockRejectedValueOnce(collabError("unreachable"));
    const second = render(<AdminConsole server={ADMIN} actor="admin" />);
    await waitFor(() => expect(health()).toHaveTextContent(copy.health.unreachable));
    second.unmount();
    mocks.collabAdminOverview.mockRejectedValueOnce(collabError("forbidden"));
    render(<AdminConsole server={ADMIN} actor="admin" />);
    expect(await screen.findByText(enCollab.errors.forbidden)).toBeInTheDocument();
    expect(health()).toBeNull();
  });

  it("opens on the overview and shows each section from the navigation", async () => {
    const user = userEvent.setup();
    render(<AdminConsole server={ADMIN} actor="admin" />);
    expect(navItem("overview")).toHaveAttribute("aria-current", "page");
    expect(await screen.findByTestId("console-overview")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: copy.sections.overview })).toBeInTheDocument();

    await user.click(navItem("people"));
    expect(navItem("people")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: copy.sections.people })).toBeInTheDocument();
    expect(await screen.findByText("Alice Chen")).toBeInTheDocument();

    await user.click(navItem("access"));
    expect(await screen.findByText(enCollab.admin.allowlist.empty)).toBeInTheDocument();
    expect(await screen.findByText(enCollab.admin.domains.empty)).toBeInTheDocument();

    await user.click(navItem("projects"));
    expect(await screen.findByText(copy.projects.empty)).toBeInTheDocument();
    expect(mocks.collabAdminProjects).toHaveBeenCalledWith(SERVER_ID, expect.objectContaining({ sort: "activity" }));

    await user.click(navItem("settings"));
    expect(await screen.findByRole("switch", { name: enCollab.admin.settings.directoryVisible.label })).toBeInTheDocument();

    await user.click(navItem("email"));
    expect(screen.getByText(`Email tab for ${SERVER_ID} as admin`)).toBeInTheDocument();

    await user.click(navItem("log"));
    expect(await screen.findByText(enCollab.admin.log.empty)).toBeInTheDocument();
    expect(mocks.collabAdminSecurityLog).toHaveBeenCalledWith(SERVER_ID);

    await user.click(navItem("checks"));
    await waitFor(() => expect(mocks.collabServerTest).toHaveBeenCalledWith("https://collab.uni.edu"));

    await user.click(navItem("overview"));
    await waitFor(() => expect(mocks.collabAdminOverview).toHaveBeenCalledTimes(2));
  });

  it("moves through the sections with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<AdminConsole server={ADMIN} actor="admin" />);
    await screen.findByTestId("console-overview");
    expect(navItem("overview")).toHaveAttribute("tabindex", "0");
    expect(navItem("people")).toHaveAttribute("tabindex", "-1");
    navItem("overview").focus();
    await user.keyboard("{ArrowDown}");
    expect(navItem("people")).toHaveFocus();
    expect(navItem("people")).toHaveAttribute("aria-current", "page");
    await user.keyboard("{ArrowRight}");
    expect(navItem("access")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(navItem("people")).toHaveFocus();
    await user.keyboard("{End}");
    expect(navItem("checks")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(navItem("overview")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(navItem("checks")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(navItem("overview")).toHaveFocus();
    expect(navItem("overview")).toHaveAttribute("aria-current", "page");
    await user.keyboard("a");
    expect(navItem("overview")).toHaveFocus();
  });

  it("follows the overview's links to email and settings", async () => {
    const user = userEvent.setup();
    render(<AdminConsole server={ADMIN} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: copy.overview.services.openEmail }));
    expect(navItem("email")).toHaveAttribute("aria-current", "page");
    await user.click(navItem("overview"));
    await user.click(await screen.findByRole("button", { name: copy.overview.settings.change }));
    expect(navItem("settings")).toHaveAttribute("aria-current", "page");
  });
});
