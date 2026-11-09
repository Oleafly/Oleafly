// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { useVaultKey, vaultLoad, vaultQuery } from "./vault-loads";

describe("vaultLoad", () => {
  it("loads once per key and keeps the last two keys", async () => {
    const load = vi.fn(async () => load.mock.calls.length);
    expect(await vaultLoad(load, 1)).toBe(1);
    expect(await vaultLoad(load, 1)).toBe(1);
    expect(await vaultLoad(load, 2)).toBe(2);
    expect(await vaultLoad(load, 1)).toBe(1);
    expect(await vaultLoad(load, 3)).toBe(3);
    expect(await vaultLoad(load, 1)).toBe(4);
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe("vaultQuery", () => {
  it("shares a query within a revision and runs it again for a new one", async () => {
    const owner = {};
    const run = vi.fn(async () => run.mock.calls.length);
    expect(await vaultQuery(owner, 1, "a", run)).toBe(1);
    expect(await vaultQuery(owner, 1, "a", run)).toBe(1);
    expect(await vaultQuery(owner, 1, "b", run)).toBe(2);
    expect(await vaultQuery(owner, 2, "a", run)).toBe(3);
  });

  it("forgets failures and the oldest queries", async () => {
    const owner = {};
    const failing = vi.fn(() => Promise.reject(new Error("no")));
    await expect(vaultQuery(owner, 1, "x", failing)).rejects.toThrow("no");
    await Promise.resolve();
    await expect(vaultQuery(owner, 1, "x", failing)).rejects.toThrow("no");
    expect(failing).toHaveBeenCalledTimes(2);
    const run = vi.fn(async () => "ok");
    for (let index = 0; index <= 64; index += 1) await vaultQuery(owner, 1, `q${index}`, run);
    await vaultQuery(owner, 1, "q0", run);
    expect(run).toHaveBeenCalledTimes(66);
    await vaultQuery(owner, 1, "q64", run);
    expect(run).toHaveBeenCalledTimes(66);
  });
});

describe("useVaultKey", () => {
  const wrap = (value: Partial<NotesData>) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <NotesDataProvider value={value as NotesData}>{children}</NotesDataProvider>;
    };

  it("uses the revision and falls back to the note list", () => {
    const notes: NotesData["notes"] = [];
    expect(renderHook(() => useVaultKey(), { wrapper: wrap({ notes, revision: 7 }) }).result.current).toBe(7);
    expect(renderHook(() => useVaultKey(), { wrapper: wrap({ notes }) }).result.current).toBe(notes);
  });
});
