import { CUSTOM_HEADER_SLOT_ID } from "../../constants.js";
import { getLineAnnotationName } from "../../utils/getLineAnnotationName.js";
import { GutterUtilitySlotStyles } from "../constants.js";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/react/utils/renderFileChildren.tsx
function renderFileChildren({ file, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderAnnotation, lineAnnotations, renderGutterUtility, getHoveredLine }) {
	const customHeader = renderCustomHeader?.(file);
	const prefix = renderHeaderPrefix?.(file);
	const metadata = renderHeaderMetadata?.(file);
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
		renderGutterUtility != null && /* @__PURE__ */ jsx("div", {
			slot: "gutter-utility-slot",
			style: GutterUtilitySlotStyles,
			children: renderGutterUtility(getHoveredLine)
		})
	] });
}
//#endregion
export { renderFileChildren };

//# sourceMappingURL=renderFileChildren.js.map