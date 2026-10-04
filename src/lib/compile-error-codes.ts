import { i18n } from "@/i18n";
import type { CompileError } from "@/lib/tauri";

function shellEscapeParams() {
  return { setting: i18n.t(($) => $.shell.shellCommands.allow) };
}

const EXPLANATIONS: Readonly<Record<string, () => string>> = {
  "tex.shell_escape_denied_minted": () =>
    i18n.t(($) => $.errors.tex.shell_escape_denied_minted, shellEscapeParams()),
  "tex.shell_escape_denied_pythontex": () =>
    i18n.t(($) => $.errors.tex.shell_escape_denied_pythontex, shellEscapeParams()),
  "tex.shell_escape_denied_command": () =>
    i18n.t(($) => $.errors.tex.shell_escape_denied_command, shellEscapeParams()),
};

export function explainCodedCompileErrors(errors: readonly CompileError[]): CompileError[] {
  return errors.map((error) => {
    const explain = error.code ? EXPLANATIONS[error.code] : undefined;
    return explain ? { ...error, explanation: explain() } : error;
  });
}
