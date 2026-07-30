import { DIFFS_TAG_NAME } from "../constants.js";
import style_default from "../style.js";
import { getMeasuredScrollbarGutter } from "../utils/scrollbarGutter.js";
//#region src/components/web-components.ts
if (typeof HTMLElement !== "undefined" && customElements.get("diffs-container") == null) {
	let sheet;
	class FileDiffContainer extends HTMLElement {
		constructor() {
			super();
			if (this.shadowRoot != null) return;
			const shadowRoot = this.attachShadow({ mode: "open" });
			if (sheet == null) {
				sheet = new CSSStyleSheet();
				sheet.replaceSync(style_default);
			}
			shadowRoot.adoptedStyleSheets = [sheet];
		}
		connectedCallback() {
			getMeasuredScrollbarGutter(this.shadowRoot ?? this.attachShadow({ mode: "open" }));
		}
	}
	customElements.define(DIFFS_TAG_NAME, FileDiffContainer);
}
const DiffsContainerLoaded = true;
//#endregion
export { DiffsContainerLoaded };

//# sourceMappingURL=web-components.js.map