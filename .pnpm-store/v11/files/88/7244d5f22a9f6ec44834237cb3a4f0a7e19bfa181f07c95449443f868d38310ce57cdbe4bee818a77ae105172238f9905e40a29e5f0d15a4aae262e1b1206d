Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _unified_latex_unified_latex_util_visit = require("@unified-latex/unified-latex-util-visit");
//#region index.ts
/**
* Updates the `._renderInfo` property on a node to include
* whatever has been supplied to `renderInfo`. If `renderInfo`
* is null, no update is performed.
*
* *This operation mutates `node`*
*/
function updateRenderInfo(node, renderInfo) {
	if (renderInfo != null) node._renderInfo = {
		...node._renderInfo || {},
		...renderInfo
	};
	return node;
}
/**
* Removes any `_renderInfo` and `position` tags present in the AST. This
* operation is _destructive_.
*/
function trimRenderInfo(ast) {
	(0, _unified_latex_unified_latex_util_visit.visit)(ast, (node) => {
		delete node._renderInfo;
		delete node.position;
	});
	return ast;
}
/**
* ## What is this?
*
* Functions to help modify the `_renderInfo` of a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you want to compare the structure of an AST without position information or extra information
* that is kept for pretty-printing, these functions can be used to remove/modify the `_renderInfo`
* of an `Ast.Node`.
*/
//#endregion
exports.trimRenderInfo = trimRenderInfo;
exports.updateRenderInfo = updateRenderInfo;

//# sourceMappingURL=index.cjs.map