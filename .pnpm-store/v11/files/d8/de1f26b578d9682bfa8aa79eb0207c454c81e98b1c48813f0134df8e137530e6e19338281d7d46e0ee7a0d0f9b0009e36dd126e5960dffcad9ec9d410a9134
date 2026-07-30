import { constantsEx } from "./classifyCharacter.js";
import { constants } from "micromark-util-symbol";

//#region src/categoryUtil.ts
/**
* `true` if the code point represents a [Unicode whitespace character](https://spec.commonmark.org/0.31.2/#unicode-whitespace-character).
*
* @param category the return value of `classifyCharacter`.
* @returns `true` if the code point represents a Unicode whitespace character
*/
function isUnicodeWhitespace(category) {
	return Boolean(category & constants.characterGroupWhitespace);
}
/**
* `true` if the code point represents a [non-CJK punctuation character](https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md#non-cjk-punctuation-character).
*
* @param category the return value of `classifyCharacter`.
* @returns `true` if the code point represents a non-CJK punctuation character
*/
function isNonCjkPunctuation(category) {
	return (category & constantsEx.cjkPunctuation) === constants.characterGroupPunctuation;
}
/**
* `true` if the code point represents a [CJK character](https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md#cjk-character).
*
* @param category the return value of `classifyCharacter`.
* @returns `true` if the code point represents a CJK character
*/
function isCjk(category) {
	return Boolean(category & constantsEx.cjk);
}
/**
* `true` if the code point represents an [Ideographic Variation Selector](https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md#ideographi-variation-selector).
*
* @param category the return value of `classifyCharacter`.
* @returns `true` if the code point represents an IVS
*/
function isIvs(category) {
	return category === constantsEx.ivs;
}
/**
* `true` if {@link isCjk} or {@link isIvs}.
*
* @param category the return value of {@link classifyCharacter}.
* @returns `true` if the code point represents a CJK or IVS
*/
function isCjkOrIvs(category) {
	return Boolean(category & constantsEx.cjkOrIvs);
}
/**
* `true` if the code point represents a [Non-emoji General-use Variation Selector](https://github.com/tats-u/markdown-cjk-friendly/blob/main/specification.md#non-emoji-general-use-variation-selector).
*
* @param category the return value of `classifyCharacter`.
* @returns `true` if the code point represents an Non-emoji General-use Variation Selector
*/
function isNonEmojiGeneralUseVS(category) {
	return category === constantsEx.nonEmojiGeneralUseVS;
}
/**
* `true` if the code point represents a [Unicode whitespace character](https://spec.commonmark.org/0.31.2/#unicode-whitespace-character) or a [Unicode punctuation character](https://spec.commonmark.org/0.31.2/#unicode-punctuation-character).
*
* @param category the return value of `classifyCharacter`.
* @returns `true` if the code point represents a space or punctuation
*/
function isSpaceOrPunctuation(category) {
	return Boolean(category & constantsEx.spaceOrPunctuation);
}

//#endregion
export { isCjk, isCjkOrIvs, isIvs, isNonCjkPunctuation, isNonEmojiGeneralUseVS, isSpaceOrPunctuation, isUnicodeWhitespace };