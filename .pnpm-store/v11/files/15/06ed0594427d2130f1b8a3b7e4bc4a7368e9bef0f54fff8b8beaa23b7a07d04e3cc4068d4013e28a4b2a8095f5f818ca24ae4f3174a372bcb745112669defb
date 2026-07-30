Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
require("../../xcolor-kzYzOAhs.cjs");
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_pegjs = require("@unified-latex/unified-latex-util-pegjs");
let _unified_latex_unified_latex_util_print_raw = require("@unified-latex/unified-latex-util-print-raw");
//#region package/tabularx/provides.ts
var macros = {};
var environments = { tabularx: {
	signature: "m o m",
	renderInfo: { alignContent: true }
} };
//#endregion
//#region package/tabularx/libs/parser.ts
function createMatchers() {
	return {
		matchChar: (node, char) => _unified_latex_unified_latex_util_match.match.string(node, char),
		isWhitespace: _unified_latex_unified_latex_util_match.match.whitespace,
		isGroup: _unified_latex_unified_latex_util_match.match.group
	};
}
/**
* Parse a tabular/tabularx specification, e.g. `"|c|r|r|"`. This parser assumes the specification has
* already been parsed as LaTeX.
*/
function parseTabularSpec(ast) {
	if (!Array.isArray(ast)) throw new Error("You must pass an array of nodes");
	ast = (0, _unified_latex_unified_latex_util_pegjs.splitStringsIntoSingleChars)(ast);
	ast = (0, _unified_latex_unified_latex_util_pegjs.decorateArrayForPegjs)([...ast]);
	return _unified_latex_unified_latex_util_pegjs.TabularPegParser.parse(ast, createMatchers());
}
//#endregion
//#region package/tabularx/libs/print-raw.ts
/**
* Print a tabular/tabularx argument specification AST to a string.
*/
function printRaw(node, root = false) {
	if (typeof node === "string") return node;
	if (Array.isArray(node)) {
		const sepToken = root ? " " : "";
		return node.map((tok) => printRaw(tok)).join(sepToken);
	}
	switch (node.type) {
		case "vert_divider": return "|";
		case "at_divider": return `@{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.content)}}`;
		case "bang_divider": return `!{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.content)}}`;
		case "alignment":
			if (node.alignment === "left") return "l";
			if (node.alignment === "right") return "r";
			if (node.alignment === "center") return "c";
			if (node.alignment === "X") return "X";
			if (node.alignment === "parbox") {
				if (node.baseline === "top") return `p{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.size)}}`;
				if (node.baseline === "default") return `m{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.size)}}`;
				if (node.baseline === "bottom") return `b{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.size)}}`;
				return `w{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.baseline)}}{${(0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.size)}}`;
			}
			break;
		case "decl_code": return (0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.code);
		case "column":
			const end_code = node.before_end_code ? `<{${printRaw(node.before_end_code)}}` : "";
			const start_code = node.before_start_code ? `>{${printRaw(node.before_start_code)}}` : "";
			return [
				printRaw(node.pre_dividers),
				start_code,
				printRaw(node.alignment),
				end_code,
				printRaw(node.post_dividers)
			].join("");
		default:
			console.warn(`Unknown node type "${node.type}" for node`, node);
			return "";
	}
	return "";
}
//#endregion
exports.environments = environments;
exports.macros = macros;
exports.parseTabularSpec = parseTabularSpec;
exports.printRaw = printRaw;

//# sourceMappingURL=index.cjs.map