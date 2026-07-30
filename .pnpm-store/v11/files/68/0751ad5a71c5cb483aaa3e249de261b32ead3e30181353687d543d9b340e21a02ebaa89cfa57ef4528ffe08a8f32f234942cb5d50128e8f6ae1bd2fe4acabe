import { DEFAULT_RENDER_RANGE, DEFAULT_THEMES } from "../constants.js";
import { createGutterGap, createHastElement, createTextNodeElement } from "../utils/hast_utils.js";
import { DiffHunksRenderer } from "./DiffHunksRenderer.js";
import { getMergeConflictActionSlotName } from "../utils/getMergeConflictActionSlotName.js";
import { getMergeConflictActionAnchor } from "../utils/parseMergeConflictDiffFromFile.js";
//#region src/renderers/UnresolvedFileHunksRenderer.ts
var UnresolvedFileHunksRenderer = class extends DiffHunksRenderer {
	pendingConflictActions = [];
	pendingMarkerRows = [];
	injectedRows = /* @__PURE__ */ new Map();
	options;
	constructor(options = { theme: DEFAULT_THEMES }, onRenderUpdate, workerManager) {
		super(void 0, onRenderUpdate, workerManager);
		this.options = options;
	}
	setConflictState(conflictActions, markerRows, diff) {
		this.pendingConflictActions = conflictActions;
		this.pendingMarkerRows = markerRows;
		this.syncInjectedRows(conflictActions, markerRows, diff);
	}
	syncInjectedRows(conflictActions, markerRows, diff) {
		this.injectedRows.clear();
		for (const action of conflictActions) {
			const anchor = action != null ? getMergeConflictActionAnchor(action, diff) : void 0;
			if (action == null || anchor == null) continue;
			const row = {
				type: "actions",
				hunkIndex: anchor.hunkIndex,
				lineIndex: anchor.lineIndex,
				conflictIndex: action.conflictIndex
			};
			this.addInjectedRow(row);
		}
		for (const row of markerRows) this.addInjectedRow(row);
	}
	addInjectedRow(row) {
		const key = `${row.hunkIndex}:${row.lineIndex}`;
		const rows = this.injectedRows.get(key);
		if (rows == null) this.injectedRows.set(key, [row]);
		else rows.push(row);
	}
	renderDiff(diff, renderRange = DEFAULT_RENDER_RANGE) {
		if (diff != null) this.syncInjectedRows(this.pendingConflictActions, this.pendingMarkerRows, diff);
		return super.renderDiff(diff, renderRange);
	}
	async asyncRender(diff, renderRange = DEFAULT_RENDER_RANGE) {
		this.syncInjectedRows(this.pendingConflictActions, this.pendingMarkerRows, diff);
		return super.asyncRender(diff, renderRange);
	}
	createPreElement(split, totalLines) {
		return super.createPreElement(split, totalLines, { "data-has-merge-conflict": "" });
	}
	getUnifiedLineDecoration({ type, lineType }) {
		const mergeConflictType = type === "change" ? lineType === "change-deletion" ? "current" : "incoming" : void 0;
		return {
			gutterLineType: type === "change" ? "context" : lineType,
			gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
			contentProperties: getMergeConflictContentProperties(type, mergeConflictType)
		};
	}
	getSplitLineDecoration({ side, type }) {
		const mergeConflictType = type === "change" ? side === "deletions" ? "current" : "incoming" : void 0;
		return {
			gutterLineType: type === "change" ? "context" : type,
			gutterProperties: getMergeConflictGutterProperties(mergeConflictType),
			contentProperties: getMergeConflictContentProperties(type, mergeConflictType)
		};
	}
	getUnifiedInjectedRowsForLine = (ctx) => {
		const rows = this.injectedRows.get(`${ctx.hunkIndex}:${ctx.lineIndex}`);
		if (rows == null || rows.length === 0) return;
		const { mergeConflictActionsType } = this.getOptionsWithDefaults();
		const before = [];
		const after = [];
		for (const row of rows) {
			if (row.type === "actions") {
				before.push({
					content: createMergeConflictActionsRowElement({
						row,
						includeDefaultActions: mergeConflictActionsType === "default",
						includeSlot: true
					}),
					gutter: createMergeConflictGutterGap("action")
				});
				continue;
			}
			(row.type === "marker-end" ? after : before).push({
				content: createMergeConflictMarkerRowElement(row),
				gutter: createMergeConflictGutterGap("marker", row.type)
			});
		}
		return {
			before: before.length > 0 ? before : void 0,
			after: after.length > 0 ? after : void 0
		};
	};
	getOptionsWithDefaults() {
		const options = super.getOptionsWithDefaults();
		options.diffStyle = "unified";
		options.lineDiffType = "none";
		options.mergeConflictActionsType = this.options.mergeConflictActionsType ?? "default";
		return options;
	}
};
function getMergeConflictGutterProperties(mergeConflictType) {
	return mergeConflictType != null ? { "data-merge-conflict": mergeConflictType } : void 0;
}
function getMergeConflictContentProperties(type, mergeConflictType) {
	if (mergeConflictType == null) return;
	if (type === "change") {
		if (mergeConflictType === "current" || mergeConflictType === "incoming") return {
			"data-line-type": "context",
			"data-merge-conflict": mergeConflictType
		};
		return;
	}
	if (mergeConflictType === "marker-start" || mergeConflictType === "marker-base" || mergeConflictType === "marker-separator" || mergeConflictType === "marker-end") return { "data-merge-conflict": mergeConflictType };
}
function createMergeConflictGutterGap(type, markerType) {
	const gap = createGutterGap(void 0, "annotation", 1);
	gap.properties["data-gutter-buffer"] = type === "action" ? "merge-conflict-action" : `merge-conflict-${markerType ?? "marker"}`;
	return gap;
}
function createMergeConflictActionsRowElement({ row, includeDefaultActions, includeSlot }) {
	const contentChildren = includeDefaultActions ? createMergeConflictActionsContent(row.conflictIndex) : [];
	if (includeSlot) contentChildren.push(createHastElement({
		tagName: "slot",
		properties: {
			name: getMergeConflictActionSlotName({
				hunkIndex: row.hunkIndex,
				lineIndex: row.lineIndex,
				conflictIndex: row.conflictIndex
			}),
			"data-merge-conflict-action-slot": ""
		}
	}));
	return createHastElement({
		tagName: "div",
		properties: { "data-merge-conflict-actions": "" },
		children: [createHastElement({
			tagName: "div",
			properties: { "data-merge-conflict-actions-content": "" },
			children: contentChildren
		})]
	});
}
function createMergeConflictMarkerRowElement(row) {
	return createHastElement({
		tagName: "div",
		properties: {
			"data-merge-conflict": row.type,
			"data-merge-conflict-marker-row": ""
		},
		children: [createTextNodeElement(row.lineText.replace(/(?:\r\n|\n|\r)$/, ""))]
	});
}
function createMergeConflictActionsContent(conflictIndex) {
	return [
		createMergeConflictActionButton({
			resolution: "current",
			label: "Accept current change",
			conflictIndex
		}),
		createMergeConflictActionSeparator(),
		createMergeConflictActionButton({
			resolution: "incoming",
			label: "Accept incoming change",
			conflictIndex
		}),
		createMergeConflictActionSeparator(),
		createMergeConflictActionButton({
			resolution: "both",
			label: "Accept both",
			conflictIndex
		})
	];
}
function createMergeConflictActionButton({ resolution, label, conflictIndex }) {
	return createHastElement({
		tagName: "button",
		properties: {
			type: "button",
			"data-merge-conflict-action": resolution,
			"data-merge-conflict-conflict-index": `${conflictIndex}`
		},
		children: [createTextNodeElement(label)]
	});
}
function createMergeConflictActionSeparator() {
	return createHastElement({
		tagName: "span",
		properties: { "data-merge-conflict-action-separator": "" },
		children: [createTextNodeElement("|")]
	});
}
//#endregion
export { UnresolvedFileHunksRenderer };

//# sourceMappingURL=UnresolvedFileHunksRenderer.js.map