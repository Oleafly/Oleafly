import { CUSTOM_HEADER_SLOT_ID, HEADER_METADATA_SLOT_ID, HEADER_PREFIX_SLOT_ID } from "../constants.js";
import { createHastElement, createIconElement, createTextNodeElement } from "./hast_utils.js";
import { getIconForType } from "./getIconForType.js";
//#region src/utils/createFileHeaderElement.ts
function createFileHeaderElement({ fileOrDiff, mode, stickyHeader }) {
	const fileDiff = "type" in fileOrDiff ? fileOrDiff : void 0;
	const properties = {
		"data-diffs-header": mode,
		"data-change-type": fileDiff?.type,
		"data-sticky": stickyHeader ? "" : void 0
	};
	return createHastElement({
		tagName: "div",
		children: [mode === "custom" ? createHastElement({
			tagName: "slot",
			properties: { name: CUSTOM_HEADER_SLOT_ID }
		}) : createHeaderElement({
			name: fileOrDiff.name,
			prevName: "prevName" in fileOrDiff ? fileOrDiff.prevName : void 0,
			iconType: fileDiff?.type ?? "file"
		}), ...mode === "custom" ? [] : [createMetadataElement(fileDiff)]],
		properties
	});
}
function createHeaderElement({ name, prevName, iconType }) {
	const children = [createHastElement({
		tagName: "slot",
		properties: { name: HEADER_PREFIX_SLOT_ID }
	}), createIconElement({
		name: getIconForType(iconType),
		properties: { "data-change-icon": iconType }
	})];
	if (prevName != null) {
		children.push(createHastElement({
			tagName: "div",
			children: [createHastElement({
				tagName: "bdi",
				children: [createTextNodeElement(prevName)]
			})],
			properties: { "data-prev-name": "" }
		}));
		children.push(createIconElement({
			name: "diffs-icon-arrow-right-short",
			properties: { "data-rename-icon": "" }
		}));
	}
	children.push(createHastElement({
		tagName: "div",
		children: [createHastElement({
			tagName: "bdi",
			children: [createTextNodeElement(name)]
		})],
		properties: { "data-title": "" }
	}));
	return createHastElement({
		tagName: "div",
		children,
		properties: { "data-header-content": "" }
	});
}
function createMetadataElement(fileDiff) {
	const children = [];
	if (fileDiff != null) {
		let additions = 0;
		let deletions = 0;
		for (const hunk of fileDiff.hunks) {
			additions += hunk.additionLines;
			deletions += hunk.deletionLines;
		}
		if (deletions > 0 || additions === 0) children.push(createHastElement({
			tagName: "span",
			children: [createTextNodeElement(`-${deletions}`)],
			properties: { "data-deletions-count": "" }
		}));
		if (additions > 0 || deletions === 0) children.push(createHastElement({
			tagName: "span",
			children: [createTextNodeElement(`+${additions}`)],
			properties: { "data-additions-count": "" }
		}));
	}
	children.push(createHastElement({
		tagName: "slot",
		properties: { name: HEADER_METADATA_SLOT_ID }
	}));
	return createHastElement({
		tagName: "div",
		children,
		properties: { "data-metadata": "" }
	});
}
//#endregion
export { createFileHeaderElement };

//# sourceMappingURL=createFileHeaderElement.js.map