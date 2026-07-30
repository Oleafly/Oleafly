Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let _unified_latex_unified_latex_builder = require("@unified-latex/unified-latex-builder");
let _unified_latex_unified_latex_util_argspec = require("@unified-latex/unified-latex-util-argspec");
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_scan = require("@unified-latex/unified-latex-util-scan");
let _unified_latex_unified_latex_util_render_info = require("@unified-latex/unified-latex-util-render-info");
let _unified_latex_unified_latex_util_visit = require("@unified-latex/unified-latex-util-visit");
//#region libs/gobble-single-argument.ts
/**
* Gobbles an argument of whose type is specified
* by `argSpec` starting at the position `startPos`.
* If an argument couldn't be found, `argument` will be `null`.
*/
function gobbleSingleArgument(nodes, argSpec, startPos = 0) {
	if (typeof argSpec === "string" || !argSpec.type) throw new Error(`argSpec must be an already-parsed argument specification, not "${JSON.stringify(argSpec)}"`);
	let argument = null;
	let currPos = startPos;
	const gobbleWhitespace = argSpec.noLeadingWhitespace ? () => {} : () => {
		while (currPos < nodes.length) {
			if (!_unified_latex_unified_latex_util_match.match.whitespace(nodes[currPos])) break;
			currPos++;
		}
	};
	const openMark = argSpec.openBrace || "";
	const closeMark = argSpec.closeBrace || "";
	const acceptGroup = (argSpec.type === "mandatory" || argSpec.type === "optional") && openMark === "{" && closeMark === "}";
	gobbleWhitespace();
	const currNode = nodes[currPos];
	if (currNode == null || _unified_latex_unified_latex_util_match.match.comment(currNode) || _unified_latex_unified_latex_util_match.match.parbreak(currNode)) return {
		argument,
		nodesRemoved: 0
	};
	switch (argSpec.type) {
		case "mandatory": if (acceptGroup) {
			let content = [currNode];
			if (_unified_latex_unified_latex_util_match.match.group(currNode)) content = currNode.content;
			argument = (0, _unified_latex_unified_latex_builder.arg)(content, {
				openMark,
				closeMark
			});
			currPos++;
			break;
		} else {
			const bracePos = findBracePositions(nodes, currPos, openMark, closeMark);
			if (bracePos) {
				argument = (0, _unified_latex_unified_latex_builder.arg)(nodes.slice(bracePos[0] + 1, bracePos[1]), {
					openMark,
					closeMark
				});
				currPos = bracePos[1] + 1;
				break;
			}
		}
		case "optional":
			if (acceptGroup && _unified_latex_unified_latex_util_match.match.group(currNode)) {
				argument = (0, _unified_latex_unified_latex_builder.arg)(currNode.content, {
					openMark,
					closeMark
				});
				currPos++;
				break;
			}
			const bracePos = findBracePositions(nodes, currPos, openMark, closeMark);
			if (bracePos) {
				argument = (0, _unified_latex_unified_latex_builder.arg)(nodes.slice(bracePos[0] + 1, bracePos[1]), {
					openMark,
					closeMark
				});
				currPos = bracePos[1] + 1;
				break;
			}
			break;
		case "optionalStar":
		case "optionalToken": {
			const bracePos = findBracePositions(nodes, currPos, argSpec.type === "optionalStar" ? "*" : argSpec.token);
			if (bracePos) {
				argument = (0, _unified_latex_unified_latex_builder.arg)(currNode, {
					openMark: "",
					closeMark: ""
				});
				currPos = bracePos[0] + 1;
			}
			break;
		}
		case "until": {
			if (argSpec.stopTokens.length > 1) {
				console.warn(`"until" matches with multi-token stop conditions are not yet implemented`);
				break;
			}
			const rawToken = argSpec.stopTokens[0];
			let bracePos = findBracePositions(nodes, startPos, void 0, rawToken === " " ? { type: "whitespace" } : rawToken);
			if (!bracePos) break;
			argument = (0, _unified_latex_unified_latex_builder.arg)(nodes.slice(startPos, bracePos[1]), {
				openMark: "",
				closeMark: rawToken
			});
			currPos = bracePos[1];
			if (currPos < nodes.length) currPos++;
			break;
		}
		case "embellishment":
			for (const token of argSpec.embellishmentTokens) {
				const bracePos = findBracePositions(nodes, currPos, token);
				if (!bracePos) continue;
				let argNode = nodes[bracePos[0] + 1];
				argument = (0, _unified_latex_unified_latex_builder.arg)(_unified_latex_unified_latex_util_match.match.group(argNode) ? argNode.content : argNode, {
					openMark: token,
					closeMark: ""
				});
				currPos = bracePos[1] + 1;
				break;
			}
			break;
		default: console.warn(`Don't know how to find an argument of argspec type "${argSpec.type}"`);
	}
	const nodesRemoved = argument ? currPos - startPos : 0;
	nodes.splice(startPos, nodesRemoved);
	return {
		argument,
		nodesRemoved
	};
}
function cloneStringNode(node, content) {
	return Object.assign({}, node, { content });
}
/**
* Find the position of the open brace and the closing brace.
* Returns undefined if the brace isn't found.
* This may mutate `nodes`, if braces are not a kind of characters that are
* always parsed as a separate token
*/
function findBracePositions(nodes, startPos, openMark, closeMark) {
	const currNode = nodes[startPos];
	let openMarkPos = startPos;
	let closeMarkPos = startPos;
	if (openMark) {
		if (!_unified_latex_unified_latex_util_match.match.anyString(currNode)) return;
		if (!currNode.content.startsWith(openMark)) return;
		openMarkPos = startPos;
		if (currNode.content.length > openMark.length) {
			const nodeContent = currNode.content;
			currNode.content = openMark;
			nodes.splice(openMarkPos + 1, 0, cloneStringNode(currNode, nodeContent.slice(openMark.length)));
		}
		closeMarkPos = openMarkPos + 1;
	}
	if (!closeMark) {
		const argNode = nodes[closeMarkPos];
		if (!argNode) return;
		if (_unified_latex_unified_latex_util_match.match.anyString(argNode) && argNode.content.length > 1) {
			const argContent = argNode.content;
			argNode.content = argContent[0];
			nodes.splice(closeMarkPos + 1, 0, cloneStringNode(argNode, argContent.slice(1)));
		}
		return [openMarkPos, closeMarkPos];
	}
	closeMarkPos = (0, _unified_latex_unified_latex_util_scan.scan)(nodes, closeMark, {
		startIndex: closeMarkPos,
		allowSubstringMatches: true
	});
	if (closeMarkPos === null) return;
	const closingNode = nodes[closeMarkPos];
	if (_unified_latex_unified_latex_util_match.match.anyString(closingNode) && typeof closeMark === "string") {
		const closingNodeContent = closingNode.content;
		let closeMarkIndex = closingNodeContent.indexOf(closeMark);
		if (closingNodeContent.length > closeMark.length) {
			closingNode.content = closeMark;
			const prev = closingNodeContent.slice(0, closeMarkIndex);
			const next = closingNodeContent.slice(closeMarkIndex + closeMark.length);
			if (prev) {
				nodes.splice(closeMarkPos, 0, cloneStringNode(closingNode, prev));
				closeMarkPos++;
			}
			if (next) nodes.splice(closeMarkPos + 1, 0, cloneStringNode(closingNode, next));
		}
	}
	return [openMarkPos, closeMarkPos];
}
//#endregion
//#region libs/gobble-arguments.ts
/**
* Gobbles an argument of whose type is specified
* by `argSpec` starting at the position `startPos`. If an argument couldn't be found,
* `argument` will be `null`.
*/
function gobbleArguments(nodes, argSpec, startPos = 0) {
	if (typeof argSpec === "function") return argSpec(nodes, startPos);
	if (typeof argSpec === "string") argSpec = (0, _unified_latex_unified_latex_util_argspec.parse)(argSpec);
	const args = [];
	let nodesRemoved = 0;
	for (const spec of argSpec) if (spec.type === "embellishment") {
		const remainingTokens = new Set(spec.embellishmentTokens);
		const argForToken = Object.fromEntries(spec.embellishmentTokens.map((t, i) => {
			return [t, emptyArg("defaultArg" in spec ? spec.defaultArg?.[i] : void 0)];
		}));
		let { argument, nodesRemoved: removed } = gobbleSingleArgument(nodes, embellishmentSpec(remainingTokens), startPos);
		while (argument) {
			const token = argument.openMark;
			remainingTokens.delete(token);
			argForToken[token] = argument;
			nodesRemoved += removed;
			const newSpec = embellishmentSpec(remainingTokens);
			({argument, nodesRemoved: removed} = gobbleSingleArgument(nodes, newSpec, startPos));
		}
		args.push(...spec.embellishmentTokens.map((t) => argForToken[t]));
	} else {
		const { argument, nodesRemoved: removed } = gobbleSingleArgument(nodes, spec, startPos);
		const defaultArg = "defaultArg" in spec ? spec.defaultArg : void 0;
		args.push(argument || emptyArg(defaultArg));
		nodesRemoved += removed;
	}
	return {
		args,
		nodesRemoved
	};
}
/**
* Create an embellishment argspec from a set of tokens.
*/
function embellishmentSpec(tokens) {
	return {
		type: "embellishment",
		embellishmentTokens: [...tokens]
	};
}
/**
* Create an empty argument.
*/
function emptyArg(defaultArg) {
	const ret = (0, _unified_latex_unified_latex_builder.arg)([], {
		openMark: "",
		closeMark: ""
	});
	if (defaultArg != null) (0, _unified_latex_unified_latex_util_render_info.updateRenderInfo)(ret, { defaultArg });
	return ret;
}
//#endregion
//#region libs/attach-arguments.ts
/**
* Search (in a right-associative way) through the array for instances of
* `macros` and attach arguments to the macro. Argument signatures are
* specified by `macros[].signature`.
*
* Info stored in `macros[].renderInfo` will be attached to the node
* with attribute `_renderInfo`.
*/
function attachMacroArgsInArray(nodes, macros) {
	let currIndex;
	/**
	* Determine whether `node` matches one of the macros in `macros`.
	* Care is taken when matching because not all macros have
	* `\` as their escape token.
	*/
	const isRelevantMacro = _unified_latex_unified_latex_util_match.match.createMacroMatcher(macros);
	function gobbleUntilMacro() {
		while (currIndex >= 0 && !isRelevantMacro(nodes[currIndex])) currIndex--;
	}
	currIndex = nodes.length - 1;
	while (currIndex >= 0) {
		gobbleUntilMacro();
		if (currIndex < 0) return;
		const macroIndex = currIndex;
		const macro = nodes[macroIndex];
		const macroInfo = macros[macro.content];
		(0, _unified_latex_unified_latex_util_render_info.updateRenderInfo)(macro, macroInfo.renderInfo);
		const signatureOrParser = macroInfo.argumentParser || macroInfo.signature;
		if (signatureOrParser == null) {
			currIndex--;
			continue;
		}
		if (macro.args != null) {
			currIndex = macroIndex - 1;
			continue;
		}
		currIndex++;
		const { args } = gobbleArguments(nodes, signatureOrParser, currIndex);
		macro.args = args;
		currIndex = macroIndex - 1;
	}
}
/**
* Recursively search for and attach the arguments for a
* particular macro to its AST node. `macros` should
* contain a `signature` property which specifies the arguments
* signature in xparse syntax.
*/
function attachMacroArgs(tree, macros) {
	(0, _unified_latex_unified_latex_util_visit.visit)(tree, (nodes) => {
		attachMacroArgsInArray(nodes, macros);
	}, {
		includeArrays: true,
		test: Array.isArray
	});
}
//#endregion
//#region libs/unified-latex-attach-macro-arguments.ts
/**
* Unified plugin to attach macro arguments to the macros specified via the `macros`
* option.
*
* @param macros An object whose keys are macro names and values contains information about the macro and its argument signature.
*/
var unifiedLatexAttachMacroArguments = function unifiedLatexAttachMacroArguments(options) {
	return (tree) => {
		const { macros = {} } = options || {};
		if (Object.keys(macros).length === 0) console.warn("Attempting to attach macro arguments but no macros are specified.");
		(0, _unified_latex_unified_latex_util_visit.visit)(tree, (nodes) => {
			attachMacroArgsInArray(nodes, macros);
		}, {
			includeArrays: true,
			test: Array.isArray
		});
	};
};
//#endregion
//#region libs/get-args-content.ts
/**
* Returns the content of `args` for a macro or environment as an array. If an argument
* was omitted (e.g., because it was an optional arg that wasn't included), then `null` is returned.
*/
function getArgsContent(node) {
	if (!Array.isArray(node.args)) return [];
	return node.args.map((arg) => {
		if (arg.openMark === "" && arg.content.length === 0) return null;
		return arg.content;
	});
}
/**
* Returns the content of `args` for a macro or environment as an object whose keys are the "names"
* of each argument. These names of the arguments must be specified in the `_renderInfo` prop. If `_renderInfo`
* does not contain a `namedArguments` array, then an empty object will be returned.
*
* @namedArgumentsFallback - If `_renderInfo.namedArguments` is not provided, `namedArgumentsFallback` is ued.
*/
function getNamedArgsContent(node, namedArgumentsFallback = []) {
	const names = node._renderInfo?.namedArguments || namedArgumentsFallback;
	if (!Array.isArray(node.args) || !Array.isArray(names) || names.length === 0) return {};
	const ret = {};
	node.args.forEach((arg, i) => {
		const name = names[i];
		if (name == null) return;
		let val = arg.content;
		if (arg.openMark === "" && arg.content.length === 0) val = null;
		ret[name] = val;
	});
	return ret;
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to help modify and attach arguments to macros in a `unified-latex` Abstract Syntax Tree (AST).
*
* By default, TeX doesn't actually have a concept of macro "arguments". Instead, TeX searches the
* tokens after a macro and processes them according to the macro's rules. However, LaTeX attempts
* to make macros look like functions that accept arguments. To attach the "arguments" to a macro
* node, the `unified-latex` AST needs to be reparsed and manipulated.
*
* ## When should I use this?
*
* If you have custom macros that you want arguments attached to.
*
* If you know ahead of time which macros need arguments attached to them, use `unified-latex-util-parse`
* and pass in the appropriate macro info instead.
*/
//#endregion
exports.attachMacroArgs = attachMacroArgs;
exports.attachMacroArgsInArray = attachMacroArgsInArray;
exports.getArgsContent = getArgsContent;
exports.getNamedArgsContent = getNamedArgsContent;
exports.gobbleArguments = gobbleArguments;
exports.gobbleSingleArgument = gobbleSingleArgument;
exports.unifiedLatexAttachMacroArguments = unifiedLatexAttachMacroArguments;

//# sourceMappingURL=index.cjs.map