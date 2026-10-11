// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { ALICE_ID, SERVER_ID, allowlistEntry, capabilities, collabError, fill } from "./tests/fixtures";
import { allowRadixSelect, chooseOption } from "./tests/select";

const mocks = vi.hoisted(() => ({
  collabAdminAllowlist: vi.fn(),
  collabAdminAddAllowlist: vi.fn(),
  collabAdminRemoveAllowlist: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));

import { AllowlistTab } from "./AllowlistTab";

const copy = enCollab.admin.allowlist;
const roles = enCollab.roles;
const providers = capabilities({
  providers: [
    { id: "github", kind: "github", label: "GitHub" },
    { id: "uni", kind: "oidc", label: "University login" },
    { id: "future", kind: "unknown", label: "Future login" },
  ],
}).providers;

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AllowlistTab", () => {
  it("lists who may sign in and whether they have signed in yet", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([
      allowlistEntry(),
      allowlistEntry({
        id: "allow-2",
        matcher: { kind: "provider_login", provider: "github", login: "Alice-Chen" },
        role: "maintainer",
        bound_account: ALICE_ID,
      }),
    ]);
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    expect(await screen.findByText("dan@uni.edu")).toBeInTheDocument();
    expect(mocks.collabAdminAllowlist).toHaveBeenCalledWith(SERVER_ID);
    const [dan, alice] = screen.getAllByRole("listitem");
    expect(dan).toHaveTextContent(copy.unbound);
    expect(dan).toHaveTextContent(roles.member);
    expect(alice).toHaveTextContent(fill(copy.loginEntry, { login: "Alice-Chen", provider: "GitHub" }));
    expect(alice).toHaveTextContent(copy.bound);
    expect(alice).toHaveTextContent(roles.maintainer);
  });

  it("adds an email address with the chosen role", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    mocks.collabAdminAddAllowlist.mockResolvedValue(
      allowlistEntry({ id: "allow-9", matcher: { kind: "email", email: "erin@uni.edu" }, role: "guest" }),
    );
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "  erin@uni.edu ");
    await chooseOption(user, copy.roleLabel, roles.guest);
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(mocks.collabAdminAddAllowlist).toHaveBeenCalledWith(SERVER_ID, {
      matcher: { kind: "email", email: "erin@uni.edu" },
      role: "guest",
    });
    expect(await screen.findByText("erin@uni.edu")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: copy.match.email })).toHaveValue("");
  });

  it("adds a sign-in name on the chosen sign-in option, and skips options it does not know", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    mocks.collabAdminAddAllowlist.mockResolvedValue(
      allowlistEntry({ id: "allow-10", matcher: { kind: "provider_login", provider: "uni", login: "achen" } }),
    );
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await chooseOption(user, copy.matchLabel, copy.match.login);
    await user.click(screen.getByRole("combobox", { name: copy.providerLabel }));
    expect(screen.queryByRole("option", { name: "Future login" })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "University login" }));
    await user.type(screen.getByRole("textbox", { name: copy.match.login }), "achen");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(mocks.collabAdminAddAllowlist).toHaveBeenCalledWith(SERVER_ID, {
      matcher: { kind: "provider_login", provider: "uni", login: "achen" },
      role: "member",
    });
    expect(
      await screen.findByText(fill(copy.loginEntry, { login: "achen", provider: "University login" })),
    ).toBeInTheDocument();
  });

  it("says when the person is already on the list", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    mocks.collabAdminAddAllowlist.mockRejectedValue(collabError("conflict"));
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "dan@uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.duplicate);
    expect(screen.getByRole("textbox", { name: copy.match.email })).toHaveValue("dan@uni.edu");
  });

  it("removes an entry", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([allowlistEntry()]);
    mocks.collabAdminRemoveAllowlist.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await user.click(await screen.findByRole("button", { name: fill(copy.removeNamed, { entry: "dan@uni.edu" }) }));
    expect(mocks.collabAdminRemoveAllowlist).toHaveBeenCalledWith(SERVER_ID, "allow-1");
    await waitFor(() => expect(screen.queryByText("dan@uni.edu")).toBeNull());
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("offers a maintainer only the member and guest roles", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="maintainer" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.click(screen.getByRole("combobox", { name: copy.roleLabel }));
    expect(await screen.findByRole("option", { name: roles.member })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: roles.guest })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: roles.admin })).toBeNull();
    expect(screen.queryByRole("option", { name: roles.maintainer })).toBeNull();
  });

  it("explains a failed load and tries again", async () => {
    mocks.collabAdminAllowlist.mockRejectedValueOnce(collabError("forbidden")).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="maintainer" providers={providers} />);
    expect(await screen.findByText(enCollab.admin.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(enCollab.errors.forbidden)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });
});
