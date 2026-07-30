import { createHastElement } from "./hast_utils.js";
//#region src/utils/createPreElement.ts
function createPreElement(options) {
	return createHastElement({
		tagName: "pre",
		properties: createPreWrapperProperties(options)
	});
}
function createPreWrapperProperties({ diffIndicators, disableBackground, disableLineNumbers, overflow, split, totalLines, type, customProperties }) {
	return {
		...customProperties,
		"data-diff": type === "diff" ? "" : void 0,
		"data-file": type === "file" ? "" : void 0,
		"data-diff-type": type === "diff" ? split ? "split" : "single" : void 0,
		"data-overflow": overflow,
		"data-disable-line-numbers": disableLineNumbers ? "" : void 0,
		"data-background": !disableBackground ? "" : void 0,
		"data-indicators": diffIndicators === "bars" || diffIndicators === "classic" ? diffIndicators : void 0,
		style: `--diffs-min-number-column-width-default:${`${totalLines}`.length}ch;`
	};
}
//#endregion
export { createPreElement, createPreWrapperProperties };

//# sourceMappingURL=createPreElement.js.map