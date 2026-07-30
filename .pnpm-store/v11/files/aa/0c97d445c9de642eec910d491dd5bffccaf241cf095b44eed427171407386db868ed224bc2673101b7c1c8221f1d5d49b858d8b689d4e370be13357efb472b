"use client";
import { DIFFS_TAG_NAME } from "../constants.js";
import { renderDiffChildren } from "./utils/renderDiffChildren.js";
import { templateRender } from "./utils/templateRender.js";
import { useUnresolvedFileInstance } from "./utils/useUnresolvedFileInstance.js";
import { jsx } from "react/jsx-runtime";
//#region src/react/UnresolvedFile.tsx
function UnresolvedFile({ file, options, lineAnnotations, selectedLines, className, style, prerenderedHTML, renderAnnotation, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderGutterUtility, renderMergeConflictUtility, disableWorkerPool = false }) {
	const { ref, getHoveredLine, fileDiff, actions, getInstance } = useUnresolvedFileInstance({
		file,
		options,
		lineAnnotations,
		selectedLines,
		prerenderedHTML,
		hasConflictUtility: renderMergeConflictUtility != null,
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
			getHoveredLine,
			actions,
			renderMergeConflictUtility,
			getInstance
		}), prerenderedHTML)
	});
}
//#endregion
export { UnresolvedFile };

//# sourceMappingURL=UnresolvedFile.js.map