import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels: Array<{ onmessage: (message: unknown) => void }> = [];
  class FakeChannel {
    onmessage: (message: unknown) => void = () => {};
    constructor() {
      channels.push(this);
    }
  }
  return { invoke: vi.fn(), channels, FakeChannel };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.FakeChannel }));

import {
  isOverleafError,
  overleafCreateFromLocal,
  overleafImportProjects,
  overleafInviteAccept,
  overleafLinkJoin,
  overleafLinkPreview,
  overleafOpenLive,
  overleafImportTemplate,
  overleafListProjects,
  overleafSaveProjectAsTemplate,
  overleafSignIn,
  overleafSignInBrowsers,
  overleafSignInWithBrowser,
  overleafSignOut,
  overleafStatus,
  overleafTemplateDetails,
  overleafTemplatePdf,
  overleafUseAccount,
} from "./overleaf";

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.channels.length = 0;
});

describe("overleaf bridge", () => {
  it("passes a trimmed server or null to every command", async () => {
    mocks.invoke.mockResolvedValue({});
    await overleafStatus("  ");
    await overleafStatus(" https://latex.uni.edu ");
    await overleafSignIn(null, "Sign in");
    await overleafSignOut("https://www.overleaf.com");
    await overleafListProjects();
    await overleafSignOut(null, true, "u-bea");
    await overleafListProjects(" ", "u-bea");
    await overleafUseAccount(null, "u-ada");
    expect(mocks.invoke.mock.calls).toEqual([
      ["overleaf_status", { server: null }],
      ["overleaf_status", { server: "https://latex.uni.edu" }],
      ["overleaf_sign_in", { server: null, title: "Sign in" }],
      ["overleaf_sign_out", { server: "https://www.overleaf.com", account: null, keepLocalCopy: false }],
      ["overleaf_list_projects", { server: null, account: null }],
      ["overleaf_sign_out", { server: null, account: "u-bea", keepLocalCopy: true }],
      ["overleaf_list_projects", { server: null, account: "u-bea" }],
      ["overleaf_use_account", { server: null, account: "u-ada" }],
    ]);
  });

  it("lists the sign-in browsers and signs in with the one picked by its key", async () => {
    mocks.invoke.mockResolvedValue([]);
    await overleafSignInBrowsers();
    await overleafSignInWithBrowser(" https://latex.uni.edu ", "firefox-snap");
    await overleafSignInWithBrowser(undefined, "edge");
    expect(mocks.invoke.mock.calls).toEqual([
      ["overleaf_sign_in_browsers"],
      ["overleaf_sign_in_with_browser", { server: "https://latex.uni.edu", browser: "firefox-snap" }],
      ["overleaf_sign_in_with_browser", { server: null, browser: "edge" }],
    ]);
  });

  it("sends the template commands with their arguments", async () => {
    mocks.invoke.mockResolvedValue({});
    const link = "https://www.overleaf.com/latex/templates/a/b";
    await overleafTemplateDetails(" ", link);
    await overleafTemplatePdf("https://www.overleaf.com", link);
    await overleafImportTemplate(null, link, "Lab", "QUJD");
    await overleafSaveProjectAsTemplate(" https://latex.uni.edu ", "p1", "Master", "u-bea");
    expect(mocks.invoke.mock.calls).toEqual([
      ["overleaf_template_details", { server: null, link }],
      ["overleaf_template_pdf", { server: "https://www.overleaf.com", link }],
      ["overleaf_import_template", { server: null, account: null, link, name: "Lab", previewPngBase64: "QUJD" }],
      [
        "overleaf_save_project_as_template",
        { server: "https://latex.uni.edu", account: "u-bea", projectId: "p1", name: "Master" },
      ],
    ]);
  });

  it("streams import events through a channel and detaches it afterwards", async () => {
    const events: unknown[] = [];
    mocks.invoke.mockImplementation(async (_command: string, args: { onEvent: { onmessage: (event: unknown) => void } }) => {
      args.onEvent.onmessage({ phase: "importing", remoteId: "a" });
      return [{ remoteId: "a", projectId: "p", error: null }];
    });
    const outcomes = await overleafImportProjects(undefined, ["a"], (event) => events.push(event), "u-ada");
    expect(outcomes).toEqual([{ remoteId: "a", projectId: "p", error: null }]);
    expect(events).toEqual([{ phase: "importing", remoteId: "a" }]);
    expect(mocks.invoke).toHaveBeenCalledWith("overleaf_import_projects", {
      server: null,
      account: "u-ada",
      ids: ["a"],
      onEvent: mocks.channels[0],
    });
    mocks.channels[0].onmessage({ phase: "late", remoteId: "a" });
    expect(events).toHaveLength(1);
  });

  it("recognizes coded errors from strings and errors", () => {
    const text = '@oleafly/error:{"code":"overleaf.session_expired","params":{}}';
    expect(isOverleafError(text, "session_expired")).toBe(true);
    expect(isOverleafError(new Error(text), "session_expired")).toBe(true);
    expect(isOverleafError(text, "signed_out")).toBe(false);
    expect(isOverleafError({ code: "x" }, "signed_out")).toBe(false);
  });

  it("sends the account with every open, upload, link and invitation call", async () => {
    mocks.invoke.mockResolvedValue({});
    await overleafOpenLive(" https://latex.uni.edu ", "r1", "u-ada");
    await overleafCreateFromLocal("p1", undefined, null, "  ");
    await overleafCreateFromLocal("p1", null, "u-bea", " Paper ");
    await overleafLinkPreview(null, "https://www.overleaf.com/read/qwertyuiopas", "u-ada");
    await overleafLinkJoin(null, "https://www.overleaf.com/read/qwertyuiopas");
    await overleafInviteAccept("https://latex.uni.edu", "inv1", "u-ada");
    expect(mocks.invoke.mock.calls).toEqual([
      ["overleaf_open_live", { server: "https://latex.uni.edu", account: "u-ada", remoteId: "r1" }],
      ["overleaf_create_from_local", { projectId: "p1", server: null, account: null, name: null }],
      ["overleaf_create_from_local", { projectId: "p1", server: null, account: "u-bea", name: "Paper" }],
      [
        "overleaf_link_preview",
        { server: null, account: "u-ada", link: "https://www.overleaf.com/read/qwertyuiopas" },
      ],
      ["overleaf_link_join", { server: null, account: null, link: "https://www.overleaf.com/read/qwertyuiopas" }],
      ["overleaf_invite_accept", { server: "https://latex.uni.edu", account: "u-ada", invite: "inv1" }],
    ]);
  });
});
