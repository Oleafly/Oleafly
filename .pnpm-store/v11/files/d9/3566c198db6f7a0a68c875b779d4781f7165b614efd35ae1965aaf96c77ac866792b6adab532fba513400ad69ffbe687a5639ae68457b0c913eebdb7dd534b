import { arg } from "@unified-latex/unified-latex-builder";
import { match } from "@unified-latex/unified-latex-util-match";
import { updateRenderInfo } from "@unified-latex/unified-latex-util-render-info";
import { lastSignificantNodeIndex } from "@unified-latex/unified-latex-util-replace";
import { splitOnMacro } from "@unified-latex/unified-latex-util-split";
import { trim, trimEnd } from "@unified-latex/unified-latex-util-trim";
//#region utils/enumerate.ts
/**
* Clean up any whitespace issues in an enumerate environment. In particular,
*      * Remove any leading or ending whitespace
*      * Ensure there is a par between occurrences of `\item`
*      * Ensure there is whitespace after each occurrence of `\item` provided there is content there
* `itemName` can be used to set what the "item" macro is called.
*
* This function attaches content following a `\item` to the `\item` macro with
* `openMark` and `closeMark` set to empty. This allows hanging-indents to be rendered.
*/
function cleanEnumerateBody(ast, itemName = "item") {
	let { segments, macros } = splitOnMacro(ast, itemName);
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (i === 0) trimEnd(segment);
		else trim(segment);
		if (segment.length > 0 && i > 0) segment.unshift({ type: "whitespace" });
	}
	let insertParbreakBefore = /* @__PURE__ */ new WeakSet();
	let body = macros.flatMap((node, i) => {
		const segment = segments[i + 1];
		const trailingComments = popTrailingComments(segment);
		node.args = node.args || [];
		node.args.push(arg(segment, {
			openMark: "",
			closeMark: ""
		}));
		updateRenderInfo(node, { inParMode: true });
		if (i > 0 || segments[0]?.length > 0) insertParbreakBefore.add(node);
		return [node, ...trailingComments];
	});
	body = body.flatMap((node) => insertParbreakBefore.has(node) ? [{ type: "parbreak" }, node] : node);
	body.unshift(...segments[0]);
	for (let i = 0; i < body.length - 1; i++) {
		const node = body[i];
		const nextNode = body[i + 1];
		if (!match.parbreak(nextNode)) continue;
		if (match.comment(node)) node.suffixParbreak = true;
		if (match.macro(node) && node.args && node.args[node.args.length - 1].closeMark === "") {
			const args = node.args[node.args.length - 1].content;
			const lastArg = args[args.length - 1];
			if (match.comment(lastArg)) lastArg.suffixParbreak = true;
		}
	}
	return body;
}
/**
* Removes and returns any number of trailing comments/parbreaks from `nodes`.
*/
function popTrailingComments(nodes) {
	let lastNodeIndex = lastSignificantNodeIndex(nodes, true);
	if (lastNodeIndex === nodes.length - 1 || lastNodeIndex == null && nodes.length === 0) return [];
	if (lastNodeIndex == null) lastNodeIndex = -1;
	return nodes.splice(lastNodeIndex + 1);
}
//#endregion
export { cleanEnumerateBody as t };

//# sourceMappingURL=enumerate-BztQuEpe.js.map