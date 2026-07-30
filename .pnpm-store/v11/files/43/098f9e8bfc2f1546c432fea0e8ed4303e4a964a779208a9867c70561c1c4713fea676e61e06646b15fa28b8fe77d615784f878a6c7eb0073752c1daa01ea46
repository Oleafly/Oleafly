"use client";
import { DIFFS_TAG_NAME } from "../constants.js";
import { getSingularPatch } from "../utils/getSingularPatch.js";
import { renderDiffChildren } from "./utils/renderDiffChildren.js";
import { templateRender } from "./utils/templateRender.js";
import { useFileDiffInstance } from "./utils/useFileDiffInstance.js";
import { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/react/PatchDiff.tsx
function PatchDiff({ patch, options, metrics, lineAnnotations, selectedLines, className, style, prerenderedHTML, renderAnnotation, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderGutterUtility, disableWorkerPool = false }) {
	const fileDiff = usePatch(patch);
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
			lineAnnotations,
			renderGutterUtility,
			getHoveredLine
		}), prerenderedHTML)
	});
}
function usePatch(patch) {
	return useMemo(() => getSingularPatch(patch), [patch]);
}
//#endregion
export { PatchDiff };

//# sourceMappingURL=PatchDiff.js.map