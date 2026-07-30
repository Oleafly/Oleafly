import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";

//#region src/parseOnly.ts
/**
* Make Markdown emphasis (`**`) in CommonMark more friendly with Chinese, Japanese, and Korean (CJK).
*
* This plugin only supports parsing. If you have been using `remark-cjk-friendly` since v2.0.1 or earlier, it is recommended to migrate to this to minimize bundled dependencies.
*/
function remarkCjkFriendly() {
	const data = this.data();
	(data.micromarkExtensions || (data.micromarkExtensions = [])).push(cjkFriendlyExtension());
}

//#endregion
export { remarkCjkFriendly as default };