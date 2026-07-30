/**
 * Info about the macros for available ctan packages. `latex2e` contains
 * the standard macros for LaTeX.
 */
export declare const macroInfo: {
    amsart: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    cleveref: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    exam: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    geometry: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    hyperref: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    latex2e: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    listings: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    makeidx: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    mathtools: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    minted: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    nicematrix: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    systeme: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    tikz: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    xcolor: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    xparse: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    beamer: import('@unified-latex/unified-latex-types').MacroInfoRecord;
    multicol: import('@unified-latex/unified-latex-types').MacroInfoRecord;
};
/**
 * Info about the environments for available ctan packages. `latex2e` contains
 * the standard environments for LaTeX.
 */
export declare const environmentInfo: {
    amsart: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    cleveref: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    exam: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    geometry: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    hyperref: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    latex2e: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    listings: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    makeidx: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    mathtools: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    minted: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    nicematrix: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    systeme: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    tikz: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    xcolor: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    xparse: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    beamer: import('@unified-latex/unified-latex-types').EnvInfoRecord;
    multicol: import('@unified-latex/unified-latex-types').EnvInfoRecord;
};
/**
 * ## What is this?
 *
 * Macro/environment definitions and utilities for specific LaTeX packages from CTAN.
 *
 * Note: basic LaTeX macro/environment definitions come from the `latex2e` package, even though
 * this is technically not a CTAN "package".
 *
 * ## When should I use this?
 *
 * If you want information about special functions/macros from particular CTAN packages, or
 * you need to parse special environments.
 *
 * ## Notes
 *
 * By default all macros/environments that are exported get processed. If multiple packages
 * export a macro with the same name, then the later-exported one takes precedence. If two packages
 * export a macro/environment of the same name but with conflicting argument signatures, this can
 * cause issues when another unified-latex package processes arguments positionally. For example,
 * by default `\textbf` takes one argument, but the beamer version of `\textbf` takes two arguments.
 * During HTML conversion, if arguments are referenced positionally, this may cause previously-working
 * code to fail with when beamer macro signatures are used. A workaround is provided: `_renderInfo.namedArguments`.
 * If `_renderInfo.namedArguments` is specified on both the original macro/environment definition
 * **and** the conflicting one, other unified-latex commands can reference arguments by name instead
 * of by position.
 */
//# sourceMappingURL=index.d.ts.map