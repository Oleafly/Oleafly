import { createHastElement } from "./hast_utils.js";
//#region src/utils/wrapTokenFragments.ts
const NO_TOKEN = Symbol("no-token");
const MULTIPLE_TOKENS = Symbol("multiple-tokens");
function wrapTokenFragments(container) {
	const ownTokenChar = getTokenChar(container);
	if (ownTokenChar != null) return ownTokenChar;
	let containerTokenState = NO_TOKEN;
	const wrappedChildren = [];
	let currentTokenChildren = [];
	let currentTokenChar;
	const flushTokenChildren = () => {
		if (currentTokenChildren.length === 0 || currentTokenChar == null) {
			currentTokenChildren = [];
			currentTokenChar = void 0;
			return;
		}
		if (currentTokenChildren.length === 1) {
			const child = currentTokenChildren[0];
			if (child?.type === "element") {
				setTokenChar(child, currentTokenChar);
				for (const grandChild of child.children) stripTokenChar(grandChild);
			} else stripTokenChar(child);
			wrappedChildren.push(child);
			currentTokenChildren = [];
			currentTokenChar = void 0;
			return;
		}
		for (const child of currentTokenChildren) stripTokenChar(child);
		wrappedChildren.push(createHastElement({
			tagName: "span",
			properties: { "data-char": currentTokenChar },
			children: currentTokenChildren
		}));
		currentTokenChildren = [];
		currentTokenChar = void 0;
	};
	const mergeContainerTokenState = (childTokenState) => {
		if (childTokenState === NO_TOKEN) return;
		if (childTokenState === MULTIPLE_TOKENS) {
			containerTokenState = MULTIPLE_TOKENS;
			return;
		}
		if (containerTokenState === NO_TOKEN) {
			containerTokenState = childTokenState;
			return;
		}
		if (containerTokenState !== childTokenState) containerTokenState = MULTIPLE_TOKENS;
	};
	for (const child of container.children) {
		const childTokenState = child.type === "element" ? wrapTokenFragments(child) : NO_TOKEN;
		mergeContainerTokenState(childTokenState);
		if (typeof childTokenState !== "number") {
			flushTokenChildren();
			wrappedChildren.push(child);
			continue;
		}
		if (currentTokenChar != null && currentTokenChar !== childTokenState) flushTokenChildren();
		currentTokenChar ??= childTokenState;
		currentTokenChildren.push(child);
	}
	flushTokenChildren();
	container.children = wrappedChildren;
	return containerTokenState;
}
function getTokenChar(node) {
	const value = node.properties["data-char"];
	if (typeof value === "number") return value;
}
function stripTokenChar(node) {
	if (node.type !== "element") return;
	node.properties["data-char"] = void 0;
	for (const child of node.children) stripTokenChar(child);
}
function setTokenChar(node, char) {
	node.properties["data-char"] = char;
}
//#endregion
export { wrapTokenFragments };

//# sourceMappingURL=wrapTokenFragments.js.map