Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_xcolor = require("./xcolor-kzYzOAhs.cjs");
const require_index = require("./package/amsart/index.cjs");
const require_index$1 = require("./package/cleveref/index.cjs");
const require_index$2 = require("./package/exam/index.cjs");
const require_index$3 = require("./package/geometry/index.cjs");
const require_index$4 = require("./package/hyperref/index.cjs");
const require_index$5 = require("./package/latex2e/index.cjs");
const require_listings = require("./listings-cb494lgp.cjs");
const require_index$6 = require("./package/makeidx/index.cjs");
const require_index$7 = require("./package/mathtools/index.cjs");
const require_minted = require("./minted-DFbrXgk2.cjs");
const require_index$8 = require("./package/nicematrix/index.cjs");
const require_index$9 = require("./package/systeme/index.cjs");
const require_tikz = require("./tikz-B5yNR22o.cjs");
const require_index$10 = require("./package/xparse/index.cjs");
const require_index$11 = require("./package/beamer/index.cjs");
const require_index$12 = require("./package/multicol/index.cjs");
//#region index.ts
/**
* Info about the macros for available ctan packages. `latex2e` contains
* the standard macros for LaTeX.
*/
var macroInfo = {
	amsart: require_index.macros,
	cleveref: require_index$1.macros,
	exam: require_index$2.macros,
	geometry: require_index$3.macros,
	hyperref: require_index$4.macros,
	latex2e: require_index$5.macros,
	listings: require_listings.macros,
	makeidx: require_index$6.macros,
	mathtools: require_index$7.macros,
	minted: require_minted.macros,
	nicematrix: require_index$8.macros,
	systeme: require_index$9.macros,
	tikz: require_tikz.macros,
	xcolor: require_xcolor.macros,
	xparse: require_index$10.macros,
	beamer: require_index$11.macros,
	multicol: require_index$12.macros
};
/**
* Info about the environments for available ctan packages. `latex2e` contains
* the standard environments for LaTeX.
*/
var environmentInfo = {
	amsart: require_index.environments,
	cleveref: require_index$1.environments,
	exam: require_index$2.environments,
	geometry: require_index$3.environments,
	hyperref: require_index$4.environments,
	latex2e: require_index$5.environments,
	listings: require_listings.environments,
	makeidx: require_index$6.environments,
	mathtools: require_index$7.environments,
	minted: require_minted.environments,
	nicematrix: require_index$8.environments,
	systeme: require_index$9.environments,
	tikz: require_tikz.environments,
	xcolor: require_xcolor.environments,
	xparse: require_index$10.environments,
	beamer: require_index$11.environments,
	multicol: require_index$12.environments
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
//#endregion
exports.environmentInfo = environmentInfo;
exports.macroInfo = macroInfo;

//# sourceMappingURL=index.cjs.map