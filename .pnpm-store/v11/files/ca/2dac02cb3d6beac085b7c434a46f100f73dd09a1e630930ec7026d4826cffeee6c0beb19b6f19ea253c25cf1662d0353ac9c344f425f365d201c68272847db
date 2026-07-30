import { environments, macros } from "./package/amsart/index.js";
import { environments as environments$1, macros as macros$1 } from "./package/cleveref/index.js";
import { environments as environments$2, macros as macros$2 } from "./package/exam/index.js";
import { environments as environments$3, macros as macros$3 } from "./package/geometry/index.js";
import { environments as environments$4, macros as macros$4 } from "./package/hyperref/index.js";
import { environments as environments$5, macros as macros$5 } from "./package/latex2e/index.js";
import { n as macros$6, t as environments$6 } from "./listings-DNTZBTCe.js";
import { environments as environments$7, macros as macros$7 } from "./package/makeidx/index.js";
import { environments as environments$8, macros as macros$8 } from "./package/mathtools/index.js";
import { n as macros$9, t as environments$9 } from "./minted-DApErmW2.js";
import { environments as environments$10, macros as macros$10 } from "./package/nicematrix/index.js";
import { environments as environments$11, macros as macros$11 } from "./package/systeme/index.js";
import { a as macros$12, i as environments$12 } from "./tikz-CGsknaZh.js";
import { environments as environments$13, macros as macros$13 } from "./package/xcolor/index.js";
import { environments as environments$14, macros as macros$14 } from "./package/xparse/index.js";
import { environments as environments$15, macros as macros$15 } from "./package/beamer/index.js";
import { environments as environments$16, macros as macros$16 } from "./package/multicol/index.js";
//#region index.ts
/**
* Info about the macros for available ctan packages. `latex2e` contains
* the standard macros for LaTeX.
*/
var macroInfo = {
	amsart: macros,
	cleveref: macros$1,
	exam: macros$2,
	geometry: macros$3,
	hyperref: macros$4,
	latex2e: macros$5,
	listings: macros$6,
	makeidx: macros$7,
	mathtools: macros$8,
	minted: macros$9,
	nicematrix: macros$10,
	systeme: macros$11,
	tikz: macros$12,
	xcolor: macros$13,
	xparse: macros$14,
	beamer: macros$15,
	multicol: macros$16
};
/**
* Info about the environments for available ctan packages. `latex2e` contains
* the standard environments for LaTeX.
*/
var environmentInfo = {
	amsart: environments,
	cleveref: environments$1,
	exam: environments$2,
	geometry: environments$3,
	hyperref: environments$4,
	latex2e: environments$5,
	listings: environments$6,
	makeidx: environments$7,
	mathtools: environments$8,
	minted: environments$9,
	nicematrix: environments$10,
	systeme: environments$11,
	tikz: environments$12,
	xcolor: environments$13,
	xparse: environments$14,
	beamer: environments$15,
	multicol: environments$16
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
export { environmentInfo, macroInfo };

//# sourceMappingURL=index.js.map