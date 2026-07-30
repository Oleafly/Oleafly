import { DEFAULT_THEMES } from "../constants.js";
import { pluckInteractionOptions } from "../managers/InteractionManager.js";
import { areFilesEqual } from "../utils/areFilesEqual.js";
import { splitFileContents } from "../utils/splitFileContents.js";
import { createAnnotationWrapperNode } from "../utils/createAnnotationWrapperNode.js";
import { FileDiff } from "./FileDiff.js";
import { getMergeConflictActionSlotName } from "../utils/getMergeConflictActionSlotName.js";
import { buildMergeConflictMarkerRows, getMergeConflictActionAnchor, parseMergeConflictDiffFromFile } from "../utils/parseMergeConflictDiffFromFile.js";
import { UnresolvedFileHunksRenderer } from "../renderers/UnresolvedFileHunksRenderer.js";
import { areMergeConflictActionsEqual } from "../utils/areMergeConflictActionsEqual.js";
import { resolveConflict } from "../utils/resolveConflict.js";
//#region src/components/UnresolvedFile.ts
let instanceId = -1;
var UnresolvedFile = class extends FileDiff {
	options;
	__id = `unresolved-file:${++instanceId}`;
	type = "unresolved-file";
	computedCache = {
		file: void 0,
		fileDiff: void 0,
		actions: void 0,
		markerRows: void 0
	};
	conflictActions = [];
	markerRows = [];
	conflictActionCache = /* @__PURE__ */ new Map();
	constructor(options = { theme: DEFAULT_THEMES }, workerManager, isContainerManaged = false) {
		super(void 0, workerManager, isContainerManaged);
		this.options = options;
		this.setOptions(options);
	}
	setOptions(options) {
		if (options == null) return;
		if (options.onMergeConflictAction != null && options.onMergeConflictResolve != null) throw new Error("UnresolvedFile: onMergeConflictAction and onMergeConflictResolve are mutually exclusive. Use only one callback.");
		this.options = options;
		this.hunksRenderer.setOptions(this.getHunksRendererOptions(options));
		this.syncInteractionOptions();
	}
	syncInteractionOptions() {
		this.interactionManager.setOptions(pluckInteractionOptions(this.options, typeof this.options.hunkSeparators === "function" || (this.options.hunkSeparators ?? "line-info") === "line-info" || this.options.hunkSeparators === "line-info-basic" ? this.handleExpandHunk : void 0, this.getLineIndex, this.handleMergeConflictActionClick));
	}
	createHunksRenderer(options) {
		return new UnresolvedFileHunksRenderer(this.getHunksRendererOptions(options), this.handleHighlightRender, this.workerManager);
	}
	getHunksRendererOptions(options) {
		return getUnresolvedDiffHunksRendererOptions(options, this.options);
	}
	applyPreNodeAttributes(pre, result) {
		super.applyPreNodeAttributes(pre, result, { "data-has-merge-conflict": "" });
	}
	cleanUp() {
		this.emitPostRender(true);
		this.clearMergeConflictActionCache();
		this.computedCache = {
			file: void 0,
			fileDiff: void 0,
			actions: void 0,
			markerRows: void 0
		};
		this.conflictActions = [];
		super.cleanUp();
	}
	getOrComputeDiff({ file, fileDiff, actions, markerRows }) {
		const { maxContextLines, onMergeConflictAction } = this.options;
		wrapper: if (onMergeConflictAction != null) {
			const hasFileDiff = fileDiff != null;
			if (hasFileDiff !== (actions != null) || hasFileDiff !== (markerRows != null)) throw new Error("UnresolvedFile.getOrComputeDiff: fileDiff, actions, and markerRows must be passed together");
			if (fileDiff != null && actions != null && markerRows != null) {
				this.computedCache = {
					file: file ?? this.computedCache.file,
					fileDiff,
					actions,
					markerRows
				};
				break wrapper;
			} else if (file != null || this.computedCache.file != null) {
				if (file != null && this.computedCache.file != null && !areFilesEqual(file, this.computedCache.file) && this.computedCache.fileDiff != null && this.computedCache.actions != null) throw new Error("UnresolvedFile.getOrComputeDiff: file can only be used to initialize unresolved state once. Pass fileDiff and actions for subsequent updates.");
				file ??= this.computedCache.file;
				if (file == null) throw new Error("UnresolvedFile.getOrComputeDiff: file is null, should be impossible");
				if (!areFilesEqual(file, this.computedCache.file) || this.computedCache.fileDiff == null || this.computedCache.actions == null) {
					const computed = parseMergeConflictDiffFromFile(file, maxContextLines);
					this.computedCache = {
						file,
						fileDiff: computed.fileDiff,
						actions: computed.actions,
						markerRows: computed.markerRows
					};
				}
				fileDiff = this.computedCache.fileDiff;
				actions = this.computedCache.actions;
				markerRows = this.computedCache.markerRows;
				break wrapper;
			} else {
				fileDiff = this.computedCache.fileDiff;
				actions = this.computedCache.actions;
				markerRows = this.computedCache.markerRows;
				break wrapper;
			}
		} else {
			if (fileDiff != null || actions != null || markerRows != null) throw new Error("UnresolvedFile.getOrComputeDiff: fileDiff, actions, and markerRows are only usable in controlled mode, you must pass in `onMergeConflictAction`");
			if (file != null && this.computedCache.file != null && !areFilesEqual(file, this.computedCache.file)) throw new Error("UnresolvedFile.getOrComputeDiff: uncontrolled unresolved files parse the file only once. Later updates must come from the cached diff state.");
			this.computedCache.file ??= file;
			if (this.computedCache.fileDiff == null && this.computedCache.file != null) {
				const computed = parseMergeConflictDiffFromFile(this.computedCache.file, maxContextLines);
				this.computedCache.fileDiff = computed.fileDiff;
				this.computedCache.actions = computed.actions;
				this.computedCache.markerRows = computed.markerRows;
			}
			fileDiff = this.computedCache.fileDiff;
			actions = this.computedCache.actions;
			markerRows = this.computedCache.markerRows;
			break wrapper;
		}
		if (fileDiff == null || actions == null || markerRows == null) return;
		return {
			fileDiff,
			actions,
			markerRows
		};
	}
	hydrate(props) {
		const { file, fileDiff, actions, markerRows, lineAnnotations, fileContainer, prerenderedHTML, preventEmit = false } = props;
		const source = this.getOrComputeDiff({
			file,
			fileDiff,
			actions,
			markerRows
		});
		if (source == null) return;
		this.hydrateElements(fileContainer, prerenderedHTML);
		this.setActiveMergeConflictState(source.actions, source.markerRows);
		if (shouldRenderCode(this.pre, source.fileDiff, this.options.collapsed) || shouldRenderHeader(this.headerElement, source.fileDiff, this.options.disableFileHeader)) this.render({
			...props,
			preventEmit: true
		});
		else {
			this.hydrationSetup({
				fileDiff: source.fileDiff,
				lineAnnotations
			});
			if (this.pre != null) this.renderMergeConflictActionSlots();
		}
		if (!preventEmit) this.emitPostRender();
	}
	rerender() {
		if (!this.enabled || this.fileDiff == null) return;
		this.render({
			forceRender: true,
			renderRange: this.renderRange
		});
	}
	render(props = {}) {
		const { file, fileDiff, actions, markerRows, lineAnnotations, preventEmit = false, ...rest } = props;
		const source = this.getOrComputeDiff({
			file,
			fileDiff,
			actions,
			markerRows
		});
		if (source == null) return false;
		this.setActiveMergeConflictState(source.actions, source.markerRows);
		const didRender = super.render({
			...rest,
			fileDiff: source.fileDiff,
			lineAnnotations,
			preventEmit: true
		});
		if (didRender) {
			this.renderMergeConflictActionSlots();
			if (!preventEmit) this.emitPostRender();
		}
		return didRender;
	}
	resolveConflict(conflictIndex, resolution, fileDiff = this.computedCache.fileDiff) {
		const action = this.conflictActions[conflictIndex];
		if (fileDiff == null || action == null) return;
		if (action.conflictIndex !== conflictIndex) {
			console.error({
				conflictIndex,
				action
			});
			throw new Error("UnresolvedFile.resolveConflict: conflictIndex and conflictAction don't match");
		}
		const newFileDiff = resolveConflict(fileDiff, action, resolution);
		const previousFile = this.computedCache.file;
		const { file, actions, markerRows } = rebuildFileAndActions({
			fileDiff: newFileDiff,
			previousActions: this.conflictActions,
			resolvedConflictIndex: conflictIndex,
			previousFile,
			resolution
		});
		return {
			file,
			fileDiff: newFileDiff,
			actions,
			markerRows
		};
	}
	resolveConflictAndRender(conflictIndex, resolution) {
		const action = this.conflictActions[conflictIndex];
		if (action == null) return;
		if (action.conflictIndex !== conflictIndex) {
			console.error({
				conflictIndex,
				action
			});
			throw new Error("UnresolvedFile.resolveConflictAndRender: conflictIndex and conflictAction don't match");
		}
		const payload = {
			resolution,
			conflict: action.conflict
		};
		const { file, fileDiff, actions, markerRows } = this.resolveConflict(conflictIndex, resolution) ?? {};
		if (file == null || fileDiff == null || actions == null || markerRows == null) return;
		this.computedCache = {
			file,
			fileDiff,
			actions,
			markerRows
		};
		this.setActiveMergeConflictState(actions, markerRows);
		if (this.workerManager != null) this.hunksRenderer.renderDiff(fileDiff);
		else this.render({ forceRender: true });
		this.options.onMergeConflictResolve?.(file, payload);
	}
	setActiveMergeConflictState(actions = this.conflictActions, markerRows = this.markerRows) {
		this.conflictActions = actions;
		this.markerRows = markerRows;
		if (this.computedCache.fileDiff != null && this.hunksRenderer instanceof UnresolvedFileHunksRenderer) this.hunksRenderer.setConflictState(this.options.mergeConflictActionsType === "none" ? [] : actions, markerRows, this.computedCache.fileDiff);
	}
	handleMergeConflictActionClick = (target) => {
		const action = this.conflictActions[target.conflictIndex];
		if (action == null) return;
		if (action.conflictIndex !== target.conflictIndex) {
			console.error({
				conflictIndex: target.conflictIndex,
				action
			});
			throw new Error("UnresolvedFile.handleMergeConflictActionClick: conflictIndex and conflictAction don't match");
		}
		const payload = {
			resolution: target.resolution,
			conflict: action.conflict
		};
		if (this.options.onMergeConflictAction != null) {
			this.options.onMergeConflictAction(payload, this);
			return;
		}
		this.resolveConflictAndRender(target.conflictIndex, target.resolution);
	};
	renderMergeConflictActionSlots() {
		const { fileDiff } = this.computedCache;
		if (this.isContainerManaged || this.fileContainer == null || typeof this.options.mergeConflictActionsType !== "function" || this.conflictActions.length === 0 || fileDiff == null) {
			this.clearMergeConflictActionCache();
			return;
		}
		const staleActions = new Map(this.conflictActionCache);
		for (let actionIndex = 0; actionIndex < this.conflictActions.length; actionIndex++) {
			const action = this.conflictActions[actionIndex];
			if (action == null) continue;
			if (action.conflictIndex !== actionIndex) {
				console.error({
					conflictIndex: actionIndex,
					action
				});
				throw new Error("UnresolvedFile.renderMergeConflictActionSlots: conflictIndex and conflictAction don't match");
			}
			const anchor = getMergeConflictActionAnchor(action, fileDiff);
			if (anchor == null) continue;
			const conflictIndex = action.conflictIndex;
			const slotName = getMergeConflictActionSlotName({
				hunkIndex: anchor.hunkIndex,
				lineIndex: anchor.lineIndex,
				conflictIndex
			});
			const id = `${actionIndex}-${slotName}`;
			let cache = this.conflictActionCache.get(id);
			if (cache == null || !areMergeConflictActionsEqual(cache.action, action)) {
				cache?.element.remove();
				const rendered = this.renderMergeConflictAction(action);
				if (rendered == null) continue;
				const element = createAnnotationWrapperNode(slotName);
				element.appendChild(rendered);
				this.fileContainer.appendChild(element);
				cache = {
					element,
					action
				};
				this.conflictActionCache.set(id, cache);
			}
			staleActions.delete(id);
		}
		for (const [id, { element }] of staleActions.entries()) {
			this.conflictActionCache.delete(id);
			element.remove();
		}
	}
	renderMergeConflictAction(action) {
		if (typeof this.options.mergeConflictActionsType !== "function") return;
		const rendered = this.options.mergeConflictActionsType(action, this);
		if (rendered == null) return;
		if (rendered instanceof HTMLElement) return rendered;
		if (typeof DocumentFragment !== "undefined" && rendered instanceof DocumentFragment) {
			const wrapper = document.createElement("div");
			wrapper.style.display = "contents";
			wrapper.appendChild(rendered);
			return wrapper;
		}
	}
	clearMergeConflictActionCache() {
		for (const { element } of this.conflictActionCache.values()) element.remove();
		this.conflictActionCache.clear();
	}
};
function rebuildFileAndActions({ fileDiff, previousActions, resolvedConflictIndex, previousFile, resolution }) {
	const resolvedAction = previousActions[resolvedConflictIndex];
	if (resolvedAction == null) throw new Error("rebuildFileAndActions: missing resolved action for unresolved file rebuild");
	const actions = updateConflictActionsAfterResolution(previousActions, resolvedConflictIndex, resolvedAction, resolution);
	const markerRows = buildMergeConflictMarkerRows(fileDiff, actions);
	return {
		file: rebuildUnresolvedFile({
			fileDiff,
			resolvedAction,
			resolvedConflictIndex,
			previousFile,
			resolution
		}),
		actions,
		markerRows
	};
}
function rebuildUnresolvedFile({ resolvedAction, resolvedConflictIndex, previousFile, fileDiff, resolution }) {
	const lines = splitFileContents(previousFile?.contents ?? "");
	const { conflict } = resolvedAction;
	const replacementLines = getResolvedConflictReplacementLines(lines, conflict, resolution);
	const contents = [
		...lines.slice(0, conflict.startLineIndex),
		...replacementLines,
		...lines.slice(conflict.endLineIndex + 1)
	].join("");
	return {
		name: previousFile?.name ?? fileDiff.name,
		contents,
		cacheKey: previousFile?.cacheKey != null ? `${previousFile.cacheKey}:mc-${resolvedConflictIndex}-${resolution}` : void 0
	};
}
function getResolvedConflictReplacementLines(lines, conflict, resolution) {
	const currentLines = lines.slice(conflict.startLineIndex + 1, conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex);
	const incomingLines = lines.slice(conflict.separatorLineIndex + 1, conflict.endLineIndex);
	if (resolution === "current") return currentLines;
	if (resolution === "incoming") return incomingLines;
	return [...currentLines, ...incomingLines];
}
function updateConflictActionsAfterResolution(previousActions, resolvedConflictIndex, resolvedAction, resolution) {
	const lineDelta = getResolvedConflictLineDelta(resolvedAction.conflict, resolution);
	return previousActions.map((action, index) => {
		if (index === resolvedConflictIndex) return;
		if (action == null) return;
		if (action.conflict.startLineIndex > resolvedAction.conflict.endLineIndex) return {
			...action,
			conflict: shiftMergeConflictRegion(action.conflict, lineDelta)
		};
		return action;
	});
}
function getResolvedConflictLineDelta(conflict, resolution) {
	const currentLineCount = (conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex) - conflict.startLineIndex - 1;
	const incomingLineCount = conflict.endLineIndex - conflict.separatorLineIndex - 1;
	return (resolution === "current" ? currentLineCount : resolution === "incoming" ? incomingLineCount : currentLineCount + incomingLineCount) - (conflict.endLineIndex - conflict.startLineIndex + 1);
}
function shiftMergeConflictRegion(conflict, lineDelta) {
	return {
		...conflict,
		startLineIndex: conflict.startLineIndex + lineDelta,
		startLineNumber: conflict.startLineNumber + lineDelta,
		separatorLineIndex: conflict.separatorLineIndex + lineDelta,
		separatorLineNumber: conflict.separatorLineNumber + lineDelta,
		endLineIndex: conflict.endLineIndex + lineDelta,
		endLineNumber: conflict.endLineNumber + lineDelta,
		baseMarkerLineIndex: conflict.baseMarkerLineIndex != null ? conflict.baseMarkerLineIndex + lineDelta : void 0,
		baseMarkerLineNumber: conflict.baseMarkerLineNumber != null ? conflict.baseMarkerLineNumber + lineDelta : void 0
	};
}
function shouldRenderCode(pre, fileDiff, collapsed = false) {
	return !collapsed && pre == null && fileDiff != null;
}
function shouldRenderHeader(headerElement, fileDiff, disableFileHeader = false) {
	return headerElement == null && fileDiff != null && !disableFileHeader;
}
function getUnresolvedDiffHunksRendererOptions(options, baseOptions) {
	return {
		...baseOptions,
		...options,
		hunkSeparators: typeof options?.hunkSeparators === "function" ? "custom" : options?.hunkSeparators,
		mergeConflictActionsType: typeof options?.mergeConflictActionsType === "function" ? "custom" : options?.mergeConflictActionsType
	};
}
//#endregion
export { UnresolvedFile, getUnresolvedDiffHunksRendererOptions };

//# sourceMappingURL=UnresolvedFile.js.map