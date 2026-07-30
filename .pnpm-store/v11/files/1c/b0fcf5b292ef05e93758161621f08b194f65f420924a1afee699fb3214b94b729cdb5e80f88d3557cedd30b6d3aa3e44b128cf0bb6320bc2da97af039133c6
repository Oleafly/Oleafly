Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_replace = require("@unified-latex/unified-latex-util-replace");
//#region libs/delete-comments.ts
/**
* Returns a new AST with all comments removed. Care is taken to preserve whitespace.
* For example
* ```
* x%
* y
* ```
* becomes `xy` but
* ```
* x %
* y
* ```
* becomes `x y`
*/
function deleteComments(ast) {
	return (0, _unified_latex_unified_latex_util_replace.replaceNode)(ast, (node) => {
		if (!_unified_latex_unified_latex_util_match.match.comment(node)) return;
		if (node.leadingWhitespace) return { type: "whitespace" };
		return null;
	});
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to help modify comments in a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you want to process comments in a `unified-latex` AST.
*/
//#endregion
exports.deleteComments = deleteComments;

//# sourceMappingURL=index.cjs.map