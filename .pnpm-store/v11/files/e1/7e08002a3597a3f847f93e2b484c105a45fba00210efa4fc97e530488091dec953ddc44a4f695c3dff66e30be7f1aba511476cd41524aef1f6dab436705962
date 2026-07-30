import { createHastElement, createTextNodeElement } from "./hast_utils.js";
//#region src/utils/createNoNewlineElement.ts
function createNoNewlineElement(type) {
	return createHastElement({
		tagName: "div",
		children: [createHastElement({
			tagName: "span",
			children: [createTextNodeElement("No newline at end of file")]
		})],
		properties: {
			"data-no-newline": "",
			"data-line-type": type,
			"data-column-content": ""
		}
	});
}
//#endregion
export { createNoNewlineElement };

//# sourceMappingURL=createNoNewlineElement.js.map