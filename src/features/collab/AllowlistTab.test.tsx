// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabAllowlistEntry } from "@/lib/tauri";
import { ALICE_ID, SERVER_ID, allowlistEntry, capabilities, collabError, deferred, fill } from "./tests/fixtures";
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
    { id: "ghe", kind: "github", label: "GitHub Enterprise" },
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

  it("adds a sign-in name on a GitHub sign-in option and never offers OpenID Connect ones", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    mocks.collabAdminAddAllowlist.mockResolvedValue(
      allowlistEntry({ id: "allow-10", matcher: { kind: "provider_login", provider: "ghe", login: "achen" } }),
    );
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await chooseOption(user, copy.matchLabel, copy.match.login);
    await user.click(screen.getByRole("combobox", { name: copy.providerLabel }));
    expect(screen.queryByRole("option", { name: "Future login" })).toBeNull();
    expect(screen.queryByRole("option", { name: "University login" })).toBeNull();
    await user.click(await screen.findByRole("option", { name: "GitHub Enterprise" }));
    await user.type(screen.getByRole("textbox", { name: copy.match.login }), "achen");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(mocks.collabAdminAddAllowlist).toHaveBeenCalledWith(SERVER_ID, {
      matcher: { kind: "provider_login", provider: "ghe", login: "achen" },
      role: "member",
    });
    expect(
      await screen.findByText(fill(copy.loginEntry, { login: "achen", provider: "GitHub Enterprise" })),
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

  it("names a mistyped email address or sign-in name without asking the server", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "ada@uni");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.invalid_email);
    expect(mocks.collabAdminAddAllowlist).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_email", enCollab.errors.invalid_email],
    ["already_member", enCollab.errors.already_member],
    ["duplicate_entry", copy.duplicate],
  ])("explains the server's %s refusal in its own words", async (code, words) => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    mocks.collabAdminAddAllowlist.mockRejectedValue(collabError(code));
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "dan@uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(words);
  });

  it("shows the server's own sentence for a refusal it has no code for", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    mocks.collabAdminAddAllowlist.mockRejectedValue(collabError("invalid", "Choose a sign-in provider for that name."));
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "dan@uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a sign-in provider for that name.");
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

  it("keeps an entry busy until its own removal ends, whatever another entry does", async () => {
    const forDan = deferred<undefined>();
    const forEve = deferred<undefined>();
    mocks.collabAdminAllowlist.mockResolvedValue([
      allowlistEntry(),
      allowlistEntry({ id: "allow-2", matcher: { kind: "email", email: "eve@uni.edu" } }),
    ]);
    mocks.collabAdminRemoveAllowlist.mockImplementation((_server: string, id: string) =>
      id === "allow-1" ? forDan.promise : forEve.promise,
    );
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await user.click(await screen.findByRole("button", { name: fill(copy.removeNamed, { entry: "dan@uni.edu" }) }));
    const eve = screen.getByRole("button", { name: fill(copy.removeNamed, { entry: "eve@uni.edu" }) });
    await user.click(eve);
    await act(async () => forDan.resolve(undefined));
    await waitFor(() => expect(screen.queryByText("dan@uni.edu")).toBeNull());
    expect(eve).toBeDisabled();
    expect(mocks.collabAdminRemoveAllowlist).toHaveBeenCalledTimes(2);
    await act(async () => forEve.resolve(undefined));
    await waitFor(() => expect(screen.queryByText("eve@uni.edu")).toBeNull());
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

  it("shows only the list of the server in view when an older answer comes back late", async () => {
    const slow = deferred<CollabAllowlistEntry[]>();
    const failing = deferred<CollabAllowlistEntry[]>();
    mocks.collabAdminAllowlist
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce([allowlistEntry()]);
    const { rerender } = render(<AllowlistTab serverId="server-a" actor="admin" providers={providers} />);
    rerender(<AllowlistTab serverId="server-b" actor="admin" providers={providers} />);
    rerender(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    expect(await screen.findByText("dan@uni.edu")).toBeInTheDocument();
    await act(async () => {
      slow.resolve([allowlistEntry({ id: "old", matcher: { kind: "email", email: "old@uni.edu" } })]);
      failing.reject(collabError("forbidden"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(screen.queryByText("old@uni.edu")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("offers sign-in names only when the server signs people in with GitHub", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    const user = userEvent.setup();
    render(
      <AllowlistTab
        serverId={SERVER_ID}
        actor="admin"
        providers={[{ id: "uni", kind: "oidc", label: "University login" }]}
      />,
    );
    await screen.findByText(copy.empty);
    await user.click(screen.getByRole("combobox", { name: copy.matchLabel }));
    expect(await screen.findByRole("option", { name: copy.match.login })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: copy.match.email })).not.toHaveAttribute("aria-disabled");
  });

  it("names the sign-in option by its id when the server no longer lists it", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([
      allowlistEntry({ matcher: { kind: "provider_login", provider: "gitlab", login: "achen" } }),
    ]);
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    expect(await screen.findByText(fill(copy.loginEntry, { login: "achen", provider: "gitlab" }))).toBeInTheDocument();
  });

  it("shows a role this version does not know as the server wrote it", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([allowlistEntry({ role: "auditor" as never })]);
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    const [entry] = await screen.findAllByRole("listitem");
    expect(entry).toHaveTextContent("auditor");
  });

  it("goes back to email addresses after choosing sign-in names", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await chooseOption(user, copy.matchLabel, copy.match.login);
    expect(screen.getByRole("textbox", { name: copy.match.login })).toHaveAttribute(
      "placeholder",
      copy.loginPlaceholder,
    );
    await chooseOption(user, copy.matchLabel, copy.match.email);
    expect(screen.getByRole("textbox", { name: copy.match.email })).toHaveAttribute(
      "placeholder",
      copy.emailPlaceholder,
    );
    expect(screen.queryByRole("combobox", { name: copy.providerLabel })).toBeNull();
  });

  it("sends nothing when the form is submitted with only spaces", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "   ");
    const add = screen.getByRole("button", { name: copy.add });
    expect(add).toBeDisabled();
    fireEvent.submit(add.closest("form") as HTMLFormElement);
    expect(mocks.collabAdminAddAllowlist).not.toHaveBeenCalled();
  });

  it("adds an entry while the list is still loading", async () => {
    mocks.collabAdminAllowlist.mockReturnValue(new Promise(() => undefined));
    mocks.collabAdminAddAllowlist.mockResolvedValue(
      allowlistEntry({ id: "allow-9", matcher: { kind: "email", email: "erin@uni.edu" } }),
    );
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: copy.match.email }), "erin@uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByText("erin@uni.edu")).toBeInTheDocument();
    expect(screen.queryByText(copy.loading)).toBeNull();
  });

  it("keeps an entry and says why it could not be removed", async () => {
    mocks.collabAdminAllowlist.mockResolvedValue([allowlistEntry()]);
    mocks.collabAdminRemoveAllowlist.mockRejectedValue(collabError("forbidden"));
    const user = userEvent.setup();
    render(<AllowlistTab serverId={SERVER_ID} actor="admin" providers={providers} />);
    const remove = await screen.findByRole("button", { name: fill(copy.removeNamed, { entry: "dan@uni.edu" }) });
    await user.click(remove);
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.forbidden);
    expect(screen.getByText("dan@uni.edu")).toBeInTheDocument();
    expect(remove).toBeEnabled();
  });
});
