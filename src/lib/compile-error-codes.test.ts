import { describe, expect, it } from "vitest";
import enErrors from "@/i18n/locales/en/errors.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { parseLatexLog } from "@oleafly/latex";
import { i18n } from "@/i18n";
import {
  describeTexBlocker,
  explainCodedCompileErrors,
  TEX_SETUP_CODES,
  texSetupReason,
  translatedLogNote,
} from "./compile-error-codes";

const warning = (code: string | undefined) => ({
  line: null,
  file: null,
  message: "From the engine",
  kind: "warning",
  explanation: null,
  code,
});

describe("explainCodedCompileErrors", () => {
  it("translates Typst explanations and fills in the labels on screen", () => {
    const coded = (code: string, params: Record<string, string> = {}) => ({ ...warning(code), params });
    const [variable, font, type, placeholder, sealed, pack, plain] = explainCodedCompileErrors([
      coded("typst.unknown_variable"),
      coded("typst.unknown_font"),
      coded("typst.wrong_type", { expected: "length", found: "integer" }),
      coded("typst.placeholder_glyphs"),
      coded("typst.missing_glyphs_sealed", { sample: "한 글" }),
      coded("typst.missing_glyphs_pack", { sample: "한 글", pack: "typst-cjk" }),
      coded("typst.package"),
    ]);
    expect(variable.explanation).toBe(enErrors.typst.unknown_variable);
    expect(font.explanation).toContain("Available fonts under Body font in Document settings");
    expect(font.explanation).toContain("If Use system fonts is off");
    expect(type.explanation).toBe("This value has the wrong type. Typst expected length but found integer.");
    expect(placeholder.explanation).toContain("under Body font in Document settings");
    expect(sealed.explanation).toContain("한 글");
    expect(sealed.explanation).toContain("Use system fonts and Standard build");
    expect(pack.explanation).toContain("Download the font pack");
    expect(plain.explanation).toBeNull();
    for (const error of [font, type, placeholder, sealed, pack]) {
      expect(error.explanation).not.toContain("{{");
    }
  });

  it("explains why Quarto and Calepin did not run code", () => {
    const [skipped, stored, needed, plain] = explainCodedCompileErrors([
      warning("notebook.code_skipped"),
      warning("notebook.stored_results"),
      warning("notebook.code_needed"),
      warning(undefined),
    ]);
    expect(skipped.explanation).toBe(enShell.codeExecution.skipped);
    expect(stored.explanation).toBe(enShell.codeExecution.storedResults);
    expect(needed.explanation).toBe(enShell.codeExecution.needed);
    expect(plain.explanation).toBeNull();
    expect(skipped.message).toBe("From the engine");
  });

  it("explains why a compile or notebook was stopped and a bad .bib", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const [downloading, notebook, bib] = explainCodedCompileErrors([
      coded("compile.timed_out_downloading", { minutes: "30" }),
      coded("notebook.timed_out", { minutes: "60" }),
      coded("tex.bib_syntax", {}),
    ]);
    expect(downloading.explanation).toBe(
      enErrors.compile.timed_out_downloading.replace("{{minutes}}", "30"),
    );
    expect(notebook.explanation).toBe(enErrors.notebook.timed_out.replace("{{minutes}}", "60"));
    expect(bib.explanation).toBe(enErrors.tex.bib_syntax);
  });

  it("explains missing notebook tools and fills in the command this system needs", () => {
    const coded = (code: string, params: Record<string, string> = {}) => ({ ...warning(code), params });
    const [r, python, chrome, julia, input, jupyter, jupyterClient, typst, chunk] = explainCodedCompileErrors([
      coded("notebook.r_missing"),
      coded("notebook.python_missing"),
      coded("notebook.chrome_missing"),
      coded("notebook.julia_not_run"),
      coded("notebook.not_project_input"),
      coded("notebook.jupyter_missing", { command: "py -m pip install jupyter" }),
      coded("notebook.calepin_needs_jupyter", { command: "python -m pip install jupyter_client" }),
      coded("notebook.calepin_needs_typst"),
      coded("notebook.calepin_chunk_skipped"),
    ]);
    expect(r.explanation).toBe(enErrors.notebook.r_missing);
    expect(python.explanation).toBe(enErrors.notebook.python_missing);
    expect(chrome.explanation).toBe(enErrors.notebook.chrome_missing);
    expect(julia.explanation).toBe(enErrors.notebook.julia_not_run);
    expect(input.explanation).toBe(enErrors.notebook.not_project_input);
    expect(jupyter.explanation).toBe(
      enErrors.notebook.jupyter_missing_command.replace("{{command}}", "py -m pip install jupyter"),
    );
    expect(jupyterClient.explanation).toBe(
      enErrors.notebook.calepin_needs_jupyter.replace("{{command}}", "python -m pip install jupyter_client"),
    );
    expect(typst.explanation).toBe(enErrors.notebook.calepin_needs_typst);
    expect(chunk.explanation).toBe(enErrors.notebook.calepin_chunk_skipped);
  });

  it("gives Quarto one card for missing characters and names a font for CJK text", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const [plain, korean, one] = explainCodedCompileErrors([
      coded("notebook.missing_glyphs", { count: "3", sample: "Ω Ψ Φ" }),
      coded("notebook.missing_glyphs_cjk", { count: "2", sample: "한 글", font: "UnBatang.ttf" }),
      coded("notebook.missing_glyphs_cjk", { count: "1", sample: "数", font: "FandolSong-Regular.otf" }),
    ]);
    expect(plain.explanation).toBe(
      enErrors.notebook.missing_glyphs_other.replace("{{count}}", "3").replace("{{sample}}", "Ω Ψ Φ"),
    );
    expect(korean.explanation).toContain("CJKmainfont: UnBatang.ttf and pdf-engine: tectonic");
    expect(korean.explanation).toContain("2 characters, such as 한 글");
    expect(one.explanation).toContain("A character, 数,");
    expect(one.explanation).toContain("CJKmainfont: FandolSong-Regular.otf");
  });

  it("explains an index, a compiler, a nested path and a Biber clash", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const explained = explainCodedCompileErrors([
      coded("tex.index_needs_latexmk", {}),
      coded("tex.glossary_needs_latexmk", {}),
      coded("tex.glossary_not_built", {}),
      coded("tex.jobname_bibliography", {}),
      coded("tex.needs_unicode_engine", { compiler: "xelatex", label: "XeLaTeX" }),
      coded("tex.input_relative_to_main", {
        file: "sections/intro.tex",
        folder: "paper",
        suggestion: "paper/sections/intro.tex",
      }),
      coded("tex.latexmk_biber_mismatch", {}),
    ]);
    expect(explained.map((error) => error.explanation)).toEqual([
      enErrors.tex.index_needs_latexmk,
      enErrors.tex.glossary_needs_latexmk,
      enErrors.tex.glossary_not_built,
      enErrors.tex.jobname_bibliography,
      enErrors.tex.needs_unicode_engine.replaceAll("{{label}}", "XeLaTeX"),
      enErrors.tex.input_relative_to_main
        .replace("{{suggestion}}", "paper/sections/intro.tex")
        .replace("{{folder}}", "paper"),
      enErrors.tex.latexmk_biber_mismatch,
    ]);
  });

  it("shows the spelling BibTeX can read for a path above the build folder", () => {
    const [explained] = explainCodedCompileErrors([
      {
        ...warning("tex.bibliography_above_main"),
        params: { file: "../refs.bib", command: "\\bibliography{refs}" },
      },
    ]);
    expect(explained.explanation).toBe(
      enErrors.tex.bibliography_above_main
        .replace("{{file}}", "../refs.bib")
        .replace("{{command}}", "\\bibliography{refs}"),
    );
    expect(explained.explanation).toContain("\\bibliography{refs}");
  });

  it("gives Markdown one card for missing characters and names images it can't use", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const [many, one, image, failed] = explainCodedCompileErrors([
      coded("markdown.missing_glyphs", { count: "12", sample: "한 😀" }),
      coded("markdown.missing_glyphs", { count: "1", sample: "😀" }),
      coded("markdown.image_unsupported", { path: "figs/t.tiff" }),
      coded("markdown.image_conversion_failed", { path: "figs/s.svg" }),
    ]);
    expect(many.explanation).toBe(
      enErrors.markdown.missing_glyphs_other.replace("{{count}}", "12").replace("{{sample}}", "한 😀"),
    );
    expect(one.explanation).toBe(enErrors.markdown.missing_glyphs_one.replace("{{sample}}", "😀"));
    expect(image.explanation).toBe(enErrors.markdown.image_unsupported.replace("{{path}}", "figs/t.tiff"));
    expect(failed.explanation).toBe(enErrors.markdown.image_conversion_failed.replace("{{path}}", "figs/s.svg"));
    expect(many.message).toBe("From the engine");
  });

  it("names a lost character in a translatable explanation", () => {
    for (const code of ["missing_characters", "missing_characters_cjk", "missing_characters_cjk_package"] as const) {
      const [explained] = explainCodedCompileErrors([
        { ...warning(`tex.${code}`), params: { sample: "大 綱" } },
      ]);
      expect(explained.explanation).toBe(enErrors.tex[code].replace("{{sample}}", "大 綱"));
    }
  });

  it("explains the T1 warning, a bundled font and a font download prompt", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const [t1, bundled, download] = explainCodedCompileErrors([
      coded("tex.t1_fontenc_unicode_engine", {}),
      coded("tex.font_in_bundle", { font: "UnBatang", file: "UnBatang.ttf" }),
      coded("tex.font_download_prompt", {}),
    ]);
    expect(t1.explanation).toBe(enErrors.tex.t1_fontenc_unicode_engine);
    expect(bundled.explanation).toBe(
      enErrors.tex.font_in_bundle.replace("{{font}}", "UnBatang").replace("{{file}}", "UnBatang.ttf"),
    );
    expect(download.explanation).toBe(enErrors.tex.font_download_prompt);
  });

  it("explains why BibTeX can't read a folder with a lone brace", () => {
    const [explained] = explainCodedCompileErrors([warning("tex.bibtex_folder_brace")]);
    expect(explained.explanation).toBe(enErrors.tex.bibtex_folder_brace);
  });

  it("translates the cards for failures that printed no error line", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const [timedOut, noDiagnostic, noOutput] = explainCodedCompileErrors([
      coded("compile.timed_out", { minutes: "5" }),
      coded("compile.no_diagnostic", { line: "sh: 1: xelatex: not found" }),
      coded("compile.no_output", {}),
    ]);
    expect(timedOut.explanation).toBe(enErrors.compile.timed_out.replace("{{minutes}}", "5"));
    expect(noDiagnostic.explanation).toBe(
      enErrors.compile.no_diagnostic.replace("{{line}}", "sh: 1: xelatex: not found"),
    );
    expect(noOutput.explanation).toBe(enErrors.compile.no_output);
  });

  it("gives Quarto's setup problems a translatable explanation", () => {
    const codes = ["quarto_needs_tex", "r_package_missing", "jupyter_missing", "quarto_no_input"] as const;
    const explained = explainCodedCompileErrors(codes.map((code) => warning(`notebook.${code}`)));
    codes.forEach((code, index) => {
      expect(explained[index].explanation).toBe(enErrors.notebook[code]);
    });
  });

  it("translates the latexmk setup cards with their params", () => {
    const coded = (code: string, params: Record<string, string>) => ({ ...warning(code), params });
    const [perl, compiler, command, biber, tool] = explainCodedCompileErrors([
      coded("tex.latexmk_needs_perl", {}),
      coded("tex.compiler_missing", { compiler: "XeLaTeX" }),
      coded("tex.compiler_missing_command", { compiler: "XeLaTeX", command: "sudo apt install texlive-xetex" }),
      coded("tex.biber_missing_command", { command: "sudo apt install biber" }),
      coded("tex.tool_missing", { tool: "makeindex" }),
    ]);
    expect(perl.explanation).toBe(enErrors.tex.latexmk_needs_perl);
    expect(compiler.explanation).toBe(enErrors.tex.compiler_missing.replace("{{compiler}}", "XeLaTeX"));
    expect(command.explanation).toContain("sudo apt install texlive-xetex");
    expect(biber.explanation).toContain("sudo apt install biber");
    expect(tool.explanation).toBe(enErrors.tex.tool_missing.replace("{{tool}}", "makeindex"));
  });
});

