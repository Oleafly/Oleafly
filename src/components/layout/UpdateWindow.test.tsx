// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUpdate: vi.fn(), installUpdate: vi.fn(), close: vi.fn(), invoke: vi.fn(),
  open: vi.fn(), celebrate: vi.fn(), logError: vi.fn(),
}));
vi.mock("@/lib/updater", () => ({ findUpdate: mocks.findUpdate, installUpdate: mocks.installUpdate }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: mocks.close }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.open }));
vi.mock("@/lib/confetti", () => ({ celebrate: mocks.celebrate }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/tauri", () => ({ appVersion: async () => "0.4.0" }));
vi.mock("@/components/ui/markdown", () => ({ Markdown: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { UpdateWindow } from "./UpdateWindow";

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/?manual=1");
  mocks.invoke.mockResolvedValue(true);
  mocks.findUpdate.mockResolvedValue({ version: "0.4.1", currentVersion: "0.4.0", body: "Release notes" });
  mocks.close.mockResolvedValue(undefined);
  mocks.logError.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

it("keeps installation single-flight and restores close controls after failure", async () => {
  let fail!: (error: Error) => void;
  let progress!: (percent: number) => void;
  mocks.installUpdate.mockImplementation((_update, onProgress) => {
    progress = onProgress;
    return new Promise((_resolve, reject) => { fail = reject; });
  });
  render(<UpdateWindow />);
  const install = await screen.findByRole("button", { name: "Update now" });
  act(() => { fireEvent.click(install); fireEvent.click(install); });
  expect(mocks.installUpdate).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  act(() => progress(100));
  expect(screen.getByText("Installing…")).toBeInTheDocument();
  await act(async () => fail(new Error("save failed")));
  expect(await screen.findByText("Error: save failed")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("reports an up-to-date manual check without closing the window", async () => {
  mocks.findUpdate.mockResolvedValue(null);
  render(<UpdateWindow />);
  expect(await screen.findByText("Oleafly v0.4.0 is the latest version")).toBeInTheDocument();
  expect(mocks.close).not.toHaveBeenCalled();
  // The status text commits before the passive celebration effect runs.
  await waitFor(() => expect(mocks.celebrate).toHaveBeenCalledOnce());
});

it("closes an automatic check when no update is available", async () => {
  window.history.replaceState({}, "", "/");
  mocks.findUpdate.mockResolvedValue(null);
  render(<UpdateWindow />);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
});

it("shows check errors with a route to the release download", async () => {
  mocks.findUpdate.mockRejectedValue(new Error("service unavailable"));
  render(<UpdateWindow />);
  expect(await screen.findByText("Error: service unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View release" }));
  expect(mocks.open).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly/releases/latest");
  expect(mocks.installUpdate).not.toHaveBeenCalled();
});

it("offers a download for package installations that cannot update in place", async () => {
  mocks.invoke.mockResolvedValue(false);
  render(<UpdateWindow />);
  const download = await screen.findByRole("button", { name: "View release" });
  expect(screen.queryByRole("button", { name: "Update now" })).not.toBeInTheDocument();
  fireEvent.click(download);
  expect(mocks.open).toHaveBeenCalledOnce();
});
