import { unified } from "unified";
import { environmentInfo, macroInfo } from "@unified-latex/unified-latex-ctan";
import { unifiedLatexTrimEnvironmentContents, unifiedLatexTrimRoot } from "@unified-latex/unified-latex-util-trim";
import { LatexPegParser } from "@unified-latex/unified-latex-util-pegjs";
import { visit } from "@unified-latex/unified-latex-util-visit";
import { match } from "@unified-latex/unified-latex-util-match";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import { attachMacroArgsInArray } from "@unified-latex/unified-latex-util-arguments";
import { processEnvironment } from "@unified-latex/unified-latex-util-environments";
import { hasReparsableMacroNames, reparseExpl3AndAtLetterRegions, reparseMacroNames } from "@unified-latex/unified-latex-util-catcode";
//#region libs/compiler-ast.ts
/**
* Unified complier plugin that passes through a LaTeX AST without modification.
*/
var unifiedLatexAstComplier = function unifiedLatexAstComplier() {
	Object.assign(this, { Compiler: (x) => x });
};
//#endregion
//#region libs/parse-minimal.ts
/**
* Parse `str` to an AST with minimal processing. E.g., macro
* arguments are not attached to macros, etc. when parsed with this
* function.
*/
function parseMinimal(str) {
	return LatexPegParser.parse(str);
}
/**
* Parse `str` to an AST with minimal processing. E.g., macro
* arguments are not attached to macros, etc. when parsed with this
* function.
*
* The parsing assumes a math-mode context, so, for example, `^` and `_` are
* parsed as macros (even though arguments are not attached to them).
*/
function parseMathMinimal(str) {
	return LatexPegParser.parse(str, { startRule: "math" });
}
//#endregion
//#region libs/plugin-from-string-minimal.ts
/**
* Parse a string to a LaTeX AST with no post processing. For example,
* no macro arguments will be attached, etc.
*/
var unifiedLatexFromStringMinimal = function unifiedLatexFromStringMinimal(options) {
	const parser = (str) => {
		if (options?.mode === "math") return {
			type: "root",
			content: parseMathMinimal(str),
			_renderInfo: { inMathMode: true }
		};
		return parseMinimal(str);
	};
	Object.assign(this, { Parser: parser });
};
//#endregion
//#region libs/reparse-math.ts
/**
* Reparse math environments/macro contents that should have been parsed in math mode but weren't.
*/
var unifiedLatexReparseMath = function unifiedLatexReparseMath(options) {
	const { mathEnvs = [], mathMacros = [] } = options || {};
	return unifiedLatexReparseMathConstructPlugin({
		mathMacros,
		mathEnvs
	});
};
/**
* Construct the inner function for the `unifiedLatexReparseMath` plugin. This function should not be used by libraries.
*/
function unifiedLatexReparseMathConstructPlugin({ mathEnvs, mathMacros }) {
	const isMathEnvironment = match.createEnvironmentMatcher(mathEnvs);
	const isMathMacro = match.createMacroMatcher(mathMacros);
	return (tree) => {
		visit(tree, (node) => {
			if (match.anyMacro(node)) {
				for (const arg of node.args || []) if (arg.content.length > 0 && !wasParsedInMathMode(arg.content)) arg.content = parseMathMinimal(printRaw(arg.content));
			}
			if (match.anyEnvironment(node)) {
				if (!wasParsedInMathMode(node.content)) node.content = parseMathMinimal(printRaw(node.content));
			}
		}, { test: (node) => isMathEnvironment(node) || isMathMacro(node) });
	};
}
/**
* Use a heuristic to decide whether a string was parsed in math mode. The heuristic
* looks for strings of length greater than 1 or the failure for "_" and "^" to be parsed
* as a macro.
*/
function wasParsedInMathMode(nodes) {
	return !nodes.some((node) => match.anyString(node) && node.content.length > 1 || match.string(node, "^") || match.string(node, "_"));
}
//#endregion
//#region libs/process-macros-and-environments.ts
/**
* Unified plugin to process macros and environments. Any environments that contain math content
* are reparsed (if needed) in math mode.
*/
var unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse = function unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse(options) {
	const { environments = {}, macros = {} } = options || {};
	const mathMacros = Object.fromEntries(Object.entries(macros).filter(([_, info]) => info.renderInfo?.inMathMode === true));
	const mathEnvs = Object.fromEntries(Object.entries(environments).filter(([_, info]) => info.renderInfo?.inMathMode === true));
	const mathReparser = unifiedLatexReparseMathConstructPlugin({
		mathEnvs: Object.keys(mathEnvs),
		mathMacros: Object.keys(mathMacros)
	});
	const isRelevantEnvironment = match.createEnvironmentMatcher(environments);
	const isRelevantMathEnvironment = match.createEnvironmentMatcher(mathEnvs);
	return (tree) => {
		visit(tree, {
			enter: (nodes) => {
				if (!Array.isArray(nodes)) return;
				attachMacroArgsInArray(nodes, mathMacros);
			},
			leave: (node) => {
				if (!isRelevantMathEnvironment(node)) return;
				const envName = printRaw(node.env);
				const envInfo = environments[envName];
				if (!envInfo) throw new Error(`Could not find environment info for environment "${envName}"`);
				processEnvironment(node, envInfo);
			}
		}, { includeArrays: true });
		mathReparser(tree);
		visit(tree, {
			enter: (nodes) => {
				if (!Array.isArray(nodes)) return;
				attachMacroArgsInArray(nodes, macros);
			},
			leave: (node) => {
				if (!isRelevantEnvironment(node)) return;
				const envName = printRaw(node.env);
				const envInfo = environments[envName];
				if (!envInfo) throw new Error(`Could not find environment info for environment "${envName}"`);
				processEnvironment(node, envInfo);
			}
		}, { includeArrays: true });
	};
};
//#endregion
//#region libs/process-at-letter-and-expl-macros.ts
/**
* Unified plugin to reprocess macros names to possibly include `@`, `_`, or `:`.
* This plugin detects the `\makeatletter` and `\ExplSyntaxOn` commands and reprocesses macro names
* inside of those blocks to include those characters.
*/
var unifiedLatexProcessAtLetterAndExplMacros = function unifiedLatexProcessAtLetterAndExplMacros(options) {
	let { atLetter = false, expl3 = false, autodetectExpl3AndAtLetter = false } = options || {};
	return (tree) => {
		reparseExpl3AndAtLetterRegions(tree);
		if (atLetter || expl3) autodetectExpl3AndAtLetter = false;
		if (autodetectExpl3AndAtLetter) {
			atLetter = hasReparsableMacroNames(tree, "@");
			expl3 = hasReparsableMacroNames(tree, "_");
		}
		const charSet = /* @__PURE__ */ new Set();
		if (atLetter) charSet.add("@");
		if (expl3) {
			charSet.add(":");
			charSet.add("_");
		}
		if (charSet.size > 0) reparseMacroNames(tree, charSet);
	};
};
//#endregion
//#region libs/plugin-from-string.ts
/**
* Parse a string to a LaTeX AST.
*/
var unifiedLatexFromString = function unifiedLatexFromString(options) {
	const { mode = "regular", macros = {}, environments = {}, flags: { atLetter = false, expl3 = false, autodetectExpl3AndAtLetter = false } = {} } = options || {};
	const allMacroInfo = Object.assign({}, ...Object.values(macroInfo), macros);
	const allEnvInfo = Object.assign({}, ...Object.values(environmentInfo), environments);
	const fullParser = unified().use(unifiedLatexFromStringMinimal, { mode }).use(unifiedLatexProcessAtLetterAndExplMacros, {
		atLetter,
		expl3,
		autodetectExpl3AndAtLetter
	}).use(unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse, {
		macros: allMacroInfo,
		environments: allEnvInfo
	}).use(unifiedLatexTrimEnvironmentContents).use(unifiedLatexTrimRoot).use(unifiedLatexAstComplier);
	const parser = (str) => {
		return fullParser.processSync({ value: str }).result;
	};
	Object.assign(this, { Parser: parser });
};
//#endregion
//#region libs/parse.ts
var parser = unified().use(unifiedLatexFromString).freeze();
/**
* Parse the string into an AST.
*/
function parse(str) {
	return parser.parse(str);
}
/**
* Returns the default `unified-latex` parser, or create a new one with the
* provided `unifiedLatexFromString` options
* @param options Plugin options of `unifiedLatexFromString` plugin.
* @returns The default `unified-latex` parser if `options` is `undefined`, or a
* newly created `unified-latex` parser with the provided `options`.
*/
function getParser(options) {
	return options ? unified().use(unifiedLatexFromString, options).freeze() : parser;
}
//#endregion
//#region libs/parse-math.ts
/**
* Parse `str` into an AST. Parsing starts in math mode and a list of
* nodes is returned (instead of a "root" node).
*/
function parseMath(str) {
	if (typeof str !== "string") str = printRaw(str);
	return unified().use(unifiedLatexFromString, { mode: "math" }).parse({ value: str }).content;
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions parse strings to a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you have a string that you would like to parse to a `unified-latex` `Ast.Ast`, or
* if you are building a plugin for `unified()` that manipulates LaTeX.
*/
//#endregion
export { getParser, parse, parseMath, parseMathMinimal, parseMinimal, unifiedLatexAstComplier, unifiedLatexFromString, unifiedLatexFromStringMinimal, unifiedLatexProcessAtLetterAndExplMacros, unifiedLatexProcessMacrosAndEnvironmentsWithMathReparse, unifiedLatexReparseMath, unifiedLatexReparseMathConstructPlugin };

//# sourceMappingURL=index.js.map