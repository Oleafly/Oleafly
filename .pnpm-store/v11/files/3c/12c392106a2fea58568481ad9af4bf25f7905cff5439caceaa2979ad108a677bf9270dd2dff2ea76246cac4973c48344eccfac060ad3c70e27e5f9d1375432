import { cjkFriendlyToMarkdown } from "mdast-util-to-markdown-cjk-friendly";

//#region src/serializeOnly.ts
/**
* Make Markdown emphasis (`**`) in CommonMark more friendly with Chinese, Japanese, and Korean (CJK).
*
* This plugin only supports serializing.
*/
function remarkCjkFriendly() {
	const data = this.data();
	(data.toMarkdownExtensions || (data.toMarkdownExtensions = [])).push(cjkFriendlyToMarkdown());
}

//#endregion
export { remarkCjkFriendly as default };