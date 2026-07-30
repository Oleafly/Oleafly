Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_visit = require("@unified-latex/unified-latex-util-visit");
//#region libs/trim.ts
/**
* Trims whitespace and parbreaks from the start and end
* of an array. The number of trimmed nodes is returned.
* Special care is taken to preserve comments, though any whitespace
* before the first comment(s) or after the last comment(s) is trimmed.
*/
function trim(nodes) {
	if (!Array.isArray(nodes)) {
		console.warn("Trying to trim a non-array ast", nodes);
		return nodes;
	}
	const { trimmedStart } = trimStart(nodes);
	const { trimmedEnd } = trimEnd(nodes);
	return {
		trimmedStart,
		trimmedEnd
	};
}
/**
* Trim whitespace and parbreaks from the left of an array.
*/
function trimStart(nodes) {
	const { start } = amountOfLeadingAndTrailingWhitespace(nodes);
	nodes.splice(0, start);
	for (const leadingToken of nodes) {
		if (!_unified_latex_unified_latex_util_match.match.comment(leadingToken)) break;
		if (leadingToken.leadingWhitespace || leadingToken.sameline) leadingToken.leadingWhitespace = false;
		if (start > 0 && leadingToken.sameline) leadingToken.sameline = false;
	}
	return { trimmedStart: start };
}
/**
* Trim whitespace and parbreaks from the right of an array.
*/
function trimEnd(nodes) {
	const { end } = amountOfLeadingAndTrailingWhitespace(nodes);
	nodes.splice(nodes.length - end, end);
	for (let i = nodes.length - 1; i >= 0; i--) {
		const trailingToken = nodes[i];
		if (!_unified_latex_unified_latex_util_match.match.comment(trailingToken)) break;
		delete trailingToken.suffixParbreak;
		if (_unified_latex_unified_latex_util_match.match.comment(trailingToken) && trailingToken.leadingWhitespace && !trailingToken.sameline) trailingToken.leadingWhitespace = false;
	}
	return { trimmedEnd: end };
}
/**
* Returns the number of whitespace/parbreak nodes at the start and end of an array.
*/
function amountOfLeadingAndTrailingWhitespace(ast) {
	let start = 0;
	let end = 0;
	for (const node of ast) if (_unified_latex_unified_latex_util_match.match.whitespace(node) || _unified_latex_unified_latex_util_match.match.parbreak(node)) start++;
	else break;
	if (start === ast.length) return {
		start,
		end: 0
	};
	for (let i = ast.length - 1; i >= 0; i--) {
		const node = ast[i];
		if (_unified_latex_unified_latex_util_match.match.whitespace(node) || _unified_latex_unified_latex_util_match.match.parbreak(node)) end++;
		else break;
	}
	return {
		start,
		end
	};
}
//#endregion
//#region libs/unified-latex-trim-environment-contents.ts
/**
* Unified plugin to trim the whitespace from the start/end of any environments, including
* math environments.
*/
var unifiedLatexTrimEnvironmentContents = function unifiedLatexTrimEnvironmentContents() {
	return (tree) => {
		(0, _unified_latex_unified_latex_util_visit.visit)(tree, (node) => {
			if (!(_unified_latex_unified_latex_util_match.match.math(node) || _unified_latex_unified_latex_util_match.match.anyEnvironment(node))) return;
			let firstNode = node.content[0];
			if (_unified_latex_unified_latex_util_match.match.comment(firstNode) && firstNode.sameline) {
				firstNode.suffixParbreak = false;
				trimEnd(node.content);
				const { trimmedStart } = trimStart(node.content.slice(1));
				node.content.splice(1, trimmedStart);
			} else trim(node.content);
		});
	};
};
//#endregion
//#region libs/unified-latex-trim-root.ts
/**
* Unified plugin to trim the whitespace from the start/end of the root element.
*/
var unifiedLatexTrimRoot = function unifiedLatexTrimRoot() {
	return (tree) => {
		trim(tree.content);
	};
};
//#endregion
//#region libs/has-whitespace-equivalent.ts
/**
* Returns whether the array has whitespace at the start/end. Comments with `leadingWhitespace === true`
* are counted as whitespace. Other comments are ignored.
*/
function hasWhitespaceEquivalent(nodes) {
	let start = false;
	let end = false;
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (_unified_latex_unified_latex_util_match.match.comment(node)) {
			if (node.leadingWhitespace) {
				start = true;
				break;
			}
			continue;
		}
		if (_unified_latex_unified_latex_util_match.match.whitespace(node)) start = true;
		break;
	}
	for (let j = nodes.length - 1; j >= 0; j--) {
		const node = nodes[j];
		if (_unified_latex_unified_latex_util_match.match.comment(node)) {
			if (node.leadingWhitespace) {
				end = true;
				break;
			}
			continue;
		}
		if (_unified_latex_unified_latex_util_match.match.whitespace(node)) end = true;
		break;
	}
	return {
		start,
		end
	};
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to help modify a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you want to remove whitespace from the ends of an array of nodes.
*
* Note that whitespace can come from a `Ast.Whitespace` node or from an
* `Ast.Comment` node that has leading whitespace. These functions take care
* to deal with both situations.
*/
//#endregion
exports.hasWhitespaceEquivalent = hasWhitespaceEquivalent;
exports.trim = trim;
exports.trimEnd = trimEnd;
exports.trimStart = trimStart;
exports.unifiedLatexTrimEnvironmentContents = unifiedLatexTrimEnvironmentContents;
exports.unifiedLatexTrimRoot = unifiedLatexTrimRoot;

//# sourceMappingURL=index.cjs.map