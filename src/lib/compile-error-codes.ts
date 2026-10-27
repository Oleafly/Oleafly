import { i18n } from "@/i18n";
import type { CompileError } from "@/lib/tauri";

function shellEscapeParams() {
  return { setting: i18n.t(($) => $.shell.shellCommands.allow) };
}

type Explain = (params: Readonly<Record<string, string>>) => string;

const EXPLANATIONS: Readonly<Record<string, Explain>> = {
  "tex.shell_escape_denied_minted": () =>
    i18n.t(($) => $.errors.tex.shell_escape_denied_minted, shellEscapeParams()),
  "tex.shell_escape_denied_pythontex": () =>
    i18n.t(($) => $.errors.tex.shell_escape_denied_pythontex, shellEscapeParams()),
  "tex.shell_escape_denied_command": () =>
    i18n.t(($) => $.errors.tex.shell_escape_denied_command, shellEscapeParams()),
  "tex.compiler_crashed": () => i18n.t(($) => $.errors.tex.compiler_crashed),
  "tex.compiler_crashed_font": (params) =>
    i18n.t(($) => $.errors.tex.compiler_crashed_font, { font: params.font ?? "" }),
};

export function explainCodedCompileErrors(errors: readonly CompileError[]): CompileError[] {
  return errors.map((error) => {
    const explain = error.code ? EXPLANATIONS[error.code] : undefined;
    return explain ? { ...error, explanation: explain(error.params ?? {}) } : error;
  });
}
