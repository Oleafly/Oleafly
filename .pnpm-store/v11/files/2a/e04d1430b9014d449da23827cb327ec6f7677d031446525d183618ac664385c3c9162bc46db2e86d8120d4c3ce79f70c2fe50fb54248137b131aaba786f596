import { visit } from "@unified-latex/unified-latex-util-visit";
import { match } from "@unified-latex/unified-latex-util-match";
import { trim, trimEnd, trimStart } from "@unified-latex/unified-latex-util-trim";
import { splitOnCondition, unsplitOnMacro } from "@unified-latex/unified-latex-util-split";
//#region libs/replace-node.ts
/**
* Recursively replace nodes in `ast`. The `visitor` function is called on each node. If
* `visitor` returns a node or an array of nodes, those nodes replace the node passed to `visitor`.
* If `null` is returned, the node is deleted. If `undefined` is returned, no replacement happens.
*/
function replaceNode(ast, visitor) {
	visit(ast, { leave: (node, info) => {
		let replacement = visitor(node, info);
		if (typeof replacement === "undefined" || replacement === node) return;
		if (!info.containingArray || info.index == null) throw new Error("Trying to replace node, but cannot find containing array");
		if (replacement === null || Array.isArray(replacement) && replacement.length === 0) {
			info.containingArray.splice(info.index, 1);
			return info.index;
		}
		if (!Array.isArray(replacement)) replacement = [replacement];
		info.containingArray.splice(info.index, 1, ...replacement);
		return info.index + replacement.length;
	} });
}
//#endregion
//#region libs/utils/significant-node.ts
/**
* Returns the first non-whitespace/non-comment node in `nodes`. If there is no such
* node, `null` is returned.
*/
function firstSignificantNode(nodes, parbreaksAreInsignificant) {
	const index = firstSignificantNodeIndex(nodes, parbreaksAreInsignificant);
	if (index == null) return null;
	return nodes[index];
}
/**
* Returns the last non-whitespace/non-comment node in `nodes`. If there is no such
* node, `null` is returned.
*/
function lastSignificantNode(nodes, parbreaksAreInsignificant) {
	const index = lastSignificantNodeIndex(nodes, parbreaksAreInsignificant);
	if (index == null) return null;
	return nodes[index];
}
/**
* Returns the index of the last non-whitespace/non-comment node in `nodes`. If there is no such
* node, `null` is returned.
*/
function lastSignificantNodeIndex(nodes, parbreaksAreInsignificant) {
	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (match.whitespace(node) || match.comment(node) || parbreaksAreInsignificant && match.parbreak(node)) continue;
		return i;
	}
}
/**
* Returns the index of the first non-whitespace/non-comment node in `nodes`. If there is no such
* node, `null` is returned.
*/
function firstSignificantNodeIndex(nodes, parbreaksAreInsignificant) {
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (match.whitespace(node) || match.comment(node) || parbreaksAreInsignificant && match.parbreak(node)) continue;
		return i;
	}
}
//#endregion
//#region libs/utils/join-without-excess-whitespace.ts
/**
* Is the node space-like? I.e., is it whitespace or
* a comment with leading whitespace?
*/
function isSpaceLike(node) {
	return match.whitespace(node) || match.comment(node) && Boolean(node.leadingWhitespace);
}
/**
* Similar to `head.push(...tail)` except that whitespace at the start
* of `tail` and the end of `head` is collapsed.
*/
function joinWithoutExcessWhitespace(head, tail) {
	if (tail.length === 0) return;
	if (head.length === 0) {
		head.push(...tail);
		return;
	}
	const headEnd = head[head.length - 1];
	const tailStart = tail[0];
	if (match.whitespace(headEnd) && match.whitespace(tailStart)) {
		head.push(...tail.slice(1));
		return;
	}
	if (!isSpaceLike(headEnd) || !isSpaceLike(tailStart)) {
		if (match.whitespace(headEnd) && match.comment(tailStart)) {
			const comment = {
				type: "comment",
				content: tailStart.content,
				sameline: true,
				leadingWhitespace: true
			};
			tail = tail.slice(1);
			trimStart(tail);
			head.pop();
			head.push(comment, ...tail);
			return;
		}
		head.push(...tail);
		return;
	}
	if (match.comment(headEnd) && match.comment(tailStart)) {
		if (tailStart.leadingWhitespace || tailStart.sameline) {
			head.push({
				type: "comment",
				content: tailStart.content
			}, ...tail.slice(1));
			return;
		}
		head.push(...tail);
		return;
	}
	let comment = match.comment(headEnd) ? headEnd : tailStart;
	if (!match.comment(comment)) throw new Error(`Expected a comment but found ${JSON.stringify(comment)}`);
	if (!comment.leadingWhitespace || !comment.sameline) comment = {
		type: "comment",
		content: comment.content,
		leadingWhitespace: true,
		sameline: true
	};
	head.pop();
	head.push(comment, ...tail.slice(1));
}
//#endregion
//#region libs/utils/wrap-significant-content.ts
/**
* Wraps `content` in the specified wrapper. This command is roughly equivalent to
* `wrapper(content)` except that leading and trailing whitespace and comments are extracted
* from `content` and moved to the front or back of the return array. For example,
* `[" ", "foo", "bar", "% xxx"]` -> `[" ", wrapped(["foo", "bar"]), "% xxx"]`.
*
*/
function wrapSignificantContent(content, wrapper) {
	let hoistUntil = 0;
	let hoistAfter = content.length;
	for (let i = 0; i < content.length; i++) {
		if (match.whitespace(content[i]) || match.comment(content[i])) {
			hoistUntil = i + 1;
			continue;
		}
		break;
	}
	for (let j = content.length - 1; j >= 0; j--) {
		if (match.whitespace(content[j]) || match.comment(content[j])) {
			hoistAfter = j;
			continue;
		}
		break;
	}
	if (hoistUntil === 0 && hoistAfter === content.length) return ensureArray(wrapper(content));
	const frontMatter = content.slice(0, hoistUntil);
	const middle = content.slice(hoistUntil, hoistAfter);
	const backMatter = content.slice(hoistAfter, content.length);
	return frontMatter.concat(wrapper(middle), backMatter);
}
function ensureArray(x) {
	if (!Array.isArray(x)) return [x];
	return x;
}
//#endregion
//#region libs/utils/replace-streaming-command-in-array.ts
/**
* Replace commands identified by `isStreamingCommand` with the return value of `replacer`.
* E.g., the array `[head, streamingCommand, ...tail]` will become `[head, replacer(tail, streamingCommand)]`.
* This function does not split based on parbreaks/etc.. It is right-associative and returns
* the streaming commands that were encountered.
*/
function replaceStreamingCommandInArray(nodes, isStreamingCommand, replacer) {
	while (nodes.length > 0 && isStreamingCommand(nodes[nodes.length - 1])) {
		nodes.pop();
		trimEnd(nodes);
	}
	const foundStreamingCommands = [];
	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (isStreamingCommand(node)) {
			const wrapper = (content) => replacer(content, node);
			let tail = nodes.slice(i + 1);
			trimStart(tail);
			tail = wrapSignificantContent(tail, wrapper);
			foundStreamingCommands.push(node);
			nodes.splice(i);
			joinWithoutExcessWhitespace(nodes, tail);
		}
	}
	return { foundStreamingCommands };
}
//#endregion
//#region libs/replace-streaming-command.ts
/**
* Process streaming commands in a group. If needed, "escape" the group.
* For example, `{\bfseries xx}` -> `\textbf{xx}`, but `{foo \bfseries xx}` -> `{foo \textbf{xx}}`.
*/
function replaceStreamingCommandInGroup(group, isStreamingCommand, replacer, options) {
	const content = group.content;
	let popFromGroup = isStreamingCommand(firstSignificantNode(content));
	let innerProcessed = replaceStreamingCommand(content, isStreamingCommand, replacer, options);
	if (innerProcessed.length === 0) return [];
	if (popFromGroup) return innerProcessed;
	else return [{
		type: "group",
		content: innerProcessed
	}];
}
/**
* Given a group or a node array, look for streaming commands (e.g., `\bfseries`) and replace them
* with the specified macro. The "arguments" of the streaming command are passed to `replacer` and the return
* value of `replacer` is inserted into the stream.
*
* By default, this command will split at parbreaks (since commands like `\textbf{...} do not accept parbreaks in their
* contents) and call `replacer` multiple times, once per paragraph.
*
* Commands are also split at environments and at any macros listed in `macrosThatBreakPars`.
*/
function replaceStreamingCommand(ast, isStreamingCommand, replacer, options) {
	if (typeof isStreamingCommand !== "function") throw new Error(`'isStreamingCommand' must be a function, not '${typeof isStreamingCommand}'`);
	const { macrosThatBreakPars = [
		"part",
		"chapter",
		"section",
		"subsection",
		"subsubsection",
		"vspace",
		"smallskip",
		"medskip",
		"bigskip",
		"hfill"
	], environmentsThatDontBreakPars = [] } = options || {};
	let processedContent = [];
	if (match.group(ast)) processedContent = replaceStreamingCommandInGroup(ast, isStreamingCommand, replacer);
	if (Array.isArray(ast)) {
		const nodes = ast;
		let scanIndex = nodes.length;
		let sliceIndex = scanIndex;
		while (scanIndex > 0 && (isStreamingCommand(nodes[scanIndex - 1]) || match.whitespace(nodes[scanIndex - 1]))) {
			scanIndex--;
			if (isStreamingCommand(nodes[scanIndex])) sliceIndex = scanIndex;
		}
		if (sliceIndex !== nodes.length) nodes.splice(sliceIndex);
		const macroThatBreaks = match.createMacroMatcher(macrosThatBreakPars);
		const envThatDoesntBreak = match.createEnvironmentMatcher(environmentsThatDontBreakPars);
		const isPar = (node) => match.parbreak(node) || match.macro(node, "par") || macroThatBreaks(node) || match.environment(node) && !envThatDoesntBreak(node) || node.type === "displaymath";
		const splitByPar = splitOnCondition(nodes, isPar);
		splitByPar.separators = splitByPar.separators.map((sep) => match.macro(sep, "par") ? { type: "parbreak" } : sep);
		const replacers = [];
		let segments = splitByPar.segments.map((segment) => {
			if (segment.length === 0) return segment;
			function applyAccumulatedReplacers(nodes) {
				if (replacers.length === 0) return nodes;
				return wrapSignificantContent(nodes, composeReplacers(replacers));
			}
			const { foundStreamingCommands } = replaceStreamingCommandInArray(segment, isStreamingCommand, replacer);
			const ret = applyAccumulatedReplacers(segment);
			foundStreamingCommands.forEach((macro) => {
				replacers.push((nodes) => {
					const ret = replacer(nodes, macro);
					if (!Array.isArray(ret)) return [ret];
					return ret;
				});
			});
			return ret;
		});
		if (segments.length > 1) segments.forEach((segment, i) => {
			if (i === 0) trimEnd(segment);
			else if (i === segments.length - 1) trimStart(segment);
			else trim(segment);
		});
		processedContent = unsplitOnMacro({
			segments,
			macros: splitByPar.separators
		});
	}
	return processedContent;
}
/**
* Given a sequence of replacer functions `[f, g, h]` return
* `h \circ g \circ f`
*
* @param {((nodes: Ast.Node[]) => Ast.Node)[]} replacers
* @returns {(nodes: Ast.Node[]) => Ast.Node}
*/
function composeReplacers(replacers) {
	if (replacers.length === 0) throw new Error("Cannot compose zero replacement functions");
	return (nodes) => {
		let ret = nodes;
		for (let i = 0; i < replacers.length; i++) {
			const func = replacers[i];
			ret = func(ret);
		}
		return ret;
	};
}
//#endregion
//#region libs/replace-node-during-visit.ts
/**
* Replaces the current node with `replacement`. It is assumed that the current
* node is in an array that is a child of a parent element. If this is not the case,
* the function will error.
*/
function replaceNodeDuringVisit(replacement, info) {
	const parent = info.parents[0];
	if (!parent) throw new Error(`Cannot replace node: parent not found`);
	const container = parent[info.key];
	if (!Array.isArray(container)) throw new Error(`Cannot replace node: containing array not found`);
	if (info.index == null) throw new Error(`Cannot replace node: node index undefined`);
	if (!Array.isArray(replacement)) container[info.index] = replacement;
	else container.splice(info.index, 1, ...replacement);
}
//#endregion
//#region libs/unified-latex-streaming-command.ts
/**
* Unified plugin to replace all found streaming commands with their argument-style equivalents.
* This only applies to sections of the tree with no math ancestor.
*
* @param options.replacer A record of macro names and replacer functions. A replacer function accepts content and the original streaming command and is expected to return the argument-style command. It may be called multiple times per streaming command.
*/
var unifiedLatexReplaceStreamingCommands = function unifiedLatexReplaceStreamingCommands(options) {
	const { replacers = {} } = options || {};
	const isReplaceable = match.createMacroMatcher(replacers);
	return (tree) => {
		visit(tree, (group, info) => {
			if (info.context.hasMathModeAncestor || !group.content.some(isReplaceable)) return;
			let fixed = replaceStreamingCommand(group, isReplaceable, (content, command) => {
				return replacers[command.content](content, command);
			});
			if (!info.containingArray || info.index == null) return;
			const prevToken = info.containingArray[info.index - 1];
			const nextToken = info.containingArray[info.index + 1];
			if (match.whitespaceLike(prevToken) && match.whitespaceLike(fixed[0])) trimStart(fixed);
			if (match.whitespaceLike(nextToken) && match.whitespaceLike(fixed[fixed.length - 1])) trimEnd(fixed);
			replaceNodeDuringVisit(fixed, info);
		}, { test: match.group });
		visit(tree, (nodes, info) => {
			if (info.context.hasMathModeAncestor || !nodes.some(isReplaceable)) return;
			const replaced = replaceStreamingCommand(nodes, isReplaceable, (content, command) => {
				return replacers[command.content](content, command);
			});
			if (replaced !== nodes) {
				nodes.length = 0;
				nodes.push(...replaced);
			}
		}, {
			includeArrays: true,
			test: Array.isArray
		});
	};
};
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to help modify a `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you want to recursively replace particular AST nodes.
*/
//#endregion
export { firstSignificantNode, firstSignificantNodeIndex, lastSignificantNode, lastSignificantNodeIndex, replaceNode, replaceNodeDuringVisit, replaceStreamingCommand, replaceStreamingCommandInGroup, unifiedLatexReplaceStreamingCommands };

//# sourceMappingURL=index.js.map