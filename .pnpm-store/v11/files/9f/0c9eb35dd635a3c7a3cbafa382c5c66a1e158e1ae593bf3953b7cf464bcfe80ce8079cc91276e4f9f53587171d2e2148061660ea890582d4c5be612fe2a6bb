import { CUSTOM_HEADER_SLOT_ID } from "../../constants.js";
import { getLineAnnotationName } from "../../utils/getLineAnnotationName.js";
import { getMergeConflictActionSlotName } from "../../utils/getMergeConflictActionSlotName.js";
import { getMergeConflictActionAnchor } from "../../utils/parseMergeConflictDiffFromFile.js";
import { GutterUtilitySlotStyles, MergeConflictSlotStyles } from "../constants.js";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/react/utils/renderDiffChildren.tsx
function renderDiffChildren({ fileDiff, actions, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderAnnotation, renderGutterUtility, renderMergeConflictUtility, lineAnnotations, getHoveredLine, getInstance }) {
	const customHeader = renderCustomHeader?.(fileDiff);
	const prefix = renderHeaderPrefix?.(fileDiff);
	const metadata = renderHeaderMetadata?.(fileDiff);
	return /* @__PURE__ */ jsxs(Fragment, { children: [
		customHeader != null ? /* @__PURE__ */ jsx("div", {
			slot: CUSTOM_HEADER_SLOT_ID,
			children: customHeader
		}) : /* @__PURE__ */ jsxs(Fragment, { children: [prefix != null && /* @__PURE__ */ jsx("div", {
			slot: "header-prefix",
			children: prefix
		}), metadata != null && /* @__PURE__ */ jsx("div", {
			slot: "header-metadata",
			children: metadata
		})] }),
		renderAnnotation != null && lineAnnotations?.map((annotation, index) => /* @__PURE__ */ jsx("div", {
			slot: getLineAnnotationName(annotation),
			children: renderAnnotation(annotation)
		}, index)),
		actions != null && renderMergeConflictUtility != null && getInstance != null && actions.map((action) => {
			if (action == null) return;
			const slot = getSlotName(action, fileDiff);
			return /* @__PURE__ */ jsx("div", {
				slot,
				style: MergeConflictSlotStyles,
				children: renderMergeConflictUtility(action, getInstance)
			}, slot);
		}),
		renderGutterUtility != null && /* @__PURE__ */ jsx("div", {
			slot: "gutter-utility-slot",
			style: GutterUtilitySlotStyles,
			children: renderGutterUtility(getHoveredLine)
		})
	] });
}
function getSlotName(action, fileDiff) {
	const anchor = getMergeConflictActionAnchor(action, fileDiff);
	return anchor != null ? getMergeConflictActionSlotName({
		hunkIndex: anchor.hunkIndex,
		lineIndex: anchor.lineIndex,
		conflictIndex: action.conflictIndex
	}) : void 0;
}
//#endregion
export { renderDiffChildren };

//# sourceMappingURL=renderDiffChildren.js.map