//#region libs/print-raw.ts
var linebreak = Symbol("linebreak");
var ESCAPE = "\\";
/**
* Renders the AST to an array inserting `linebreak` where needed;
* This array may be nested.
*
* @param {*} node
*/
function _printRaw(node) {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return [].concat(...node.map((n) => _printRaw(n)));
	let argsString, escape;
	switch (node.type) {
		case "root": return _printRaw(node.content);
		case "argument": return [
			node.openMark,
			..._printRaw(node.content),
			node.closeMark
		];
		case "comment":
			let suffix = node.suffixParbreak ? "" : linebreak;
			let leadingWhitespace = "";
			if (node.sameline && node.leadingWhitespace) leadingWhitespace = " ";
			if (node.sameline) return [
				leadingWhitespace,
				"%",
				..._printRaw(node.content),
				suffix
			];
			return [
				linebreak,
				"%",
				..._printRaw(node.content),
				suffix
			];
		case "environment":
		case "mathenv":
		case "verbatim":
			let env = _printRaw(node.env);
			let envStart = [
				ESCAPE + "begin{",
				...env,
				"}"
			];
			let envEnd = [
				ESCAPE + "end{",
				...env,
				"}"
			];
			argsString = node.args == null ? [] : _printRaw(node.args);
			return [
				...envStart,
				...argsString,
				..._printRaw(node.content),
				...envEnd
			];
		case "displaymath": return [
			ESCAPE + "[",
			..._printRaw(node.content),
			ESCAPE + "]"
		];
		case "group": return [
			"{",
			..._printRaw(node.content),
			"}"
		];
		case "inlinemath": return [
			"$",
			..._printRaw(node.content),
			"$"
		];
		case "macro":
			argsString = node.args == null ? [] : _printRaw(node.args);
			escape = node.escapeToken == null ? ESCAPE : node.escapeToken;
			return [
				escape,
				..._printRaw(node.content),
				...argsString
			];
		case "parbreak": return [linebreak, linebreak];
		case "string": return [node.content];
		case "verb": return [
			ESCAPE,
			node.env,
			node.escape,
			..._printRaw(node.content),
			node.escape
		];
		case "whitespace": return [" "];
		default:
			console.warn("Cannot find render for node ", node, `(of type ${typeof node})`);
			return ["" + node];
	}
}
function printRaw(node, options) {
	const asArray = options != null ? options.asArray : false;
	const printedTokens = _printRaw(node);
	if (asArray) return printedTokens;
	return printedTokens.map((x) => x === linebreak ? "\n" : x).join("");
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to print a `unified-latex` Abstract Syntax Tree (AST) to a string.
*
* ## When should I use this?
*
* If you want to directly print an `Ast.Ast` to a string without any pretty printing or formatting.
*/
//#endregion
export { linebreak, printRaw };

//# sourceMappingURL=index.js.map