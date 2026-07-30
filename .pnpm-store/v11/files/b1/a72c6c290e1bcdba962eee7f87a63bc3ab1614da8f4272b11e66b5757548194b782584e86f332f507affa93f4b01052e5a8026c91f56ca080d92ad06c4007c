import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
//#region libs/match.ts
/**
* Creates a macro matching function that uses a `SpecialMacroSpec` or list of macros
* and generates a hash for quick lookup.
*/
function createMacroMatcher(macros) {
	const macrosHash = Array.isArray(macros) ? macros.length > 0 ? typeof macros[0] === "string" ? Object.fromEntries(macros.map((macro) => {
		if (typeof macro !== "string") throw new Error("Wrong branch of map function");
		return [macro, {}];
	})) : Object.fromEntries(macros.map((macro) => {
		if (typeof macro === "string") throw new Error("Wrong branch of map function");
		if (macro.escapeToken != null) return [macro.content, { escapeToken: macro.escapeToken }];
		return [macro.content, {}];
	})) : {} : macros;
	return function matchAgainstMacros(node) {
		if (node == null || node.type !== "macro") return false;
		const spec = macrosHash[node.content];
		if (!spec) return false;
		if (typeof spec === "object" && "escapeToken" in spec) return spec.escapeToken == null || spec.escapeToken === node.escapeToken;
		return true;
	};
}
/**
* Creates a macro matching function that uses a `SpecialMacroSpec` or list of macros
* and generates a hash for quick lookup.
*/
function createEnvironmentMatcher(macros) {
	const environmentsHash = Array.isArray(macros) ? Object.fromEntries(macros.map((str) => {
		return [str, {}];
	})) : macros;
	return function matchAgainstEnvironments(node) {
		if (!match.anyEnvironment(node)) return false;
		if (!environmentsHash[printRaw(node.env)]) return false;
		return true;
	};
}
/**
* Functions to match different types of nodes.
*/
var match = {
	macro(node, macroName) {
		if (node == null) return false;
		return node.type === "macro" && (macroName == null || node.content === macroName);
	},
	anyMacro(node) {
		return match.macro(node);
	},
	environment(node, envName) {
		if (node == null) return false;
		return (node.type === "environment" || node.type === "mathenv") && (envName == null || printRaw(node.env) === envName);
	},
	anyEnvironment(node) {
		return match.environment(node);
	},
	comment(node) {
		if (node == null) return false;
		return node.type === "comment";
	},
	parbreak(node) {
		if (node == null) return false;
		return node.type === "parbreak";
	},
	whitespace(node) {
		if (node == null) return false;
		return node.type === "whitespace";
	},
	whitespaceLike(node) {
		if (node == null) return false;
		return node.type === "whitespace" || node.type === "whitespace" && node.leadingWhitespace === true;
	},
	string(node, value) {
		if (node == null) return false;
		return node.type === "string" && (value == null || node.content === value);
	},
	anyString(node) {
		return match.string(node);
	},
	group(node) {
		if (node == null) return false;
		return node.type === "group";
	},
	argument(node) {
		if (node == null) return false;
		return node.type === "argument";
	},
	blankArgument(node) {
		if (!match.argument(node)) return false;
		return node.openMark === "" && node.closeMark === "" && node.content.length === 0;
	},
	math(node) {
		if (node == null) return false;
		return node.type === "displaymath" || node.type === "inlinemath";
	},
	createMacroMatcher,
	createEnvironmentMatcher
};
var { anyEnvironment, anyMacro, anyString, argument, blankArgument, comment, environment, group, macro, math, parbreak, string, whitespace } = match;
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to match different `Ast.Node` types in a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you need a type-guard to ensure a node is of a certain type; for example, during a call to `unified-latex-until-visit`.
*/
//#endregion
export { anyEnvironment, anyMacro, anyString, argument, blankArgument, comment, environment, group, macro, match, math, parbreak, string, whitespace };

//# sourceMappingURL=index.js.map