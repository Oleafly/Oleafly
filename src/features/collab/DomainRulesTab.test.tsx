// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { SERVER_ID, collabError, domainRule, fill } from "./tests/fixtures";
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

  it("removes a rule", async () => {
    mocks.collabAdminDomainRules.mockResolvedValue([domainRule()]);
    mocks.collabAdminRemoveDomainRule.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DomainRulesTab serverId={SERVER_ID} actor="admin" />);
    await user.click(await screen.findByRole("button", { name: fill(copy.removeNamed, { domain: "cs.uni.edu" }) }));
    expect(mocks.collabAdminRemoveDomainRule).toHaveBeenCalledWith(SERVER_ID, "domain-1");
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
});
