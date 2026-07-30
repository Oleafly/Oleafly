import { wrapThemeCSS } from "../utils/cssWrappers.js";
import { parseDiffFromFile } from "../utils/parseDiffFromFile.js";
import { DiffHunksRenderer } from "../renderers/DiffHunksRenderer.js";
import { parseMergeConflictDiffFromFile } from "../utils/parseMergeConflictDiffFromFile.js";
import { UnresolvedFileHunksRenderer } from "../renderers/UnresolvedFileHunksRenderer.js";
import { getUnresolvedDiffHunksRendererOptions } from "../components/UnresolvedFile.js";
import { createStyleElement, createThemeStyleElement } from "../utils/createStyleElement.js";
import { getSingularPatch } from "../utils/getSingularPatch.js";
import { renderHTML } from "./renderHTML.js";
//#region src/ssr/preloadDiffs.ts
async function preloadDiffHTML({ fileDiff, oldFile, newFile, options, annotations }) {
	if (fileDiff == null && oldFile != null && newFile != null) fileDiff = parseDiffFromFile(oldFile, newFile, options?.parseDiffOptions);
	if (fileDiff == null) throw new Error("preloadFileDiff: You must pass at least a fileDiff prop or oldFile/newFile props");
	const renderer = new DiffHunksRenderer(getHunksRendererOptions(options));
	if (annotations != null && annotations.length > 0) renderer.setLineAnnotations(annotations);
	return renderHTML(processHunkResult(await renderer.asyncRender(fileDiff), renderer, options?.unsafeCSS, options?.themeType ?? "system"));
}
async function preloadUnresolvedFileHTML({ file, options, annotations }) {
	const { fileDiff, actions, markerRows } = parseMergeConflictDiffFromFile(file, options?.maxContextLines);
	const renderer = new UnresolvedFileHunksRenderer(getUnresolvedDiffHunksRendererOptions(options));
	if (annotations != null && annotations.length > 0) renderer.setLineAnnotations(annotations);
	renderer.setConflictState(actions, markerRows, fileDiff);
	return renderHTML(processHunkResult(await renderer.asyncRender(fileDiff), renderer, options?.unsafeCSS, options?.themeType ?? "system"));
}
async function preloadMultiFileDiff({ oldFile, newFile, options, annotations }) {
	return {
		newFile,
		oldFile,
		options,
		annotations,
		prerenderedHTML: await preloadDiffHTML({
			oldFile,
			newFile,
			options,
			annotations
		})
	};
}
async function preloadFileDiff({ fileDiff, options, annotations }) {
	return {
		fileDiff,
		options,
		annotations,
		prerenderedHTML: await preloadDiffHTML({
			fileDiff,
			options,
			annotations
		})
	};
}
async function preloadUnresolvedFile({ file, options, annotations }) {
	return {
		file,
		options,
		annotations,
		prerenderedHTML: await preloadUnresolvedFileHTML({
			file,
			options,
			annotations
		})
	};
}
async function preloadPatchDiff({ patch, options, annotations }) {
	return {
		patch,
		options,
		annotations,
		prerenderedHTML: await preloadDiffHTML({
			fileDiff: getSingularPatch(patch),
			options,
			annotations
		})
	};
}
function processHunkResult(hunkResult, renderer, unsafeCSS, themeType) {
	const children = [createStyleElement(hunkResult.css, true)];
	children.push(createThemeStyleElement(wrapThemeCSS(hunkResult.themeStyles, hunkResult.baseThemeType ?? themeType)));
	if (unsafeCSS != null) children.push(createStyleElement(unsafeCSS));
	if (hunkResult.headerElement != null) children.push(hunkResult.headerElement);
	const code = renderer.renderFullAST(hunkResult);
	code.properties["data-dehydrated"] = "";
	children.push(code);
	return children;
}
function getHunksRendererOptions(options) {
	return {
		...options,
		headerRenderMode: options?.renderCustomHeader != null ? "custom" : "default",
		hunkSeparators: typeof options?.hunkSeparators === "function" ? "custom" : options?.hunkSeparators
	};
}
//#endregion
export { preloadDiffHTML, preloadFileDiff, preloadMultiFileDiff, preloadPatchDiff, preloadUnresolvedFile, preloadUnresolvedFileHTML };

//# sourceMappingURL=preloadDiffs.js.map