//#region src/utils/detachString.ts
const stringDetachEncoder = new TextEncoder();
const stringDetachDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
const SURROGATE_CODE_UNIT_PATTERN = /[\uD800-\uDFFF]/;
const STRING_DETACH_INITIAL_BUFFER_SIZE = 1024;
let stringDetachBuffer = new Uint8Array(STRING_DETACH_INITIAL_BUFFER_SIZE);
function releaseStringDetachBuffer() {
	if (stringDetachBuffer.length !== STRING_DETACH_INITIAL_BUFFER_SIZE) stringDetachBuffer = new Uint8Array(STRING_DETACH_INITIAL_BUFFER_SIZE);
}
function detachString(value) {
	if (value.length === 0) return value;
	if (SURROGATE_CODE_UNIT_PATTERN.test(value)) return JSON.parse(JSON.stringify(value));
	const requiredByteLength = value.length * 3;
	if (stringDetachBuffer.length < requiredByteLength) stringDetachBuffer = new Uint8Array(requiredByteLength);
	const { written } = stringDetachEncoder.encodeInto(value, stringDetachBuffer);
	return stringDetachDecoder.decode(stringDetachBuffer.subarray(0, written));
}
//#endregion
export { detachString, releaseStringDetachBuffer };

//# sourceMappingURL=detachString.js.map