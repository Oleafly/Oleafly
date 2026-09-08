import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isEditorMutationLocked, registerEditorMutationOwner } from "./editor-mutation-lease";

const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: string }) => void>(),
  invoke: vi.fn(async () => {}),
  flush: vi.fn(async () => {}),
  projectId: "main-project" as string | null,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name, handler) => {
    mocks.events.set(name, handler);
    return () => mocks.events.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ projectId: mocks.projectId, flushForQuit: mocks.flush }) } }));
import { registerUpdateInstallGuard } from "./update-install-guard";

let stop: (() => void) | undefined;
let stopOwner: (() => void) | undefined;
const busy = vi.fn();
const emit = (event: string, token = "install-1") => mocks.events.get(event)?.({ payload: token });
beforeEach(async () => {
  mocks.projectId = "main-project";
  mocks.invoke.mockClear();
  mocks.flush.mockReset().mockResolvedValue(undefined);
  busy.mockClear();
  stop = await registerUpdateInstallGuard(busy);
});
afterEach(() => { stop?.(); stopOwner?.(); });

it("holds main-window editors locked until a durable flush and installation finish", async () => {
  let finish!: () => void;
  mocks.flush.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const ownerFlush = vi.fn(async () => {});
  stopOwner = registerEditorMutationOwner({ projectId: () => "main-project", flush: ownerFlush });
  emit("update-install-prepare");
  await vi.waitFor(() => expect(mocks.flush).toHaveBeenCalledOnce());
  expect(ownerFlush).toHaveBeenCalledOnce();
  expect(isEditorMutationLocked("main-project")).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalledWith("confirm_update_install", expect.anything());
  finish();
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("confirm_update_install", { token: "install-1", error: null }));
  expect(isEditorMutationLocked("main-project")).toBe(true);
  emit("update-install-finished", "unrelated");
  expect(isEditorMutationLocked("main-project")).toBe(true);
  emit("update-install-finished");
  expect(isEditorMutationLocked("main-project")).toBe(false);
});

it("rejects installation on a save failure and unlocks after native recovery", async () => {
  mocks.flush.mockRejectedValue(new Error("disk full"));
  emit("update-install-prepare");
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("confirm_update_install", { token: "install-1", error: "Error: disk full" }));
  expect(isEditorMutationLocked("main-project")).toBe(true);
  emit("update-install-finished");
  expect(isEditorMutationLocked("main-project")).toBe(false);
});

it("never confirms a late save after the native deadline cancelled the request", async () => {
  let finish!: () => void;
  mocks.flush.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  emit("update-install-prepare");
  await vi.waitFor(() => expect(mocks.flush).toHaveBeenCalledOnce());
  emit("update-install-finished");
  finish();
  await vi.waitFor(() => expect(isEditorMutationLocked("main-project")).toBe(false));
  await Promise.resolve();
  expect(mocks.invoke).not.toHaveBeenCalledWith("confirm_update_install", expect.anything());
});

it("rejects a project switch during the save", async () => {
  mocks.flush.mockImplementation(async () => { mocks.projectId = "other-project"; });
  emit("update-install-prepare");
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("confirm_update_install", { token: "install-1", error: expect.stringContaining("project changed") }));
  emit("update-install-finished");
  expect(isEditorMutationLocked("main-project")).toBe(false);
});
