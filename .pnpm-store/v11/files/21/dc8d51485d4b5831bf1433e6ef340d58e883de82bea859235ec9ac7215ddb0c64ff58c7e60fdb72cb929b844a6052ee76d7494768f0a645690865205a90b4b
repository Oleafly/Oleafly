import { createHastElement } from "./hast_utils.js";
//#region src/utils/createAnnotationElement.ts
function createAnnotationElement(span) {
	return createHastElement({
		tagName: "div",
		children: [createHastElement({
			tagName: "div",
			children: span.annotations?.map((slotId) => createHastElement({
				tagName: "slot",
				properties: { name: slotId }
			})),
			properties: { "data-annotation-content": "" }
		})],
		properties: { "data-line-annotation": `${span.hunkIndex},${span.lineIndex}` }
	});
}
//#endregion
export { createAnnotationElement };

//# sourceMappingURL=createAnnotationElement.js.map