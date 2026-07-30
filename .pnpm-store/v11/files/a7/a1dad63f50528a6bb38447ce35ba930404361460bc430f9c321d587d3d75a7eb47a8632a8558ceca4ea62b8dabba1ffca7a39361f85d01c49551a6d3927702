Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
//#region libs/list-math-children.ts
/**
* List all props of the current node that should be processed
* in math mode or not in math mode. If math mode is not specified in the node's render
* info, empty lists are returned.
*
* For example `\text{foo}` will report that `args` should *not* be processed in math mode,
* since it's contents should always be processed in text mode.
*/
function listMathChildren(node) {
	const NULL_RETURN = {
		enter: [],
		leave: []
	};
	if (Array.isArray(node)) return NULL_RETURN;
	if (_unified_latex_unified_latex_util_match.match.math(node)) return {
		enter: ["content"],
		leave: []
	};
	const renderInfo = node._renderInfo || {};
	if (renderInfo.inMathMode == null) return NULL_RETURN;
	if (_unified_latex_unified_latex_util_match.match.macro(node)) {
		if (renderInfo.inMathMode === true) return {
			enter: ["args"],
			leave: []
		};
		else if (renderInfo.inMathMode === false) return {
			enter: [],
			leave: ["args"]
		};
	}
	if (_unified_latex_unified_latex_util_match.match.environment(node)) if (renderInfo.inMathMode === true) return {
		enter: ["content"],
		leave: []
	};
	else return {
		enter: [],
		leave: ["content"]
	};
	return NULL_RETURN;
}
//#endregion
//#region libs/visit.ts
/**
* Continue traversing as normal
*/
var CONTINUE = Symbol("continue");
/**
* Do not traverse this node’s children
*/
var SKIP = Symbol("skip");
/**
* Stop traversing immediately
*/
var EXIT = Symbol("exit");
var DEFAULT_CONTEXT = {
	inMathMode: false,
	hasMathModeAncestor: false
};
/**
* Visit children of tree which pass a test
*
* @param {Node} tree Abstract syntax tree to walk
* @param {Visitor|Visitors} [visitor] Function to run for each node
*/
function visit(tree, visitor, options) {
	const { startingContext = DEFAULT_CONTEXT, test = () => true, includeArrays = false } = options || {};
	let enter;
	let leave;
	if (typeof visitor === "function") enter = visitor;
	else if (visitor && typeof visitor === "object") {
		enter = visitor.enter;
		leave = visitor.leave;
	}
	walk(tree, {
		key: void 0,
		index: void 0,
		parents: [],
		containingArray: void 0,
		context: { ...startingContext }
	});
	/**
	* @param {Node} node
	* @param {string?} key
	* @param {number?} index
	* @param {Array.<Node>} parents
	*/
	function walk(node, { key, index, parents, context, containingArray }) {
		const nodePassesTest = includeArrays ? test(node, {
			key,
			index,
			parents,
			context,
			containingArray
		}) : !Array.isArray(node) && test(node, {
			key,
			index,
			parents,
			context,
			containingArray
		});
		const result = enter && nodePassesTest ? toResult(enter(node, {
			key,
			index,
			parents,
			context,
			containingArray
		})) : [CONTINUE];
		if (result[0] === EXIT) return result;
		if (result[0] === SKIP) return leave && nodePassesTest ? toResult(leave(node, {
			key,
			index,
			parents,
			context,
			containingArray
		})) : result;
		if (Array.isArray(node)) for (let index = 0; index > -1 && index < node.length; index++) {
			const item = node[index];
			const result = walk(item, {
				key,
				index,
				parents,
				context,
				containingArray: node
			});
			if (result[0] === EXIT) return result;
			if (typeof result[1] === "number") index = result[1] - 1;
		}
		else {
			let childProps = ["content", "args"];
			switch (node.type) {
				case "macro":
					childProps = ["args"];
					break;
				case "comment":
				case "string":
				case "verb":
				case "verbatim":
					childProps = [];
					break;
				default: break;
			}
			const mathModeProps = listMathChildren(node);
			for (const key of childProps) {
				const value = node[key];
				const grandparents = [node].concat(parents);
				if (value == null) continue;
				const newContext = { ...context };
				if (mathModeProps.enter.includes(key)) {
					newContext.inMathMode = true;
					newContext.hasMathModeAncestor = true;
				} else if (mathModeProps.leave.includes(key)) newContext.inMathMode = false;
				const result = walk(value, {
					key,
					index: void 0,
					parents: grandparents,
					context: newContext,
					containingArray: void 0
				});
				if (result[0] === EXIT) return result;
			}
		}
		return leave && nodePassesTest ? toResult(leave(node, {
			key,
			index,
			parents,
			context,
			containingArray
		})) : result;
	}
}
/**
* Ensures a result is an `ActionTuple`s
*/
function toResult(value) {
	if (value == null) return [CONTINUE];
	if (Array.isArray(value)) return value;
	if (typeof value === "number") return [CONTINUE, value];
	return [value];
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to traverse a `unified-latex` Abstract Syntax Tree (AST). `visit` is
* very similar to [estree-util-visit](https://github.com/syntax-tree/estree-util-visit).
*
* ## When should I use this?
*
* If you want to recursively replace particular AST nodes.
*/
//#endregion
exports.CONTINUE = CONTINUE;
exports.EXIT = EXIT;
exports.SKIP = SKIP;
exports.visit = visit;

//# sourceMappingURL=index.cjs.map