import type { CompileOutput } from "@oleafly/compile-port";
import type { CollabOutputInfo } from "../protocol";
import type { WebState } from "../store";

export function outputKey(info: CollabOutputInfo | undefined): string | null {
  return info ? `${info.compiledAt}:${info.size}:${info.compiledBy}` : null;
}

/** The project's shared PDF, and its SyncTeX when that came from the same compile. */
export function sharedOutputs(items: readonly CollabOutputInfo[]) {
  const pdf = items.find((item) => item.kind === "pdf");
  const synctex = items.find((item) => item.kind === "synctex");
  return { pdf, synctex: pdf && synctex && synctex.compiledAt >= pdf.compiledAt ? synctex : undefined };
}

/** This browser's compile, when its PDF is the one on screen. */
export function shownLocal(state: Pick<WebState, "compile">): CompileOutput | null {
  return state.compile.shown === "local" && state.compile.output?.pdf ? state.compile.output : null;
}

/** Whether the PDF on screen has SyncTeX to click through. */
export function shownHasSyncTex(state: Pick<WebState, "compile" | "output">): boolean {
  const local = shownLocal(state);
  return local ? local.synctex !== null : sharedOutputs(state.output).synctex !== undefined;
}
