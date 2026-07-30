import { match } from "@unified-latex/unified-latex-util-match";
//#region libs/split-on-condition.ts
/**
* Split a list of nodes based on whether `splitFunc` returns `true`.
* If `onlySplitOnFirstOccurrence` is set to true in the `options` object, then
* there will be at most two segments returned.
*/
function splitOnCondition(nodes, splitFunc = () => false, options) {
	if (!Array.isArray(nodes)) throw new Error(`Can only split an Array, not ${nodes}`);
	const { onlySplitOnFirstOccurrence = false } = options || {};
	const splitIndices = [];
	for (let i = 0; i < nodes.length; i++) if (splitFunc(nodes[i])) {
		splitIndices.push(i);
		if (onlySplitOnFirstOccurrence) break;
	}
	if (splitIndices.length === 0) return {
		segments: [nodes],
		separators: []
	};
	let separators = splitIndices.map((i) => nodes[i]);
	let segments = splitIndices.map((splitEnd, i) => {
		const splitStart = i === 0 ? 0 : splitIndices[i - 1] + 1;
		return nodes.slice(splitStart, splitEnd);
	});
	segments.push(nodes.slice(splitIndices[splitIndices.length - 1] + 1, nodes.length));
	return {
		segments,
		separators
	};
}
//#endregion
//#region libs/split-on-macro.ts
/**
* Split an array of AST nodes based on a macro. An object `{segments: [], macros: []}`
* is returned. The original array is reconstructed as
* `segments[0] + macros[0] + segments[1] + ...`.
*
* @param {[object]} ast
* @param {(string|[string])} macroName
* @returns {{segments: [object], macros: [object]}}
*/
function splitOnMacro(ast, macroName) {
	if (typeof macroName === "string") macroName = [macroName];
	if (!Array.isArray(macroName)) throw new Error("Type coercion failed");
	const { segments, separators } = splitOnCondition(ast, match.createMacroMatcher(macroName));
	return {
		segments,
		macros: separators
	};
}
//#endregion
//#region libs/unsplit-on-macro.ts
/**
* Does the reverse of `splitOnMacro`
*/
function unsplitOnMacro({ segments, macros }) {
	if (segments.length === 0) {
		console.warn("Trying to join zero segments");
		return [];
	}
	if (segments.length !== macros.length + 1) console.warn("Mismatch between lengths of macros and segments when trying to unsplit");
	let ret = segments[0];
	for (let i = 0; i < macros.length; i++) ret = ret.concat(macros[i]).concat(segments[i + 1]);
	return ret;
}
//#endregion
//#region libs/array-join.ts
/**
* Joins an array of arrays with the item `sep`
*/
function arrayJoin(array, sep) {
	return array.flatMap((item, i) => {
		if (i === 0) return item;
		if (Array.isArray(sep)) return [...sep, ...item];
		else return [sep, ...item];
	});
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to manipulate `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you want break apart or join an array of nodes based on a condition. For example,
* this is used to split on `&` characters in the `align` environment.
*/
//#endregion
export { arrayJoin, splitOnCondition, splitOnMacro, unsplitOnMacro };

//# sourceMappingURL=index.js.map