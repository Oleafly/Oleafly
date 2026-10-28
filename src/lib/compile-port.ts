import { type CompilePort, CompileStopped } from "@oleafly/compile-port";
import { cancelCompile, compileProject, readCompiledPdf, synctexForward, synctexInverse } from "@/lib/tauri";

/**
 * The desktop behind the shared compile contract. Rust compiles the project
 * folder with the engine and flavour stored in the project, so the target only
 * names the main document, and SyncTeX stays on disk next to the build.
 */
export function createDesktopCompilePort(projectId: string): CompilePort {
  let running = 0;
  return {
    supports: (target) => target.engine !== "unknown",
    async compile(target) {
      if (running > 0) await cancelCompile();
      running += 1;
      try {
        const result = await compileProject(projectId, target.mainDocument);
        if (result.stopped) throw new CompileStopped();
        const pdf = result.has_pdf ? new Uint8Array(await readCompiledPdf(projectId)) : null;
        return {
          target,
          ok: result.ok,
          pdf,
          synctex: null,
          log: result.log,
          diagnostics: result.diagnostics ?? [],
          timeMs: result.compile_time_ms,
        };
      } finally {
        running -= 1;
      }
    },
    stop() {
      if (running > 0) void cancelCompile();
    },
    async syncTex(output) {
      if (!output.pdf) return null;
      const main = output.target.mainDocument;
      return {
        forward: (file, line) => synctexForward(projectId, main, file, line),
        inverse: (page, x, y) => synctexInverse(projectId, main, page, x, y),
        dispose: () => {},
      };
    },
  };
}
