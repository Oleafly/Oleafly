import { match } from "@unified-latex/unified-latex-util-match";
import { replaceNode } from "@unified-latex/unified-latex-util-replace";
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
	return replaceNode(ast, (node) => {
		if (!match.comment(node)) return;
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
export { deleteComments };

//# sourceMappingURL=index.js.map