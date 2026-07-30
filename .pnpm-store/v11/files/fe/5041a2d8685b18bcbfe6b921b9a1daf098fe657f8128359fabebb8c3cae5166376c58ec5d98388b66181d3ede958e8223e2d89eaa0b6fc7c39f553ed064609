import { eastAsianWidthType } from "get-east-asian-width";

//#region src/characterWithNonBmp.ts
function isEmoji(uc) {
	return /^\p{Emoji_Presentation}/u.test(String.fromCodePoint(uc));
}
/**
* Check if `uc` is CJK or IVS
*
* @param uc code point
* @returns `true` if `uc` is CJK, `null` if IVS, or `false` if neither
*/
function cjkOrIvs(uc) {
	if (!uc || uc < 4352) return false;
	switch (eastAsianWidthType(uc)) {
		case "fullwidth":
		case "halfwidth": return true;
		case "wide": return !isEmoji(uc);
		case "narrow": return false;
		case "ambiguous": return 917760 <= uc && uc <= 917999 ? null : false;
		case "neutral": return /^\p{sc=Hangul}/u.test(String.fromCodePoint(uc));
	}
}
function isCjkAmbiguousPunctuation(main, vs) {
	if (vs !== 65025 || !main || main < 8216) return false;
	return main === 8216 || main === 8217 || main === 8220 || main === 8221;
}
/**
* Check whether the character code represents Non-emoji General-use Variation Selector (U+FE00-U+FE0E).
*/
function nonEmojiGeneralUseVS(code) {
	return code !== null && code >= 65024 && code <= 65038;
}
/**
* Check whether the character code represents Unicode punctuation.
*
* A **Unicode punctuation** is a character in the Unicode `Pc` (Punctuation,
* Connector), `Pd` (Punctuation, Dash), `Pe` (Punctuation, Close), `Pf`
* (Punctuation, Final quote), `Pi` (Punctuation, Initial quote), `Po`
* (Punctuation, Other), or `Ps` (Punctuation, Open) categories, or an ASCII
* punctuation (see `asciiPunctuation`).
*
* See:
* **\[UNICODE]**:
* [The Unicode Standard](https://www.unicode.org/versions/).
* Unicode Consortium.
*
* @param code
*   Code.
* @returns
*   Whether it matches.
*/
const unicodePunctuation = regexCheck(/\p{P}|\p{S}/u);
/**
* Check whether the character code represents Unicode whitespace.
*
* Note that this does handle micromark specific markdown whitespace characters.
* See `markdownLineEndingOrSpace` to check that.
*
* A **Unicode whitespace** is a character in the Unicode `Zs` (Separator,
* Space) category, or U+0009 CHARACTER TABULATION (HT), U+000A LINE FEED (LF),
* U+000C (FF), or U+000D CARRIAGE RETURN (CR) (**\[UNICODE]**).
*
* See:
* **\[UNICODE]**:
* [The Unicode Standard](https://www.unicode.org/versions/).
* Unicode Consortium.
*
* @param code
*   Code.
* @returns
*   Whether it matches.
*/
const unicodeWhitespace = regexCheck(/\s/);
/**
* Create a code check from a regex.
*
* @param regex
*   Expression.
* @returns
*   Check.
*/
function regexCheck(regex) {
	return check;
	/**
	* Check whether a code matches the bound regex.
	*
	* @param code
	*   Character code.
	* @returns
	*   Whether the character code matches the bound regex.
	*/
	function check(code) {
		return code !== null && code > -1 && regex.test(String.fromCodePoint(code));
	}
}

//#endregion
export { cjkOrIvs, isCjkAmbiguousPunctuation, nonEmojiGeneralUseVS, unicodePunctuation, unicodeWhitespace };