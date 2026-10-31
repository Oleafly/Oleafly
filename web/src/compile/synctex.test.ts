import { describe, expect, it, vi } from "vitest";
import { type SyncTexModule, SyncTexError } from "../synctex";
import { syncTexEngine, syncTexOpener } from "./synctex";

function engine(open: SyncTexModule["open"], mapLine: SyncTexModule["mapLine"] = () => null): SyncTexModule {
  return { open, mapLine };
}

const index = { forward: () => null, inverse: () => ({ file: "main.tex", line: 3, column: 0 }), dispose: vi.fn() };

describe("syncTexOpener", () => {
  it("loads the module once and answers through it", async () => {
    const load = vi.fn(async () => engine(() => index));
    const open = syncTexOpener(load);
    const first = await open(new Uint8Array([1]), ["main.tex"]);
    await open(new Uint8Array([2]), ["main.tex"]);
    expect(load).toHaveBeenCalledOnce();
    expect(await first.inverse(1, 2, 3)).toEqual({ file: "main.tex", line: 3, column: 0 });
    first.dispose();
    expect(index.dispose).toHaveBeenCalledOnce();
  });

  it("loads again after a failed load or a crash", async () => {
    const crashed = engine(() => {
      throw new SyncTexError("crashed", "trapped");
    });
    const load = vi
      .fn<() => Promise<SyncTexModule>>()
      .mockRejectedValueOnce(new SyncTexError("load-failed", "offline"))
      .mockResolvedValueOnce(crashed)
      .mockResolvedValue(engine(() => index));
    const open = syncTexOpener(load);
    await expect(open(new Uint8Array([1]), [])).rejects.toMatchObject({ code: "load-failed" });
    await expect(open(new Uint8Array([1]), [])).resolves.toBeDefined();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("passes other refusals on without reloading", async () => {
    const load = vi.fn(async () =>
      engine(() => {
        throw new SyncTexError("file-too-large", "too large");
      }),
    );
    const open = syncTexOpener(load);
    await expect(open(new Uint8Array([1]), [])).rejects.toMatchObject({ code: "file-too-large" });
    expect(load).toHaveBeenCalledOnce();
  });

  it("maps lines through the same module, loading it once", async () => {
    const mapLine = vi.fn(() => ({ line: 4, exact: false }));
    const load = vi.fn(async () => engine(() => index, mapLine));
    const shared = syncTexEngine(load);
    await expect(shared.mapLine("a", "b", 2, true)).resolves.toEqual({ line: 4, exact: false });
    await shared.open(new Uint8Array([1]), ["main.tex"]);
    expect(mapLine).toHaveBeenCalledWith("a", "b", 2, true);
    expect(load).toHaveBeenCalledOnce();
  });
});
