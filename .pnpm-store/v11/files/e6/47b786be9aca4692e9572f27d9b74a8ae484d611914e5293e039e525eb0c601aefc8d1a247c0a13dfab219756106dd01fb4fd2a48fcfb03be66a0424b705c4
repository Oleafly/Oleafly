import { DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY } from "../constants.js";
import style_default from "../style.js";
import { createMeasuredScrollbarGutterDeclaration } from "./scrollbarGutter.js";
//#region src/utils/cssWrappers.ts
const LAYER_ORDER = `@layer base, theme, rendered, unsafe;`;
const SCROLLBAR_GUTTER_DECLARATION_PATTERN = new RegExp(`${escapeRegExp(DIFFS_SCROLLBAR_GUTTER_MEASURED_PROPERTY)}\\s*:\\s*[^;]+;`);
function wrapCoreCSS(mainCSS) {
	return `${LAYER_ORDER}
${style_default}
@layer theme {
  ${mainCSS}
}`;
}
function wrapUnsafeCSS(unsafeCSS) {
	return `${LAYER_ORDER}
@layer unsafe {
  ${unsafeCSS}
}`;
}
function wrapThemeCSS(themeCSS, themeType = "system", scrollbarGutter) {
	return `${LAYER_ORDER}
@layer rendered {
  :host {${themeType === "system" ? "" : `
  color-scheme: ${themeType};`}
  ${createMeasuredScrollbarGutterDeclaration(scrollbarGutter)}
  ${themeCSS}
  }
}`;
}
function patchScrollbarGutterSize(themeCSS, scrollbarGutter) {
	const scrollbarGutterRule = createMeasuredScrollbarGutterDeclaration(scrollbarGutter);
	return themeCSS.replace(SCROLLBAR_GUTTER_DECLARATION_PATTERN, scrollbarGutterRule);
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
//#endregion
export { patchScrollbarGutterSize, wrapCoreCSS, wrapThemeCSS, wrapUnsafeCSS };

//# sourceMappingURL=cssWrappers.js.map