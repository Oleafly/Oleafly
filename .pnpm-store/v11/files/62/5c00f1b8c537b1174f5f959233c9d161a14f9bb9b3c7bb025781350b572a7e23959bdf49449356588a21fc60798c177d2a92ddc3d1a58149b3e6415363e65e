Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let _unified_latex_unified_latex_util_match = require("@unified-latex/unified-latex-util-match");
let _unified_latex_unified_latex_util_print_raw = require("@unified-latex/unified-latex-util-print-raw");
let trie_prefix_tree = require("trie-prefix-tree");
trie_prefix_tree = __toESM(trie_prefix_tree);
//#region libs/scan.ts
/**
* Scan `nodes` looking for the first occurrence of `token`.
* If `options.onlySkipWhitespaceAndComments==true`, then the scan
* will only skip whitespace/comment nodes.
*/
function scan(nodes, token, options) {
	const { startIndex, onlySkipWhitespaceAndComments, allowSubstringMatches } = options || {};
	if (typeof token === "string") token = {
		type: "string",
		content: token
	};
	for (let i = startIndex || 0; i < nodes.length; i++) {
		const node = nodes[i];
		if (node.type === token.type) switch (node.type) {
			case "comment":
			case "displaymath":
			case "inlinemath":
			case "root":
			case "parbreak":
			case "whitespace":
			case "verb":
			case "verbatim":
			case "group": return i;
			case "macro":
				if (node.content === token.content) return i;
				break;
			case "environment":
			case "mathenv":
				if ((0, _unified_latex_unified_latex_util_print_raw.printRaw)(node.env) === (0, _unified_latex_unified_latex_util_print_raw.printRaw)(token.env)) return i;
				break;
			case "string":
				if (node.content === token.content) return i;
				if (allowSubstringMatches && node.content.indexOf(token.content) >= 0) return i;
				break;
		}
		if (onlySkipWhitespaceAndComments && !_unified_latex_unified_latex_util_match.match.whitespace(node) && !_unified_latex_unified_latex_util_match.match.comment(node)) return null;
	}
	return null;
}
//#endregion
//#region libs/prefix-match.ts
/**
* Efficiently search for a large number of strings using a prefix-tree.
* The longest match is returned.
*
* @param options.startIndex the index to start scanning at. Defaults to 0.
* @param options.matchSubstrings whether to allow matching only part of a substring.
* @param options.assumeOneCharStrings assume that all strings are one character long (for example, like they are in math mode)
*/
function prefixMatch(nodes, prefixes, options) {
	const { startIndex = 0, matchSubstrings = false, assumeOneCharStrings = false } = options || {};
	if (typeof prefixes === "string") prefixes = [prefixes];
	if (Array.isArray(prefixes)) prefixes = (0, trie_prefix_tree.default)(prefixes);
	const prefixTree = prefixes;
	const history = {
		lastPrefix: "",
		lastWord: "",
		index: startIndex,
		partialMatch: ""
	};
	/**
	* Try to match the next character. If it matches,
	* record it properly in the `history` object.
	*/
	function tryToMatchNextChar(char, index) {
		let ret = false;
		if (prefixTree.isPrefix(history.lastPrefix + char)) {
			history.lastPrefix += char;
			history.index = index;
			ret = true;
		}
		if (prefixTree.hasWord(history.lastPrefix)) history.lastWord = history.lastPrefix;
		return ret;
	}
	for (let i = 0; startIndex + i < nodes.length; i++) {
		const node = nodes[startIndex + i];
		if (!_unified_latex_unified_latex_util_match.match.string(node)) break;
		if (assumeOneCharStrings && node.content.length !== 1) break;
		if (matchSubstrings) {
			let fullMatch = true;
			history.partialMatch = "";
			for (let j = 0; j < node.content.length; j++) {
				const char = node.content[j];
				if (tryToMatchNextChar(char, startIndex + i)) history.partialMatch += char;
				else {
					fullMatch = false;
					break;
				}
			}
			if (fullMatch) history.partialMatch = "";
			else break;
		} else if (!tryToMatchNextChar(node.content, startIndex + i)) break;
	}
	return history.lastWord ? {
		match: history.lastWord,
		endNodeIndex: history.index,
		endNodePartialMatch: history.partialMatch ? history.partialMatch : null
	} : null;
}
//#endregion
//#region index.ts
/**
* ## What is this?
*
* Functions to analyze `unified-latex` Abstract Syntax Tree (AST).
*
* ## When should I use this?
*
* If you want to look for particular AST nodes in an array; useful when making plugins.
*/
//#endregion
exports.Trie = trie_prefix_tree.default;
exports.prefixMatch = prefixMatch;
exports.scan = scan;

//# sourceMappingURL=index.cjs.map