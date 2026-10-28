import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalDocumentSession } from "@oleafly/editor/document-session";
import {
  collabCompileBarrier,
  collabDocumentSession,
  collabProjectReadOnly,
  collabSettingsLocked,
  collabVisualReadOnly,
  collabHoldsDocument,
  installCollabEditorPort,
  installReviewNotice,
  noteUnreviewedSuggestions,
  useCollabEditorGate,
} from "./collab-live-bridge";

afterEach(() => {
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false });
});

describe("collab live bridge", () => {
  it("has no sessions and no barrier until live editing installs a port", async () => {
    expect(collabDocumentSession("main.tex")).toBeNull();
    await expect(collabCompileBarrier("project")).resolves.toBeUndefined();
  });

  it("asks the installed port for sessions and flushes only through it", async () => {
    const session = new LocalDocumentSession("main.tex", "x");
    const port = {
      documentSession: vi.fn((path: string) => (path === "main.tex" ? session : null)),
      flush: vi.fn(async () => {}),
    };
    const uninstall = installCollabEditorPort(port);
    expect(collabDocumentSession("main.tex")).toBe(session);
    expect(collabDocumentSession("figure.png")).toBeNull();
    await collabCompileBarrier("project");
    expect(port.flush).toHaveBeenCalledWith("project");
    await collabCompileBarrier(null);
    expect(port.flush).toHaveBeenCalledTimes(1);
    uninstall();
    expect(collabDocumentSession("main.tex")).toBeNull();
  });

  it("says which files a live session holds without opening one", () => {
    expect(collabHoldsDocument("main.tex")).toBe(false);
    const documentSession = vi.fn(() => null);
    const uninstall = installCollabEditorPort({
      documentSession,
      holds: (path) => path === "main.tex",
      flush: async () => {},
    });
    expect(collabHoldsDocument("main.tex")).toBe(true);
    expect(collabHoldsDocument("intro.tex")).toBe(false);
    expect(documentSession).not.toHaveBeenCalled();
    uninstall();
    expect(collabHoldsDocument("main.tex")).toBe(false);
  });

  it("keeps a newer port when an older one uninstalls", () => {
    const first = { documentSession: () => null, flush: async () => {} };
    const session = new LocalDocumentSession("a.tex", "");
    const second = { documentSession: () => session, flush: async () => {} };
    const uninstallFirst = installCollabEditorPort(first);
    installCollabEditorPort(second);
    uninstallFirst();
    expect(collabDocumentSession("a.tex")).toBe(session);
    installCollabEditorPort(first)();
  });

  it("makes a live project read-only for viewers and its visual Markdown read-only for everyone", () => {
    expect(collabProjectReadOnly("project")).toBe(false);
    expect(collabVisualReadOnly("project")).toBe(false);
    useCollabEditorGate.setState({ projectId: "project", viewer: false });
    expect(collabProjectReadOnly("project")).toBe(false);
    expect(collabVisualReadOnly("project")).toBe(true);
    expect(collabVisualReadOnly("other")).toBe(false);
    useCollabEditorGate.setState({ projectId: "project", viewer: true });
    expect(collabProjectReadOnly("project")).toBe(true);
    expect(collabProjectReadOnly("other")).toBe(false);
    expect(collabProjectReadOnly(null)).toBe(false);
  });

  it("locks shared settings and files for every role that can't edit, while a reviewer can still type", () => {
    useCollabEditorGate.setState({ projectId: "project", viewer: false, locked: true });
    expect(collabProjectReadOnly("project")).toBe(false);
    expect(collabSettingsLocked("project")).toBe(true);
    expect(collabSettingsLocked("other")).toBe(false);
    useCollabEditorGate.setState({ viewer: true, locked: true });
    expect(collabProjectReadOnly("project")).toBe(true);
    useCollabEditorGate.setState({ viewer: false, locked: false });
    expect(collabSettingsLocked("project")).toBe(false);
  });

  it("passes a compile or export to the installed review notice only", () => {
    const notice = vi.fn();
    noteUnreviewedSuggestions("project", "compile");
    const uninstall = installReviewNotice(notice);
    noteUnreviewedSuggestions("project", "export");
    noteUnreviewedSuggestions(null, "compile");
    expect(notice).toHaveBeenCalledTimes(1);
    expect(notice).toHaveBeenCalledWith("project", "export");
    const newer = vi.fn();
    const uninstallNewer = installReviewNotice(newer);
    uninstall();
    noteUnreviewedSuggestions("project", "compile");
    expect(newer).toHaveBeenCalledWith("project", "compile");
    uninstallNewer();
    noteUnreviewedSuggestions("project", "compile");
    expect(newer).toHaveBeenCalledTimes(1);
  });
});
