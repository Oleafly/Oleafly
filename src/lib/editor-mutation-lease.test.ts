import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireEditorMutationLease,
  isEditorMutationLocked,
  registerEditorMutationOwner,
  type EditorMutationOwner,
} from "./editor-mutation-lease";

const cleanups: Array<() => void> = [];

function owner(projectId: string | null, overrides: Partial<EditorMutationOwner> = {}) {
  const value = {
    projectId: () => projectId,
    setLocked: vi.fn(),
    flush: vi.fn(async () => {}),
    reconcile: vi.fn(async () => {}),
    ...overrides,
  };
  cleanups.push(registerEditorMutationOwner(value));
  return value;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("editor mutation lease", () => {
  it("locks the project's editors, flushes and reconciles them, and unlocks on release", async () => {
    const mine = owner("p1");
    const other = owner("p2");
    const lease = acquireEditorMutationLease("p1");
    expect(isEditorMutationLocked("p1")).toBe(true);
    expect(isEditorMutationLocked("p2")).toBe(false);
    expect(isEditorMutationLocked(null)).toBe(false);
    expect(mine.setLocked).toHaveBeenCalledWith(true);
    expect(other.setLocked).not.toHaveBeenCalled();
    await lease.flush();
    await lease.reconcile();
    expect(mine.flush).toHaveBeenCalledOnce();
    expect(mine.reconcile).toHaveBeenCalledOnce();
    expect(other.flush).not.toHaveBeenCalled();
    lease.assertActive();
    lease.release();
    lease.release();
    expect(mine.setLocked).toHaveBeenLastCalledWith(false);
    expect(mine.setLocked).toHaveBeenCalledTimes(2);
    expect(() => lease.assertActive()).toThrow("The project update was interrupted before it started.");
    expect(isEditorMutationLocked("p1")).toBe(false);
  });

  it("allows only one lease at a time", () => {
    const lease = acquireEditorMutationLease("p1");
    expect(() => acquireEditorMutationLease("p2")).toThrow("Another project update is still in progress.");
    lease.release();
    acquireEditorMutationLease("p2").release();
  });

  it("locks an editor that registers while its project is being updated and unlocks it when it leaves", () => {
    const lease = acquireEditorMutationLease("p1");
    const late = { projectId: () => "p1", setLocked: vi.fn() };
    const unregister = registerEditorMutationOwner(late);
    expect(late.setLocked).toHaveBeenCalledWith(true);
    unregister();
    expect(late.setLocked).toHaveBeenLastCalledWith(false);
    unregister();
    expect(late.setLocked).toHaveBeenCalledTimes(2);
    lease.release();
    expect(late.setLocked).toHaveBeenCalledTimes(2);
  });

  it("rejects an editor whose lock fails while registering during an update", async () => {
    const lease = acquireEditorMutationLease("p1");
    const broken = { projectId: () => "p1", setLocked: vi.fn(() => { throw new Error("cannot lock"); }), flush: vi.fn() };
    expect(() => registerEditorMutationOwner(broken)).toThrow("cannot lock");
    await lease.flush();
    expect(broken.flush).not.toHaveBeenCalled();
    lease.release();
  });

  it("releases every lock when locking one editor fails, ignoring unlock failures", () => {
    const first = owner("p1", { setLocked: vi.fn((locked: boolean) => { if (!locked) throw new Error("unlock failed"); }) });
    owner("p1", { setLocked: vi.fn(() => { throw new Error("lock failed"); }) });
    expect(() => acquireEditorMutationLease("p1")).toThrow("lock failed");
    expect(first.setLocked).toHaveBeenLastCalledWith(false);
    expect(isEditorMutationLocked("p1")).toBe(false);
  });

  it("tolerates owners without lock, flush or reconcile hooks and a failing unlock on unregister", async () => {
    owner("p1", { setLocked: undefined, flush: undefined, reconcile: undefined });
    const lease = acquireEditorMutationLease("p1");
    const failing = { projectId: () => "p1", setLocked: vi.fn((locked: boolean) => { if (!locked) throw new Error("gone"); }) };
    const unregister = registerEditorMutationOwner(failing);
    expect(() => unregister()).not.toThrow();
    await expect(lease.flush()).resolves.toBeUndefined();
    await expect(lease.reconcile()).resolves.toBeUndefined();
    lease.release();
  });
});
