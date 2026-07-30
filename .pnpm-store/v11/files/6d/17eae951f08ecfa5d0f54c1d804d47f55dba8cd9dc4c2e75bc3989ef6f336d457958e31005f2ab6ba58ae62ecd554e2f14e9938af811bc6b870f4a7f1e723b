import { attention } from "./ext/attention.js";
import { codes } from "micromark-util-symbol";

//#region src/index.ts
/**
* Make Markdown emphasis (`**`) in CommonMark more friendly with Chinese, Japanese, and Korean (CJK).
*/
function cjkFriendlyExtension() {
	return {
		text: {
			[codes.asterisk]: attention,
			[codes.underscore]: attention
		},
		insideSpan: { null: [attention] }
	};
}

//#endregion
export { cjkFriendlyExtension };