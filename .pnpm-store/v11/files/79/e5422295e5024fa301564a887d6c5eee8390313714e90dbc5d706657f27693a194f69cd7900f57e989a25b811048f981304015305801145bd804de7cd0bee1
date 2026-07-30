import { createHastElement, createIconElement, createTextNodeElement } from "./hast_utils.js";
//#region src/utils/createSeparator.ts
function createExpandButton(type) {
	return createHastElement({
		tagName: "div",
		children: [createIconElement({
			name: type === "both" ? "diffs-icon-expand-all" : "diffs-icon-expand",
			properties: { "data-icon": "" }
		})],
		properties: {
			role: "button",
			"data-expand-button": "",
			"data-expand-both": type === "both" ? "" : void 0,
			"data-expand-up": type === "up" ? "" : void 0,
			"data-expand-down": type === "down" ? "" : void 0
		}
	});
}
function createSeparator({ type, content, expandIndex, chunked = false, slotName, isFirstHunk, isLastHunk }) {
	let buttonCount = 0;
	const children = [];
	if (type === "metadata" && content != null) children.push(createHastElement({
		tagName: "div",
		children: [createTextNodeElement(content)],
		properties: { "data-separator-wrapper": "" }
	}));
	if ((type === "line-info" || type === "line-info-basic") && content != null) {
		const contentChildren = [];
		if (expandIndex != null) if (!chunked) {
			contentChildren.push(createExpandButton(!isFirstHunk && !isLastHunk ? "both" : isFirstHunk ? "down" : "up"));
			buttonCount++;
		} else {
			if (!isFirstHunk) {
				contentChildren.push(createExpandButton("up"));
				buttonCount++;
			}
			if (!isLastHunk) {
				contentChildren.push(createExpandButton("down"));
				buttonCount++;
			}
		}
		contentChildren.push(createHastElement({
			tagName: "div",
			children: [createHastElement({
				tagName: "span",
				children: [createTextNodeElement(content)],
				properties: { "data-unmodified-lines": "" }
			})],
			properties: { "data-separator-content": "" }
		}));
		if (chunked && expandIndex != null) contentChildren.push(createHastElement({
			tagName: "div",
			children: [createTextNodeElement("Expand all")],
			properties: {
				role: "button",
				"data-expand-button": "",
				"data-expand-all-button": ""
			}
		}));
		children.push(createHastElement({
			tagName: "div",
			children: contentChildren,
			properties: {
				"data-separator-wrapper": "",
				"data-separator-multi-button": buttonCount > 1 ? "" : void 0
			}
		}));
	}
	if (type === "custom" && slotName != null) children.push(createHastElement({
		tagName: "slot",
		properties: { name: slotName }
	}));
	return createHastElement({
		tagName: "div",
		children,
		properties: {
			"data-separator": children.length === 0 ? "simple" : type,
			"data-expand-index": expandIndex,
			"data-separator-first": isFirstHunk ? "" : void 0,
			"data-separator-last": isLastHunk ? "" : void 0
		}
	});
}
//#endregion
export { createSeparator };

//# sourceMappingURL=createSeparator.js.map