describe("missing font metrics", () => {
  it("names the font in a translatable explanation", () => {
    const [explained] = explainCodedCompileErrors([
      { ...warning("tex.explain.font_metrics_missing"), params: { font: "uwmj31" } },
    ]);
    expect(explained.explanation).toBe(enErrors.tex.explain.font_metrics_missing.replace("{{font}}", "uwmj31"));
  });
});

describe("catalog lookup", () => {
  const backendEnglish = "English from the backend";
  const params = { font: "cmr10", entry: "knuth", file: "refs.bib", found: "3.8", expected: "3.11", name: "knuth" };

  it("renders every LaTeX explanation from the catalog", () => {
    for (const key of Object.keys(enErrors.tex.explain)) {
      const [explained] = explainCodedCompileErrors([
        { ...warning(`tex.explain.${key}`), explanation: backendEnglish, params },
      ]);
      expect(explained.explanation, key).not.toBe(backendEnglish);
      expect(explained.explanation, key).not.toContain("{{");
    }
  });

  it("keeps the backslashes and braces of the LaTeX in a message", () => {
    const [ampersand, breaks, superscript] = explainCodedCompileErrors(
      ["misplaced_alignment_tab", "no_line_to_end", "double_superscript"].map((key) =>
        warning(`tex.explain.${key}`),
      ),
    );
    expect(ampersand.explanation).toContain("Write \\& for");
    expect(breaks.explanation?.startsWith("\\\\ was used")).toBe(true);
    expect(superscript.explanation).toContain("x^{a}^{b} becomes x^{ab}");
  });

  it("shows the language the catalog is in, not the English from the backend", async () => {
    const translated = "Dieser Befehl ist unbekannt.";
    const language = i18n.language;
    i18n.addResourceBundle(
      "de",
      "errors",
      { tex: { explain: { undefined_control_sequence: translated } } },
      true,
      true,
    );
    await i18n.changeLanguage("de");
    try {
      const [explained] = explainCodedCompileErrors([
        { ...warning("tex.explain.undefined_control_sequence"), explanation: backendEnglish },
      ]);
      expect(explained.explanation).toBe(translated);
    } finally {
      await i18n.changeLanguage(language);
      i18n.removeResourceBundle("de", "errors");
    }
  });

  it("finds a coded message the hand-written list leaves out", () => {
    const [explained] = explainCodedCompileErrors([
      { ...warning("tex.latexmk_not_in_distribution"), params: { binDir: "/usr/bin" } },
    ]);
    expect(explained.explanation).toBe(
      enErrors.tex.latexmk_not_in_distribution.replace("{{binDir}}", "/usr/bin"),
    );
  });

  it("keeps the backend's English for a code the catalog doesn't have", () => {
    const unknown = { ...warning("tex.explain.not_in_the_catalog"), explanation: backendEnglish };
    expect(explainCodedCompileErrors([unknown])).toEqual([unknown]);
  });

  it("leaves an error without a code alone", () => {
    const plain = { ...warning(undefined), explanation: backendEnglish };
    expect(explainCodedCompileErrors([plain])).toEqual([plain]);
  });
});

