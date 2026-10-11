// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
  unlisten: vi.fn(),
  ready: vi.fn(),
  open: vi.fn(),
  logError: vi.fn(),
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/tauri", () => ({
  TEMPLATE_LINK_EVENT: "template-link",
  templateLinkReady: mocks.ready,
}));
vi.mock("@/store/template-link", () => ({ openTemplateLink: mocks.open }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { useTemplateLinkIntake } from "./template-link-intake";

type Handler = (event: { payload: unknown }) => void;
let handler: Handler | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  handler = null;
  mocks.isTauri.mockReturnValue(true);
  mocks.listen.mockImplementation(async (event: string, callback: Handler) => {
    mocks.calls.push(`listen:${event}`);
    handler = callback;
    return mocks.unlisten;
  });
  mocks.ready.mockImplementation(async () => {
    mocks.calls.push("ready");
    return null;
  });
});

describe("template link intake", () => {
  it("listens before it tells the app the page is ready, then opens the waiting link", async () => {
    mocks.ready.mockImplementation(async () => {
      mocks.calls.push("ready");
      return { packId: "open-letter", templateId: "tpl-1" };
    });
    renderHook(() => useTemplateLinkIntake());
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ packId: "open-letter", templateId: "tpl-1" }),
    );
    expect(mocks.calls).toEqual(["listen:template-link", "ready"]);
  });

  it("opens each link the backend sends while the app runs", async () => {
    renderHook(() => useTemplateLinkIntake());
    await waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce());
    expect(mocks.open).not.toHaveBeenCalled();
    handler?.({ payload: { packId: "typst-cv", templateId: "modern" } });
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith({ packId: "typst-cv", templateId: "modern" }),
    );
  });

  it("stops listening on unmount and never claims a link for a page that is gone", async () => {
    let resolveListen: (stop: () => void) => void = () => {};
    mocks.listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        }),
    );
    const early = renderHook(() => useTemplateLinkIntake());
    early.unmount();
    resolveListen(mocks.unlisten);
    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledOnce());
    expect(mocks.ready).not.toHaveBeenCalled();

    mocks.listen.mockImplementation(async (_event: string, callback: Handler) => {
      handler = callback;
      return mocks.unlisten;
    });
    const late = renderHook(() => useTemplateLinkIntake());
    await waitFor(() => expect(mocks.ready).toHaveBeenCalledOnce());
    late.unmount();
    expect(mocks.unlisten).toHaveBeenCalledTimes(2);
  });

  it("does nothing outside the desktop app", () => {
    mocks.isTauri.mockReturnValue(false);
    renderHook(() => useTemplateLinkIntake());
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it("logs a failure to listen instead of throwing", async () => {
    mocks.listen.mockRejectedValue(new Error("no ipc"));
    renderHook(() => useTemplateLinkIntake());
    await waitFor(() =>
      expect(mocks.logError).toHaveBeenCalledWith("listen for template links", expect.any(Error)),
    );
    expect(mocks.ready).not.toHaveBeenCalled();
  });
});
