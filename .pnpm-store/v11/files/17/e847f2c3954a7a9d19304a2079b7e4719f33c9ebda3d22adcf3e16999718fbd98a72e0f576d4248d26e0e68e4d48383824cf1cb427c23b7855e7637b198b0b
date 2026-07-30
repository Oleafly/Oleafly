import { DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY, DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE } from "../constants.js";
//#region src/utils/scrollbarGutter.ts
let measuredScrollbarGutter;
function getMeasuredScrollbarGutter(shadowRoot) {
	if (measuredScrollbarGutter != null) return measuredScrollbarGutter;
	const host = shadowRoot.host;
	if (typeof HTMLElement !== "undefined" && host instanceof HTMLElement && !host.isConnected) return;
	const wrapper = document.createElement("div");
	wrapper.setAttribute("data-code", "");
	wrapper.setAttribute(DIFFS_SCROLLBAR_MEASURE_ATTRIBUTE, "true");
	const child = document.createElement("div");
	child.style.position = "relative";
	child.style.width = "200%";
	child.style.height = "200%";
	wrapper.appendChild(child);
	shadowRoot.appendChild(wrapper);
	measuredScrollbarGutter = Math.max(wrapper.offsetHeight - wrapper.clientHeight, 0);
	wrapper.remove();
	return measuredScrollbarGutter;
}
function createMeasuredScrollbarGutterDeclaration(scrollbarGutter) {
	return `${DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY}: ${scrollbarGutter == null ? "var(--diffs-scrollbar-gutter-fallback)" : `${scrollbarGutter}px`};`;
}
//#endregion
export { createMeasuredScrollbarGutterDeclaration, getMeasuredScrollbarGutter };

//# sourceMappingURL=scrollbarGutter.js.map