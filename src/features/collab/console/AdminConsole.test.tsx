// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatRelativeTimeFrom } from "@/lib/intl";
import {
  ALICE_ID,
  SERVER_ID,
  account,
  check,
  collabError,
  deferred,
  fill,
  member,
  runtimeSettings,
  securityEvent,
  server,
} from "../tests/fixtures";
import { allowRadixSelect } from "../tests/select";
import { DAY, NOW, adminProject, overview, projectsPage } from "./tests/fixtures";

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
  allowRadixSelect();
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

  it("paints the content on the same surface as the navigation", async () => {
    render(<AdminConsole server={ADMIN} actor="admin" />);
    const console = screen.getByTestId("admin-console");
    expect(console).toHaveClass("bg-sidebar");
    expect(console).not.toHaveClass("bg-background");
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

  it("sends you from People to the allowed list to add someone", async () => {
    const user = userEvent.setup();
    render(<AdminConsole server={ADMIN} actor="admin" />);
    await user.click(navItem("people"));
    await user.click(await screen.findByRole("button", { name: enCollab.admin.members.addPeople }));
    expect(navItem("access")).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText(enCollab.admin.allowlist.empty)).toBeInTheDocument();
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

  it("marks nobody as you when the server lists no account for this computer", async () => {
    const user = userEvent.setup();
    render(<AdminConsole server={server({ account: null })} actor="admin" />);
    await user.click(navItem("people"));
    const alice = await screen.findByTestId(`collab-member-${ALICE_ID}`);
    expect(alice).toHaveTextContent("Alice Chen");
    expect(within(alice).queryByText(enCollab.admin.members.you)).toBeNull();
  });

  it("offers no sign-in names on the allowed list before the overview has loaded", async () => {
    mocks.collabAdminOverview.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    render(<AdminConsole server={ADMIN} actor="admin" />);
    await user.click(navItem("access"));
    await screen.findByText(enCollab.admin.allowlist.empty);
    await user.click(screen.getByRole("combobox", { name: enCollab.admin.allowlist.matchLabel }));
    expect(await screen.findByRole("option", { name: enCollab.admin.allowlist.match.login })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("lists projects against this computer's clock and promises no deletion date before the overview loads", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(NOW + DAY);
      mocks.collabAdminOverview.mockReturnValue(new Promise(() => undefined));
      mocks.collabAdminProjects.mockResolvedValue(projectsPage([adminProject()]));
      const user = userEvent.setup();
      render(<AdminConsole server={ADMIN} actor="admin" />);
      await user.click(navItem("projects"));
      expect(
        await screen.findByText(formatRelativeTimeFrom(adminProject().last_activity_at, NOW + DAY)),
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: fill(copy.projects.archiveNamed, { title: "Grant proposal" }) }),
      );
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(copy.projects.archiveConfirm.descriptionLater);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names people in the log once the member list arrives", async () => {
    const people = deferred<ReturnType<typeof member>[]>();
    mocks.collabAdminMembers.mockReturnValue(people.promise);
    mocks.collabAdminSecurityLog.mockResolvedValue({ items: [securityEvent()], next_cursor: null });
    const user = userEvent.setup();
    render(<AdminConsole server={ADMIN} actor="admin" />);
    await user.click(navItem("log"));
    const [entry] = await screen.findAllByRole("listitem");
    expect(entry).toHaveTextContent(enCollab.admin.log.unknownAccount);
    await act(async () => {
      people.resolve([member({ server_role: "admin" })]);
      await people.promise;
    });
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(`Alice Chen · ${enCollab.admin.log.kinds.signIn}`);
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
