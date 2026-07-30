import { THEME_CSS_ATTRIBUTE } from "../constants.js";
//#region src/utils/hostTheme.ts
function upsertHostThemeStyle({ shadowRoot, currentNode, themeCSS }) {
	if (themeCSS.trim() === "") {
		currentNode?.remove();
		return;
	}
	currentNode ??= createHostThemeStyleNode();
	currentNode.textContent = themeCSS;
	if (currentNode.parentNode !== shadowRoot) shadowRoot.appendChild(currentNode);
	return currentNode;
}
function createHostThemeStyleNode() {
	const node = document.createElement("style");
	node.setAttribute(THEME_CSS_ATTRIBUTE, "");
	return node;
}
//#endregion
export { createHostThemeStyleNode, upsertHostThemeStyle };

//# sourceMappingURL=hostTheme.js.map