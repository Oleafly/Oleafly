//#region src/utils/prerenderHTMLIfNecessary.ts
function prerenderHTMLIfNecessary(element, html) {
	if (html == null) return;
	const shadowRoot = element.shadowRoot ?? element.attachShadow({ mode: "open" });
	if (shadowRoot.innerHTML === "") shadowRoot.innerHTML = html;
}
//#endregion
export { prerenderHTMLIfNecessary };

//# sourceMappingURL=prerenderHTMLIfNecessary.js.map