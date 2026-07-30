"use client";
import { DIFFS_TAG_NAME } from "../constants.js";
import { getLineAnnotationName } from "../utils/getLineAnnotationName.js";
import { useEffect, useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
//#region src/ssr/FileDiffReact.tsx
function escapeHtml(unsafe) {
	return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function serializeStyle(style) {
	return Object.entries(style).map(([key, value]) => {
		return `${key.replace(/([A-Z])/g, "-$1").toLowerCase()}:${escapeHtml(String(value))}`;
	}).join(";");
}
function FileDiffSSR({ prerenderedHTML, annotations, className, style, renderAnnotation }) {
	const wrapperRef = useRef(null);
	const hydratedRef = useRef(false);
	const htmlObjectRef = useRef(null);
	if (htmlObjectRef.current === null) htmlObjectRef.current = { __html: `<${DIFFS_TAG_NAME}${className !== void 0 ? ` class="${escapeHtml(className)}"` : ""}${style !== void 0 ? ` style="${serializeStyle(style)}"` : ""}><template shadowrootmode="open">${prerenderedHTML}</template>${annotations !== void 0 && annotations.length > 0 && renderAnnotation != null ? annotations.map((annotation) => {
		return `<div slot="${getLineAnnotationName(annotation)}">${renderToString(renderAnnotation(annotation))}</div>`;
	}).join("") : ""}</${DIFFS_TAG_NAME}>` };
	useEffect(() => {
		if (wrapperRef.current !== null && annotations !== void 0 && !hydratedRef.current) {
			const fileElement = wrapperRef.current.querySelector(DIFFS_TAG_NAME);
			if (fileElement !== null) {
				Array.from(fileElement.children).forEach((slotElement) => {
					if (!(slotElement instanceof HTMLElement)) return;
					const slotName = slotElement.getAttribute("slot");
					if (slotName === null) return;
					const annotation = annotations.find((annotation) => {
						return slotName === getLineAnnotationName(annotation);
					});
					if (annotation !== void 0 && renderAnnotation != null) hydrateRoot(slotElement, renderAnnotation(annotation));
				});
				hydratedRef.current = true;
			}
		}
	}, [annotations, renderAnnotation]);
	return /* @__PURE__ */ jsx("div", {
		ref: wrapperRef,
		dangerouslySetInnerHTML: htmlObjectRef.current,
		suppressHydrationWarning: true
	});
}
//#endregion
export { FileDiffSSR };

//# sourceMappingURL=FileDiffReact.js.map