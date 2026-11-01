import type { CompileOutput } from "@oleafly/compile-port";
import type { CollabOutputInfo } from "../protocol";
import type { WebState } from "../store";

export function outputKey(info: CollabOutputInfo | undefined): string | null {
  return info ? `${info.compiledAt}:${info.size}:${info.compiledBy}` : null;
}

export function sharedOutputs(items: readonly CollabOutputInfo[]) {
  const pdf = items.find((item) => item.kind === "pdf");
  const synctex = items.find((item) => item.kind === "synctex");
  return { pdf, synctex: pdf && synctex && synctex.compiledAt >= pdf.compiledAt ? synctex : undefined };
}

export function shownLocal(state: Pick<WebState, "compile">): CompileOutput | null {
  return state.compile.shown === "local" && state.compile.output?.pdf ? state.compile.output : null;
}

export function shownHasSyncTex(state: Pick<WebState, "compile" | "output">): boolean {
  const local = shownLocal(state);
  return local ? local.synctex !== null : sharedOutputs(state.output).synctex !== undefined;
}
