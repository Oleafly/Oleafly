import { ArgSpecPegParser } from "@unified-latex/unified-latex-util-pegjs";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region libs/argspec-parser.ts
/**
* Produce a string containing any decorators for the argspec node.
* For example, `!` in front of a node means "don't accept leading whitespace"
*/
function getDecorators(node) {
	let ret = "";
	if (node.noLeadingWhitespace) ret += "!";
	return ret;
}
/**
* Print an `xparse` argument specification AST
* to a string.
*/
function printRaw(node, root = false) {
	if (typeof node === "string") return node;
	if (Array.isArray(node)) {
		const sepToken = root ? " " : "";
		return node.map((tok) => printRaw(tok)).join(sepToken);
	}
	const decorators = getDecorators(node);
	const defaultArg = printDefaultArg("defaultArg" in node ? node.defaultArg : void 0, node.type === "embellishment");
	let spec = decorators;
	const type = node.type;
	switch (type) {
		case "body": return decorators + "b";
		case "optionalStar": return decorators + "s";
		case "optionalToken": return spec + "t" + node.token;
		case "optional":
			if (node.openBrace === "[" && node.closeBrace === "]") spec += node.defaultArg ? "O" : "o";
			else {
				spec += node.defaultArg ? "D" : "d";
				spec += node.openBrace + node.closeBrace;
			}
			return spec + defaultArg;
		case "mandatory":
			if (node.openBrace === "{" && node.closeBrace === "}") spec += "m";
			else {
				spec += node.defaultArg ? "R" : "r";
				spec += node.openBrace + node.closeBrace;
			}
			return spec + defaultArg;
		case "embellishment":
			spec += node.defaultArg ? "E" : "e";
			return spec + "{" + printRaw(node.embellishmentTokens) + "}" + defaultArg;
		case "verbatim": return spec + "v" + node.openBrace;
		case "group": return spec + "{" + printRaw(node.content) + "}";
		case "until": {
			const stopTokens = printRaw(node.stopTokens);
			return stopTokens.length > 1 || stopTokens[0] === " " ? `u{${stopTokens}}` : `u${stopTokens}`;
		}
		default:
			console.warn(`Unknown node type "${type}" for node`, node);
			return "";
	}
}
var parseCache = {};
/**
* Parse an `xparse` argument specification string to an AST.
* This function caches results. Don't mutate the returned AST!
*
* @param {string} [str=""] - LaTeX string input
* @returns - AST for LaTeX string
*/
function parse(str = "") {
	parseCache[str] = parseCache[str] || ArgSpecPegParser.parse(str);
	return parseCache[str];
}
function printDefaultArg(args, multipleArgs) {
	if (!args) return "";
	if (typeof args === "string") args = [args];
	if (!multipleArgs) return `{${args.join("")}}`;
	return `{${args.map((a) => `{${a}}`).join("")}}`;
}
//#endregion
//#region libs/argspec-types.ts
var argspec_types_exports = /* @__PURE__ */ __exportAll({});
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Tools to deal with `xparse` argument signatures. (E.g., `"o m"` for optional followed by mandatory
* argument).
*
* ## When should I use this?
*
* If you are working on the internals of `unified-latex`.
*/
//#endregion
export { argspec_types_exports as ArgSpecAst, parse, printRaw };

//# sourceMappingURL=index.js.map