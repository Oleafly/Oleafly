import { i18n } from "@/i18n";
import { AppError, codedErrorText, describeError } from "@/lib/app-error";
import type { CompileError, TexBlocker } from "@/lib/tauri";

function shellEscapeParams() {
  return { setting: i18n.t(($) => $.shell.shellCommands.allow) };
}

type Explain = (params: Readonly<Record<string, string>>) => string;

function glyphParams(params: Readonly<Record<string, string>>) {
  return {
    count: Number(params.count ?? 0),
    sample: params.sample ?? "",
    font: params.font ?? "",
  };
}

function typstFontLabels() {
  return {
    availableFonts: i18n.t(($) => $.editor.documentSettings.availableFonts),
    bodyFont: i18n.t(($) => $.editor.typstSettings.fields.font),
    documentSettings: i18n.t(($) => $.editor.typstSettings.title),
    systemFonts: i18n.t(($) => $.shell.compile.typstFonts.systemFonts),
    standardBuild: i18n.t(($) => $.shell.compile.typstBuild.standard),
  };
}

const EXPLANATIONS: Readonly<Record<string, Explain>> = {
  "typst.unknown_variable": () => i18n.t(($) => $.errors.typst.unknown_variable),
  "typst.unknown_font": () => i18n.t(($) => $.errors.typst.unknown_font, typstFontLabels()),
  "typst.file_not_found": () => i18n.t(($) => $.errors.typst.file_not_found),
  "typst.wrong_type": (params) =>
    i18n.t(($) => $.errors.typst.wrong_type, {
      expected: params.expected ?? "",
      found: params.found ?? "",
    }),
  "typst.label_missing": () => i18n.t(($) => $.errors.typst.label_missing),
  "typst.citation_missing": () => i18n.t(($) => $.errors.typst.citation_missing),
  "typst.cyclic_import": () => i18n.t(($) => $.errors.typst.cyclic_import),
  "typst.show_rule_depth": () => i18n.t(($) => $.errors.typst.show_rule_depth),
  "typst.unclosed": () => i18n.t(($) => $.errors.typst.unclosed),
  "typst.not_converged": () => i18n.t(($) => $.errors.typst.not_converged),
  "typst.placeholder_glyphs": () =>
    i18n.t(($) => $.errors.typst.placeholder_glyphs, typstFontLabels()),
  "typst.missing_glyphs": (params) =>
    i18n.t(($) => $.errors.typst.missing_glyphs, { sample: params.sample ?? "" }),
  "typst.missing_glyphs_pack": (params) =>
    i18n.t(($) => $.errors.typst.missing_glyphs_pack, { sample: params.sample ?? "" }),
  "typst.missing_glyphs_sealed": (params) =>
    i18n.t(($) => $.errors.typst.missing_glyphs_sealed, {
      ...typstFontLabels(),
      sample: params.sample ?? "",
    }),
  "markdown.missing_glyphs": (params) =>
    i18n.t(($) => $.errors.markdown.missing_glyphs, {
      count: Number(params.count ?? 0),
      sample: params.sample ?? "",
    }),
  "markdown.image_unsupported": (params) =>
    i18n.t(($) => $.errors.markdown.image_unsupported, { path: params.path ?? "" }),
  "markdown.image_conversion_failed": (params) =>
    i18n.t(($) => $.errors.markdown.image_conversion_failed, { path: params.path ?? "" }),
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
  "notebook.r_missing": () => i18n.t(($) => $.errors.notebook.r_missing),
  "notebook.python_missing": () => i18n.t(($) => $.errors.notebook.python_missing),
  "notebook.jupyter_missing": (params) =>
    params.command
      ? i18n.t(($) => $.errors.notebook.jupyter_missing_command, { command: params.command })
      : i18n.t(($) => $.errors.notebook.jupyter_missing),
  "notebook.chrome_missing": () => i18n.t(($) => $.errors.notebook.chrome_missing),
  "notebook.julia_not_run": () => i18n.t(($) => $.errors.notebook.julia_not_run),
  "notebook.quarto_no_input": () => i18n.t(($) => $.errors.notebook.quarto_no_input),
  "notebook.not_project_input": () => i18n.t(($) => $.errors.notebook.not_project_input),
  "notebook.missing_glyphs": (params) =>
    i18n.t(($) => $.errors.notebook.missing_glyphs, {
      count: Number(params.count ?? 0),
      sample: params.sample ?? "",
    }),
  "notebook.missing_glyphs_cjk": (params) =>
    i18n.t(($) => $.errors.notebook.missing_glyphs_cjk, glyphParams(params)),
  "notebook.calepin_needs_typst": () => i18n.t(($) => $.errors.notebook.calepin_needs_typst),
  "notebook.calepin_chunk_skipped": () => i18n.t(($) => $.errors.notebook.calepin_chunk_skipped),
  "notebook.calepin_needs_jupyter": (params) =>
    i18n.t(($) => $.errors.notebook.calepin_needs_jupyter, { command: params.command ?? "" }),
  "compile.timed_out": (params) =>
    i18n.t(($) => $.errors.compile.timed_out, { minutes: params.minutes ?? "" }),
  "compile.timed_out_downloading": (params) =>
    i18n.t(($) => $.errors.compile.timed_out_downloading, { minutes: params.minutes ?? "" }),
  "notebook.timed_out": (params) =>
    i18n.t(($) => $.errors.notebook.timed_out, { minutes: params.minutes ?? "" }),
  "tex.bib_syntax": () => i18n.t(($) => $.errors.tex.bib_syntax),
  "compile.no_diagnostic": (params) =>
    i18n.t(($) => $.errors.compile.no_diagnostic, { line: params.line ?? "" }),
  "compile.no_output": () => i18n.t(($) => $.errors.compile.no_output),
  "tex.latexmk_needs_perl": () => i18n.t(($) => $.errors.tex.latexmk_needs_perl),
  "tex.compiler_missing": (params) =>
    i18n.t(($) => $.errors.tex.compiler_missing, { compiler: params.compiler ?? "" }),
  "tex.compiler_missing_command": (params) =>
    i18n.t(($) => $.errors.tex.compiler_missing_command, {
      compiler: params.compiler ?? "",
      command: params.command ?? "",
    }),
  "tex.biber_missing": () => i18n.t(($) => $.errors.tex.biber_missing),
  "tex.biber_missing_command": (params) =>
    i18n.t(($) => $.errors.tex.biber_missing_command, { command: params.command ?? "" }),
  "tex.tool_missing": (params) =>
    i18n.t(($) => $.errors.tex.tool_missing, { tool: params.tool ?? "" }),
  "tex.index_needs_latexmk": () => i18n.t(($) => $.errors.tex.index_needs_latexmk),
  "tex.glossary_needs_latexmk": () => i18n.t(($) => $.errors.tex.glossary_needs_latexmk),
  "tex.glossary_not_built": () => i18n.t(($) => $.errors.tex.glossary_not_built),
  "tex.jobname_bibliography": () => i18n.t(($) => $.errors.tex.jobname_bibliography),
  "tex.needs_unicode_engine": (params) =>
    i18n.t(($) => $.errors.tex.needs_unicode_engine, { label: params.label ?? "" }),
  "tex.input_relative_to_main": (params) =>
    i18n.t(($) => $.errors.tex.input_relative_to_main, {
      suggestion: params.suggestion ?? "",
      folder: params.folder ?? "",
    }),
  "tex.bibliography_above_main": (params) =>
    i18n.t(($) => $.errors.tex.bibliography_above_main, {
      file: params.file ?? "",
      command: params.command ?? "",
    }),
  "tex.latexmk_biber_mismatch": () => i18n.t(($) => $.errors.tex.latexmk_biber_mismatch),
  "tex.bibtex_folder_brace": () => i18n.t(($) => $.errors.tex.bibtex_folder_brace),
  "tex.missing_characters": (params) =>
    i18n.t(($) => $.errors.tex.missing_characters, { sample: params.sample ?? "" }),
  "tex.missing_characters_cjk": (params) =>
    i18n.t(($) => $.errors.tex.missing_characters_cjk, { sample: params.sample ?? "" }),
  "tex.missing_characters_cjk_package": (params) =>
    i18n.t(($) => $.errors.tex.missing_characters_cjk_package, { sample: params.sample ?? "" }),
  "tex.compiler_crashed": () => i18n.t(($) => $.errors.tex.compiler_crashed),
  "tex.compiler_crashed_font": (params) =>
    i18n.t(($) => $.errors.tex.compiler_crashed_font, { font: params.font ?? "" }),
  "tex.t1_fontenc_unicode_engine": () => i18n.t(($) => $.errors.tex.t1_fontenc_unicode_engine),
  "tex.font_in_bundle": (params) =>
    i18n.t(($) => $.errors.tex.font_in_bundle, {
      font: params.font ?? "",
      file: params.file ?? "",
    }),
  "tex.font_download_prompt": () => i18n.t(($) => $.errors.tex.font_download_prompt),
  "tex.explain.font_metrics_missing": (params) =>
    i18n.t(($) => $.errors.tex.explain.font_metrics_missing, { font: params.font ?? "" }),
};

