"use client";
import { DIFFS_TAG_NAME } from "../constants.js";
import { renderDiffChildren } from "./utils/renderDiffChildren.js";
import { templateRender } from "./utils/templateRender.js";
import { useFileDiffInstance } from "./utils/useFileDiffInstance.js";
import { jsx } from "react/jsx-runtime";
//#region src/react/FileDiff.tsx
function FileDiff({ fileDiff, options, metrics, lineAnnotations, selectedLines, className, style, prerenderedHTML, renderAnnotation, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderGutterUtility, disableWorkerPool = false }) {
	const { ref, getHoveredLine } = useFileDiffInstance({
		fileDiff,
		options,
		metrics,
		lineAnnotations,
		selectedLines,
		prerenderedHTML,
		hasGutterRenderUtility: renderGutterUtility != null,
		hasCustomHeader: renderCustomHeader != null,
		disableWorkerPool
	});
	return /* @__PURE__ */ jsx(DIFFS_TAG_NAME, {
		ref,
		className,
		style,
		children: templateRender(renderDiffChildren({
			fileDiff,
			renderCustomHeader,
			renderHeaderPrefix,
			renderHeaderMetadata,
			renderAnnotation,
			renderGutterUtility,
			lineAnnotations,
			getHoveredLine
		}), prerenderedHTML)
	});
}
//#endregion
export { FileDiff };

//# sourceMappingURL=FileDiff.js.map