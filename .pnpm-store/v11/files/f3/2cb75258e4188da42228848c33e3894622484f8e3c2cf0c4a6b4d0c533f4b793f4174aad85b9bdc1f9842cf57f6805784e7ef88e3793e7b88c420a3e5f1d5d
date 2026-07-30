import { match } from "@unified-latex/unified-latex-util-match";
import { printRaw } from "@unified-latex/unified-latex-util-print-raw";
import Trie from "trie-prefix-tree";
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
				if (printRaw(node.env) === printRaw(token.env)) return i;
				break;
			case "string":
				if (node.content === token.content) return i;
				if (allowSubstringMatches && node.content.indexOf(token.content) >= 0) return i;
				break;
		}
		if (onlySkipWhitespaceAndComments && !match.whitespace(node) && !match.comment(node)) return null;
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
	if (Array.isArray(prefixes)) prefixes = Trie(prefixes);
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
		if (!match.string(node)) break;
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
export { Trie, prefixMatch, scan };

//# sourceMappingURL=index.js.map