export const TEX_SETUP_CODES: ReadonlySet<string> = new Set([
  "tex.latexmk_missing",
  "tex.latexmk_not_in_distribution",
  "tex.latexmk_not_in_distribution_command",
  "tex.latexmk_needs_perl",
  "tex.compiler_missing",
  "tex.compiler_missing_command",
  "tex.biber_missing",
  "tex.biber_missing_command",
  "tex.tool_missing",
]);

export function describeTexBlocker(blocker: TexBlocker): string {
  return describeError(new AppError(blocker.code, blocker.params, null));
}

export function texSetupReason(errors: readonly CompileError[]): string | null {
  const gap = errors.find((error) => error.code && TEX_SETUP_CODES.has(error.code));
  return gap?.explanation ?? null;
}

function explanationFor(error: CompileError): string | null {
  if (!error.code) return null;
  const params = error.params ?? {};
  const explain = EXPLANATIONS[error.code];
  return explain ? explain(params) : codedErrorText(error.code, params);
}

export function explainCodedCompileErrors(errors: readonly CompileError[]): CompileError[] {
  return errors.map((error) => {
    const explanation = explanationFor(error);
    return explanation === null ? error : { ...error, explanation };
  });
}

const LOG_NOTES: readonly (readonly [RegExp, string, readonly string[]])[] = [
  [/^No bib entry found for '(.+)'$/, "tex.explain.biber_no_entry", ["entry"]],
  [
    /^Biber could not find (.+)\. Check the file name in \\addbibresource and that the file is in the project\.$/,
    "tex.explain.biber_file_missing",
    ["file"],
  ],
  [
    /^Biber and biblatex versions do not match \(control file ([^,]+), expected ([^)]+)\)\. /,
    "tex.explain.biber_version_mismatch",
    ["found", "expected"],
  ],
  [/^Bibliography needs Biber \(biblatex\)\. If citations stay undefined, /, "tex.explain.biber_needs_run", []],
  [
    /^The compile could not open (.+)\. Check the file name and that the file is in the project\.$/,
    "tex.explain.file_not_opened",
    ["file"],
  ],
  [/^Cannot find citation `(.+)`\.$/, "tex.explain.citation_missing", ["name"]],
  [/^Cannot find reference `(.+)`\.$/, "tex.explain.reference_missing", ["name"]],
];

export function translatedLogNote(message: string): string {
  for (const [pattern, code, names] of LOG_NOTES) {
    const found = pattern.exec(message);
    if (!found) continue;
    const params = Object.fromEntries(names.map((name, index) => [name, found[index + 1]]));
    return codedErrorText(code, params) ?? message;
  }
  return message;
}
