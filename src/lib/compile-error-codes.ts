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
  "notebook.code_needed": () => i18n.t(($) => $.shell.codeExecution.needed),
  "notebook.code_skipped": () => i18n.t(($) => $.shell.codeExecution.skipped),
  "notebook.stored_results": () => i18n.t(($) => $.shell.codeExecution.storedResults),
  "notebook.quarto_needs_tex": () => i18n.t(($) => $.errors.notebook.quarto_needs_tex),
  "notebook.r_package_missing": () => i18n.t(($) => $.errors.notebook.r_package_missing),
  "notebook.jupyter_missing": () => i18n.t(($) => $.errors.notebook.jupyter_missing),
  "notebook.quarto_no_input": () => i18n.t(($) => $.errors.notebook.quarto_no_input),
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
