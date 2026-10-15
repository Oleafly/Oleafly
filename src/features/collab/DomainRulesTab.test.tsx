// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabDomainRule } from "@/lib/tauri";
import { SERVER_ID, collabError, deferred, domainRule, fill } from "./tests/fixtures";
import { allowRadixSelect, chooseOption } from "./tests/select";

const mocks = vi.hoisted(() => ({
  collabAdminDomainRules: vi.fn(),
  collabAdminAddDomainRule: vi.fn(),
  collabAdminRemoveDomainRule: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { DomainRulesTab, normalizeDomain } from "./DomainRulesTab";

const copy = enCollab.admin.domains;
const roles = enCollab.roles;

beforeAll(async () => {
  await loadNamespace("collab");
  allowRadixSelect();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DomainRulesTab", () => {
  it("cleans up a typed domain", () => {
    expect(normalizeDomain("  @Math.Uni.EDU ")).toBe("math.uni.edu");
    expect(normalizeDomain("@@cs.uni.edu")).toBe("cs.uni.edu");
    expect(normalizeDomain("   ")).toBe("");
  });

  it("lists the domain rules with their role", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([domainRule()]);
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    const [rule] = await screen.findAllByRole("listitem");
    expect(rule).toHaveTextContent("cs.uni.edu");
    expect(rule).toHaveTextContent(roles.member);
    expect(mocks.collabAdminDomainRules).toHaveBeenCalledWith(SERVER_ID);
  });

  it("adds a domain without the @ and in lower case", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([]);
    mocks.collabAdminAddDomainRule.mockResolvedValue(domainRule({ id: "domain-2", domain: "math.uni.edu", role: "guest" }));
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.domainLabel }), " @Math.Uni.EDU ");
    await chooseOption(user, copy.roleLabel, roles.guest);
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(mocks.collabAdminAddDomainRule).toHaveBeenCalledWith(SERVER_ID, { domain: "math.uni.edu", role: "guest" });
    expect(await screen.findByText("math.uni.edu")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: copy.domainLabel })).toHaveValue("");
  });

  it("grants only member or guest through a domain, even for an admin", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    await screen.findByText(copy.empty);
    await user.click(screen.getByRole("combobox", { name: copy.roleLabel }));
    expect(await screen.findByRole("option", { name: roles.member })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: roles.guest })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: roles.admin })).toBeNull();
    expect(screen.queryByRole("option", { name: roles.maintainer })).toBeNull();
  });

  it("says when a domain already has a rule", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([]);
    mocks.collabAdminAddDomainRule.mockRejectedValue(collabError("conflict"));
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="maintainer" />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.domainLabel }), "cs.uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.duplicate);
  });

  it.each(["https://uni.edu", "uni_lab.edu", "uni"])(
    "names %s as not a domain without asking the server",
    async (typed) => {
      mocks.collabAdminDomainRules.mockResolvedValue([]);
      const user = userEvent.setup();
      render(<DomainRulesTab serverId={SERVER_ID} actor="maintainer" />);
      await screen.findByText(copy.empty);
      await user.type(screen.getByRole("textbox", { name: copy.domainLabel }), typed);
      await user.click(screen.getByRole("button", { name: copy.add }));
      expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.invalid_domain);
      expect(mocks.collabAdminAddDomainRule).not.toHaveBeenCalled();
    },
  );

  it("says when the server already has the rule, under its new code", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([]);
    mocks.collabAdminAddDomainRule.mockRejectedValue(collabError("duplicate_entry"));
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="maintainer" />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.domainLabel }), "cs.uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.duplicate);
  });

  it("removes a rule", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([domainRule()]);
    mocks.collabAdminRemoveDomainRule.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: fill(copy.removeNamed, { domain: "cs.uni.edu" }) }));
    expect(mocks.collabAdminRemoveDomainRule).toHaveBeenCalledWith(SERVER_ID, "domain-1");
    await waitFor(() => expect(screen.getByText(copy.empty)).toBeInTheDocument());
  });

  it("keeps a rule busy until its own removal ends, whatever another rule does", async () => {
    const forCs = deferred<undefined>();
    const forMath = deferred<undefined>();
    mocks.collabAdminDomainRules.mockResolvedValue([domainRule(), domainRule({ id: "domain-2", domain: "math.uni.edu" })]);
    mocks.collabAdminRemoveDomainRule.mockImplementation((_server: string, id: string) =>
      id === "domain-1" ? forCs.promise : forMath.promise,
    );
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: fill(copy.removeNamed, { domain: "cs.uni.edu" }) }));
    const math = screen.getByRole("button", { name: fill(copy.removeNamed, { domain: "math.uni.edu" }) });
    await user.click(math);
    await act(async () => forCs.resolve(undefined));
    await waitFor(() => expect(screen.queryByText("cs.uni.edu")).toBeNull());
    expect(math).toBeDisabled();
    expect(mocks.collabAdminRemoveDomainRule).toHaveBeenCalledTimes(2);
    await act(async () => forMath.resolve(undefined));
    await waitFor(() => expect(screen.getByText(copy.empty)).toBeInTheDocument());
  });

  it("explains a failed load and tries again", async () => {
    mocks.collabAdminDomainRules.mockRejectedValueOnce(collabError("unreachable")).mockResolvedValueOnce([]);
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    expect(await screen.findByText(enCollab.errors.unreachable)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
  });

  it("shows only the rules of the server in view when an older answer comes back late", async () => {
    const slow = deferred<CollabDomainRule[]>();
    const failing = deferred<CollabDomainRule[]>();
    mocks.collabAdminDomainRules
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(failing.promise)
      .mockResolvedValueOnce([domainRule()]);
    const { rerender } = render(<DomainRulesTab serverId="server-a" actor="admin" />);
    rerender(<DomainRulesTab serverId="server-b" actor="admin" />);
    rerender(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    expect(await screen.findByText("cs.uni.edu")).toBeInTheDocument();
    await act(async () => {
      slow.resolve([domainRule({ id: "old", domain: "old.uni.edu" })]);
      failing.reject(collabError("forbidden"));
      await Promise.allSettled([slow.promise, failing.promise]);
    });
    expect(screen.queryByText("old.uni.edu")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("sends nothing when the form is submitted with only an @", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    await screen.findByText(copy.empty);
    await user.type(screen.getByRole("textbox", { name: copy.domainLabel }), " @@ ");
    const add = screen.getByRole("button", { name: copy.add });
    expect(add).toBeDisabled();
    fireEvent.submit(add.closest("form") as HTMLFormElement);
    expect(mocks.collabAdminAddDomainRule).not.toHaveBeenCalled();
  });

  it("adds a rule while the list is still loading", async () => {
    mocks.collabAdminDomainRules.mockReturnValue(new Promise(() => undefined));
    mocks.collabAdminAddDomainRule.mockResolvedValue(domainRule({ id: "domain-2", domain: "math.uni.edu" }));
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    expect(screen.getByText(copy.loading)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: copy.domainLabel }), "math.uni.edu");
    await user.click(screen.getByRole("button", { name: copy.add }));
    expect(await screen.findByText("math.uni.edu")).toBeInTheDocument();
    expect(screen.queryByText(copy.loading)).toBeNull();
  });

  it("shows a role this version does not know as the server wrote it", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([domainRule({ role: "auditor" as never })]);
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    const [rule] = await screen.findAllByRole("listitem");
    expect(rule).toHaveTextContent("auditor");
  });

  it("keeps a rule and says why it could not be removed", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([domainRule()]);
    mocks.collabAdminRemoveDomainRule.mockRejectedValue(collabError("conflict"));
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    const remove = await screen.findByRole("button", { name: fill(copy.removeNamed, { domain: "cs.uni.edu" }) });
    await user.click(remove);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.duplicate);
    expect(screen.getByText("cs.uni.edu")).toBeInTheDocument();
    expect(remove).toBeEnabled();
  });
});
