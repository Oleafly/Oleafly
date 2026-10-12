// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { deferred } from "./tests/fixtures";

const mocks = vi.hoisted(() => ({
  collabServersList: vi.fn(),
  collabServerProbe: vi.fn(),
  collabServerSignInCancel: vi.fn(),
  collabServerRefresh: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/hooks/use-tauri-event", () => ({ useTauriEvent: vi.fn() }));

import { CollaborationSection } from "./CollaborationSection";
import { useAddServerRequest } from "./links/add-server-request";
import { useCollabStore } from "./store";

const ADDRESS = "https://collab.uni.edu";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useCollabStore.setState({ servers: [], status: "idle", loadError: null, pending: {} });
  useAddServerRequest.setState({ url: null });
  mocks.collabServersList.mockResolvedValue([]);
  mocks.collabServerProbe.mockReturnValue(deferred().promise);
  mocks.collabServerSignInCancel.mockResolvedValue(undefined);
});

describe("CollaborationSection and Add to Oleafly links", () => {
  it("opens the Add server dialog with the address a link asked for, once", async () => {
    useAddServerRequest.getState().ask(ADDRESS);
    const view = render(<CollaborationSection />);
    expect(await screen.findByRole("heading", { name: enCollab.addServer.title })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: enCollab.addServer.addressLabel })).toHaveValue(ADDRESS);
    expect(mocks.collabServerProbe).toHaveBeenCalledWith(ADDRESS);
    expect(useAddServerRequest.getState().url).toBeNull();
    view.unmount();
    render(<CollaborationSection />);
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument();
  });

  it("opens the dialog when a link asks while the section is already showing", async () => {
    render(<CollaborationSection />);
    await act(async () => {});
    expect(screen.queryByRole("heading", { name: enCollab.addServer.title })).not.toBeInTheDocument();
    act(() => useAddServerRequest.getState().ask(ADDRESS));
    expect(await screen.findByRole("textbox", { name: enCollab.addServer.addressLabel })).toHaveValue(ADDRESS);
  });
});
