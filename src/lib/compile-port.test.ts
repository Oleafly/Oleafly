import { CompileStopped, type CompileTarget } from "@oleafly/compile-port";
import type { CompileResult } from "@oleafly/backend-port";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  cancelCompile: vi.fn(async () => true),
  compileProject: vi.fn<() => Promise<CompileResult>>(),
  readCompiledPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70]).buffer),
  synctexForward: vi.fn(async () => null),
  synctexInverse: vi.fn(async () => ({ file: "intro.tex", line: 4, column: 0 })),
}));
vi.mock("@/lib/tauri", () => tauri);

import { createDesktopCompilePort } from "./compile-port";

const target: CompileTarget = { mainDocument: "paper/main.tex", engine: "latex", texFlavor: "xelatex" };

function result(patch: Partial<CompileResult> = {}): CompileResult {
  return {
    ok: true,
    has_pdf: true,
    output_id: "o1",
    output_revision: 1,
    log: "log",
    errors: [],
    diagnostics: [],
    synctex_path: "/build/_oleafly_entry.synctex.gz",
    out_dir: "/build",
    compile_time_ms: 812,
    ...patch,
  };
}

describe("createDesktopCompilePort", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compiles the project folder and reads the PDF it wrote", async () => {
    tauri.compileProject.mockResolvedValue(result());
    const output = await createDesktopCompilePort("p1").compile(target);
    expect(tauri.compileProject).toHaveBeenCalledWith("p1", "paper/main.tex");
    expect(output).toMatchObject({ target, ok: true, log: "log", timeMs: 812, synctex: null });
    expect(output.pdf).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("reports a compile without a PDF", async () => {
    tauri.compileProject.mockResolvedValue(result({ ok: false, has_pdf: false, diagnostics: undefined }));
    const output = await createDesktopCompilePort("p1").compile(target);
    expect(output).toMatchObject({ ok: false, pdf: null, diagnostics: [] });
    expect(tauri.readCompiledPdf).not.toHaveBeenCalled();
  });

  it("turns a stopped compile into CompileStopped", async () => {
    tauri.compileProject.mockResolvedValue(result({ stopped: true }));
    await expect(createDesktopCompilePort("p1").compile(target)).rejects.toBeInstanceOf(CompileStopped);
  });

  it("cancels its running compile before the next and on stop, and nothing when idle", async () => {
    const port = createDesktopCompilePort("p1");
    port.stop();
    expect(tauri.cancelCompile).not.toHaveBeenCalled();
    let finish: (value: CompileResult) => void = () => {};
    tauri.compileProject.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const first = port.compile(target);
    port.stop();
    expect(tauri.cancelCompile).toHaveBeenCalledOnce();
    tauri.compileProject.mockResolvedValueOnce(result());
    const second = port.compile(target);
    await vi.waitFor(() => expect(tauri.cancelCompile).toHaveBeenCalledTimes(2));
    finish(result({ stopped: true }));
    await expect(first).rejects.toBeInstanceOf(CompileStopped);
    await expect(second).resolves.toMatchObject({ ok: true });
  });

  it("answers SyncTeX through the app for the main document it compiled", async () => {
    tauri.compileProject.mockResolvedValue(result());
    const port = createDesktopCompilePort("p1");
    const index = await port.syncTex(await port.compile(target));
    expect(await index?.inverse(2, 100, 200)).toEqual({ file: "intro.tex", line: 4, column: 0 });
    await index?.forward("intro.tex", 4);
    expect(tauri.synctexInverse).toHaveBeenCalledWith("p1", "paper/main.tex", 2, 100, 200);
    expect(tauri.synctexForward).toHaveBeenCalledWith("p1", "paper/main.tex", "intro.tex", 4);
    expect(await port.syncTex({ ...(await port.compile(target)), pdf: null })).toBeNull();
  });
});
