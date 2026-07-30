//#region src/utils/includesFileAnnotations.ts
const FILE_ANNOTATION_LINE_NUMBER = 0;
const FILE_ANNOTATION_HUNK_INDEX = -1;
const FILE_ANNOTATION_LINE_INDEX = -1;
const FILE_ANNOTATION_DOM_KEY = `-1,-1`;
function includesFileAnnotations(annotations) {
	return annotations?.some((annotation) => annotation.lineNumber === 0) ?? false;
}
function getFileAnnotations(annotations) {
	const fileAnnotations = annotations[0];
	return fileAnnotations != null && fileAnnotations.length > 0 ? fileAnnotations : void 0;
}
function shouldRenderFileAnnotations(renderRange) {
	return renderRange.startingLine === 0 && renderRange.totalLines > 0;
}
//#endregion
export { FILE_ANNOTATION_DOM_KEY, FILE_ANNOTATION_HUNK_INDEX, FILE_ANNOTATION_LINE_INDEX, FILE_ANNOTATION_LINE_NUMBER, getFileAnnotations, includesFileAnnotations, shouldRenderFileAnnotations };

//# sourceMappingURL=includesFileAnnotations.js.map