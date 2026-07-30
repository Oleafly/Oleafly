//#region src/codeUtil.ts
/**
* Check if the given code is a [High-Surrogate Code Unit](https://www.unicode.org/glossary/#high_surrogate_code_unit).
*
* A High-Surrogate Code Unit is the _first_ half of a [Surrogate Pair](https://www.unicode.org/glossary/#surrogate_pair).
*
* @param code Code.
* @returns `true` if the code is a High-Surrogate Code Unit, `false` otherwise.
*/
function isCodeHighSurrogate(code) {
	return Boolean(code && code >= 55296 && code <= 56319);
}
/**
* Check if the given code is a [Low-Surrogate Code Unit](https://www.unicode.org/glossary/#low_surrogate_code_unit).
*
* A Low-Surrogate Code Unit is the _second_ half of a [Surrogate Pair](https://www.unicode.org/glossary/#surrogate_pair).
* @param code
*   The character code to check.
* @returns
*   True if the code is a Low-Surrogate Code Unit, false otherwise.
*/
function isCodeLowSurrogate(code) {
	return Boolean(code && code >= 56320 && code <= 57343);
}
/**
* If `code` is a [Low-Surrogate Code Unit](https://www.unicode.org/glossary/#low_surrogate_code_unit), try to get a genuine previous [Unicode Scalar Value](https://www.unicode.org/glossary/#unicode_scalar_value) corresponding to the Low-Surrogate Code Unit.
* @param code a tentative previous [code unit](https://www.unicode.org/glossary/#code_unit) less than 65,536, including a Low-Surrogate one
* @param nowPoint `this.now()` (`this` = `TokenizeContext`)
* @param sliceSerialize `this.sliceSerialize` (`this` = `TokenizeContext`)
* @returns a value greater than 65,535 if the previous code point represents a [Supplementary Character](https://www.unicode.org/glossary/#supplementary_character), or `code` otherwise
*/
function tryGetGenuinePreviousCode(code, nowPoint, sliceSerialize) {
	if (nowPoint._bufferIndex < 2) return code;
	const previousCandidate = sliceSerialize({
		start: {
			...nowPoint,
			_bufferIndex: nowPoint._bufferIndex - 2
		},
		end: nowPoint
	}).codePointAt(0);
	return previousCandidate && previousCandidate >= 65536 ? previousCandidate : code;
}
/**
* Try to get the [Unicode Code Point](https://www.unicode.org/glossary/#code_point) two positions before the current position.
*
* @param previousCode a previous code point. Should be greater than 65,535 if it represents a [Supplementary Character](https://www.unicode.org/glossary/#supplementary_character).
* @param nowPoint `this.now()` (`this` = `TokenizeContext`)
* @param sliceSerialize `this.sliceSerialize` (`this` = `TokenizeContext`)
* @returns a value greater than 65,535 if the code point two positions before represents a [Supplementary Character](https://www.unicode.org/glossary/#supplementary_character), a value less than 65,536 for a [BMP Character](https://www.unicode.org/glossary/#bmp_character), or `null` if not found
*/
function tryGetCodeTwoBefore(previousCode, nowPoint, sliceSerialize) {
	const previousWidth = previousCode >= 65536 ? 2 : 1;
	if (nowPoint._bufferIndex < 1 + previousWidth) return null;
	const idealStart = nowPoint._bufferIndex - previousWidth - 2;
	const twoPreviousBuffer = sliceSerialize({
		start: {
			...nowPoint,
			_bufferIndex: idealStart >= 0 ? idealStart : 0
		},
		end: {
			...nowPoint,
			_bufferIndex: nowPoint._bufferIndex - previousWidth
		}
	});
	const twoPreviousLast = twoPreviousBuffer.charCodeAt(twoPreviousBuffer.length - 1);
	if (Number.isNaN(twoPreviousLast)) return null;
	if (twoPreviousBuffer.length < 2 || twoPreviousLast < 56320 || 57343 < twoPreviousLast) return twoPreviousLast;
	const twoPreviousCandidate = twoPreviousBuffer.codePointAt(0);
	if (twoPreviousCandidate && twoPreviousCandidate >= 65536) return twoPreviousCandidate;
	return twoPreviousLast;
}
/**
* Lazily get the [Unicode Code Point](https://www.unicode.org/glossary/#code_point) two positions before the current position only if necessary.
*
* @see {@link tryGetCodeTwoBefore}
*/
var TwoPreviousCode = class {
	cachedValue = void 0;
	/**
	* @see {@link tryGetCodeTwoBefore}
	*
	* @param previousCode a previous code point. Should be greater than 65,535 if it represents a [Supplementary Character](https://www.unicode.org/glossary/#supplementary_character).
	* @param nowPoint `this.now()` (`this` = `TokenizeContext`)
	* @param sliceSerialize `this.sliceSerialize` (`this` = `TokenizeContext`)
	*/
	constructor(previousCode, nowPoint, sliceSerialize) {
		this.previousCode = previousCode;
		this.nowPoint = nowPoint;
		this.sliceSerialize = sliceSerialize;
	}
	/**
	* Returns the return value of {@link tryGetCodeTwoBefore}.
	*
	* If the value has not been computed yet, it will be computed and cached.
	*
	* @see {@link tryGetCodeTwoBefore}
	*
	* @returns a value greater than 65,535 if the code point two positions before represents a [Supplementary Character](https://www.unicode.org/glossary/#supplementary_character), a value less than 65,536 for a [BMP Character](https://www.unicode.org/glossary/#bmp_character), or `null` if not found
	*/
	value() {
		if (this.cachedValue === void 0) this.cachedValue = tryGetCodeTwoBefore(this.previousCode, this.nowPoint, this.sliceSerialize);
		return this.cachedValue;
	}
};
/**
* If `code` is a [High-Surrogate Code Unit](https://www.unicode.org/glossary/#high_surrogate_code_unit), try to get a genuine next [Unicode Scalar Value](https://www.unicode.org/glossary/#unicode_scalar_value) corresponding to the High-Surrogate Code Unit.
* @param code a tentative next [code unit](https://www.unicode.org/glossary/#code_unit) less than 65,536, including a High-Surrogate one
* @param nowPoint `this.now()` (`this` = `TokenizeContext`)
* @param sliceSerialize `this.sliceSerialize` (`this` = `TokenizeContext`)
* @returns a value greater than 65,535 if the next code point represents a [Supplementary Character](https://www.unicode.org/glossary/#supplementary_character), or `code` otherwise
*/
function tryGetGenuineNextCode(code, nowPoint, sliceSerialize) {
	const nextCandidate = sliceSerialize({
		start: nowPoint,
		end: {
			...nowPoint,
			_bufferIndex: nowPoint._bufferIndex + 2
		}
	}).codePointAt(0);
	return nextCandidate && nextCandidate >= 65536 ? nextCandidate : code;
}

//#endregion
export { TwoPreviousCode, isCodeHighSurrogate, isCodeLowSurrogate, tryGetCodeTwoBefore, tryGetGenuineNextCode, tryGetGenuinePreviousCode };