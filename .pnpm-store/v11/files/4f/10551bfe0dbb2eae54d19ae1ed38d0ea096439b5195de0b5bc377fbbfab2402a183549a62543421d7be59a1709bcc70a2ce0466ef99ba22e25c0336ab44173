import { cjkOrIvs, isCjkAmbiguousPunctuation, nonEmojiGeneralUseVS, unicodePunctuation, unicodeWhitespace } from "./characterWithNonBmp.js";
import { isNonEmojiGeneralUseVS, isUnicodeWhitespace } from "./categoryUtil.js";
import { codes, constants } from "micromark-util-symbol";
import { markdownLineEndingOrSpace } from "micromark-util-character";

//#region src/classifyCharacter.ts
let constantsEx;
(function(_constantsEx) {
	_constantsEx.spaceOrPunctuation = 3;
	_constantsEx.cjk = 4096;
	_constantsEx.cjkPunctuation = 4098;
	_constantsEx.ivs = 8192;
	_constantsEx.cjkOrIvs = 12288;
	_constantsEx.nonEmojiGeneralUseVS = 16384;
	_constantsEx.variationSelector = 24576;
	_constantsEx.ivsToCjkRightShift = 1;
})(constantsEx || (constantsEx = {}));
/**
* Classify whether a code represents whitespace, punctuation, or something
* else.
*
* Used for attention (emphasis, strong), whose sequences can open or close
* based on the class of surrounding characters.
*
* > 👉 **Note**: eof (`null`) is seen as whitespace.
*
* @param code
*   Code.
* @returns
*   Group.
*/
function classifyCharacter(code) {
	if (code === codes.eof || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return constants.characterGroupWhitespace;
	let value = 0;
	if (code >= 4352) {
		if (nonEmojiGeneralUseVS(code)) return constantsEx.nonEmojiGeneralUseVS;
		switch (cjkOrIvs(code)) {
			case null: return constantsEx.ivs;
			case true:
				value |= constantsEx.cjk;
				break;
		}
	}
	if (unicodePunctuation(code)) value |= constants.characterGroupPunctuation;
	return value;
}
/**}
* Classify whether a code represents whitespace, punctuation, or something else.
*
* Recognizes general-use variation selectors. Use this instead of {@linkcode classifyCharacter} for previous character.
*
* @param before result of {@linkcode classifyCharacter} of the preceding character.
* @param get2Previous a function that returns the code point of the character before the preceding character. Use lambda or {@linkcode Function.prototype.bind}.
* @param previous code point of the preceding character
* @returns
*   Group of the main code point of the preceding character. Use `isCjkOrIvs` to check whether it is CJK
*/
function classifyPrecedingCharacter(before, get2Previous, previous) {
	if (!isNonEmojiGeneralUseVS(before)) return before;
	const twoPrevious = get2Previous();
	const twoBefore = classifyCharacter(twoPrevious);
	return !twoPrevious || isUnicodeWhitespace(twoBefore) ? before : isCjkAmbiguousPunctuation(twoPrevious, previous) ? constantsEx.cjkPunctuation : stripIvs(twoBefore);
}
function stripIvs(twoBefore) {
	return twoBefore & ~constantsEx.ivs;
}

//#endregion
export { classifyCharacter, classifyPrecedingCharacter, constantsEx };