describe("translatedLogNote", () => {
  const log = [
    "Package biblatex Warning: Please (re)run Biber on the file:",
    "(biblatex)                main",
    "(biblatex)                and rerun LaTeX afterwards.",
    "",
    "Biber warning: WARN - I didn't find a database entry for 'knuth' (section 0)",
    "ERROR - Cannot find 'refs.bib'!",
    "error: can't open path `missing.bib`",
    "",
  ].join("\n");

  function withMarkers(run: () => void) {
    const marked = {
      biber_needs_run: "needs Biber",
      biber_no_entry: "no entry {{entry}}",
      biber_file_missing: "no bib file {{file}}",
      biber_version_mismatch: "versions {{found}} {{expected}}",
      file_not_opened: "no open {{file}}",
      citation_missing: "no citation {{name}}",
      reference_missing: "no reference {{name}}",
    };
    const originals = { ...enErrors.tex.explain };
    i18n.addResourceBundle("en", "errors", { tex: { explain: marked } }, true, true);
    try {
      run();
    } finally {
      i18n.addResourceBundle("en", "errors", { tex: { explain: originals } }, true, true);
    }
  }

  it("reads the notes both log parsers write through the catalog", () => {
    const messages = parseLatexLog(log, "main.tex").map((diagnostic) => diagnostic.message);
    expect(messages).toHaveLength(4);
    withMarkers(() => {
      expect(messages.map(translatedLogNote)).toEqual([
        "needs Biber",
        "no entry knuth",
        "no bib file refs.bib",
        "no open missing.bib",
      ]);
      expect(
        translatedLogNote(
          "Biber and biblatex versions do not match (control file 3.8, expected 3.11). Oleafly uses its pinned Biber for the built-in engine; if this appears, report it with the compile log.",
        ),
      ).toBe("versions 3.8 3.11");
    });
  });

  it("gives the same English as the parsers", () => {
    for (const { message } of parseLatexLog(log, "main.tex")) {
      expect(translatedLogNote(message)).toBe(message);
    }
    expect(
      translatedLogNote(
        "Biber and biblatex versions do not match (control file 3.8, expected 3.11). Oleafly uses its pinned Biber for the built-in engine; if this appears, report it with the compile log.",
      ),
    ).toBe(
      enErrors.tex.explain.biber_version_mismatch
        .replace("{{found}}", "3.8")
        .replace("{{expected}}", "3.11"),
    );
  });

  it("reads missing citations and references through the catalog", () => {
    const undefinedLog = [
      "LaTeX Warning: Citation `knuth' on page 1 undefined on input line 5.",
      "",
      "LaTeX Warning: Reference `fig:a' on page 1 undefined on input line 6.",
      "",
    ].join("\n");
    const messages = parseLatexLog(undefinedLog, "main.tex").map((diagnostic) => diagnostic.message);
    expect(messages).toEqual(["Cannot find citation `knuth`.", "Cannot find reference `fig:a`."]);
    withMarkers(() => {
      expect(messages.map(translatedLogNote)).toEqual(["no citation knuth", "no reference fig:a"]);
    });
    expect(messages.map(translatedLogNote)).toEqual(messages);
  });

  it("keeps a citation key exactly as the document spells it", () => {
    const message = "Cannot find citation `O'Neil&Smith/2020`.";
    expect(translatedLogNote(message)).toBe(message);
  });

  it("leaves everything else as the compiler printed it", () => {
    expect(translatedLogNote("Citation 'knuth' undefined")).toBe("Citation 'knuth' undefined");
  });
});

describe("TeX setup codes", () => {
  it("have an English message for every code", () => {
    for (const code of TEX_SETUP_CODES) {
      const key = code.replace("tex.", "") as keyof typeof enErrors.tex;
      expect(enErrors.tex[key], code).toBeTruthy();
    }
  });

  it("describe a blocker in the same words as a refusal", () => {
    expect(describeTexBlocker({ code: "tex.latexmk_missing", params: {} })).toBe(enErrors.tex.latexmk_missing);
    expect(
      describeTexBlocker({ code: "tex.latexmk_not_in_distribution", params: { binDir: "/usr/bin" } }),
    ).toBe(enErrors.tex.latexmk_not_in_distribution.replace("{{binDir}}", "/usr/bin"));
  });

  it("give the reason from the first setup card only", () => {
    const setup = { ...warning("tex.tool_missing"), explanation: "Install makeindex." };
    expect(texSetupReason([warning(undefined), setup])).toBe("Install makeindex.");
    expect(texSetupReason([warning("tex.compiler_crashed")])).toBeNull();
    expect(texSetupReason([])).toBeNull();
  });
});
