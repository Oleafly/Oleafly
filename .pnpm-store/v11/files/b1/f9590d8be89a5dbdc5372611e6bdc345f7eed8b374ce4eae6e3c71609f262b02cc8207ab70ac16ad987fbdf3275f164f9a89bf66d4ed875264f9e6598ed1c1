import { DEFAULT_VIRTUAL_FILE_METRICS } from "../constants.js";
import { areObjectsEqual } from "../utils/areObjectsEqual.js";
import { areOptionsEqual } from "../utils/areOptionsEqual.js";
import { getVirtualFileHeaderRegion, getVirtualFilePaddingBottom } from "../utils/computeVirtualFileMetrics.js";
import { FILE_ANNOTATION_DOM_KEY, includesFileAnnotations, shouldRenderFileAnnotations } from "../utils/includesFileAnnotations.js";
import { iterateOverFile } from "../utils/iterateOverFile.js";
import { File } from "./File.js";
//#region src/components/VirtualizedFile.ts
const LAYOUT_CHECKPOINT_INTERVAL = 5e3;
let instanceId = -1;
function hasFileLayoutOptionChanged(previousOptions, nextOptions) {
	return (previousOptions.overflow ?? "scroll") !== (nextOptions.overflow ?? "scroll") || (previousOptions.collapsed ?? false) !== (nextOptions.collapsed ?? false) || (previousOptions.disableLineNumbers ?? false) !== (nextOptions.disableLineNumbers ?? false) || (previousOptions.disableFileHeader ?? false) !== (nextOptions.disableFileHeader ?? false) || previousOptions.unsafeCSS !== nextOptions.unsafeCSS;
}
var VirtualizedFile = class extends File {
	virtualizer;
	metrics;
	__id = `virtualized-file:${++instanceId}`;
	top;
	height = 0;
	cache = {
		heights: /* @__PURE__ */ new Map(),
		checkpoints: [],
		fileAnnotationHeight: 0
	};
	isVisible = false;
	isSetup = false;
	layoutDirty = true;
	forceRenderOverride;
	currentCollapsed;
	constructor(options, virtualizer, metrics = DEFAULT_VIRTUAL_FILE_METRICS, workerManager, isContainerManaged = false) {
		super(options, workerManager, isContainerManaged);
		this.virtualizer = virtualizer;
		this.metrics = metrics;
	}
	setMetrics(metrics, force = false) {
		if (!force && areObjectsEqual(this.metrics, metrics)) return;
		this.metrics = metrics;
		this.resetLayoutCache();
	}
	setLineAnnotations(lineAnnotations) {
		if (this.syncLineAnnotations(lineAnnotations)) this.resetLayoutCache();
	}
	syncLineAnnotations(lineAnnotations) {
		if (lineAnnotations == null || lineAnnotations === this.lineAnnotations) return false;
		if (lineAnnotations.length === 0 && this.lineAnnotations.length === 0) return false;
		super.setLineAnnotations(lineAnnotations);
		return true;
	}
	hasLineAnnotations() {
		return this.lineAnnotations.some((annotation) => annotation.lineNumber > 0);
	}
	getLineHeight(lineIndex, hasMetadataLine = false) {
		const cached = this.cache.heights.get(lineIndex);
		if (cached != null) return cached;
		const multiplier = hasMetadataLine ? 2 : 1;
		return this.metrics.lineHeight * multiplier;
	}
	setOptions(options) {
		if (this.isAdvancedMode()) throw new Error("VirtualizedFile.setOptions cannot be used inside CodeView. Update CodeView options instead.");
		if (options == null) return;
		const { options: previousOptions } = this;
		const optionsChanged = !areOptionsEqual(previousOptions, options);
		const layoutChanged = hasFileLayoutOptionChanged(previousOptions, options);
		super.setOptions(options);
		if (layoutChanged) this.resetLayoutCache(true);
		if (optionsChanged) this.forceRenderOverride = true;
		if (optionsChanged) this.virtualizer.instanceChanged(this, layoutChanged);
	}
	setThemeType(themeType) {
		if (this.isAdvancedMode()) throw new Error("VirtualizedFile.setThemeType cannot be used inside CodeView. Update CodeView options instead.");
		super.setThemeType(themeType);
	}
	resetLayoutCache(recompute = false) {
		this.layoutDirty = true;
		this.cache.fileAnnotationHeight = 0;
		if (this.cache.heights.size > 0) this.cache.heights.clear();
		if (this.cache.checkpoints.length > 0) this.cache.checkpoints.length = 0;
		if (this.renderRange != null) this.renderRange = void 0;
		if (recompute && this.isSimpleMode()) this.computeApproximateSize();
	}
	reconcileHeights() {
		let hasHeightChange = false;
		if (this.fileContainer == null || this.file == null) {
			if (this.height !== 0) hasHeightChange = true;
			this.height = 0;
			return hasHeightChange;
		}
		const { overflow = "scroll" } = this.options;
		this.top = this.getVirtualizedTop();
		if (overflow === "scroll" && this.lineAnnotations.length === 0 && !this.isResizeDebuggingEnabled()) return hasHeightChange;
		if (this.code == null) return hasHeightChange;
		const content = this.code.children[1];
		if (!(content instanceof HTMLElement)) return hasHeightChange;
		const hasFileAnnotations = includesFileAnnotations(this.lineAnnotations);
		if (this.renderRange != null && hasFileAnnotations && shouldRenderFileAnnotations(this.renderRange)) {
			const nextFileAnnotationHeight = measureFileAnnotationHeight(content) ?? 0;
			if (nextFileAnnotationHeight !== this.cache.fileAnnotationHeight) {
				this.cache.fileAnnotationHeight = nextFileAnnotationHeight;
				hasHeightChange = true;
			}
		} else if (!hasFileAnnotations && this.cache.fileAnnotationHeight !== 0) {
			this.cache.fileAnnotationHeight = 0;
			hasHeightChange = true;
		}
		for (const line of content.children) {
			if (!(line instanceof HTMLElement)) continue;
			const lineIndexAttr = line.dataset.lineIndex;
			if (lineIndexAttr == null) continue;
			const lineIndex = Number(lineIndexAttr);
			let measuredHeight = line.getBoundingClientRect().height;
			let hasMetadata = false;
			if (line.nextElementSibling instanceof HTMLElement && ("lineAnnotation" in line.nextElementSibling.dataset || "noNewline" in line.nextElementSibling.dataset)) {
				if ("noNewline" in line.nextElementSibling.dataset) hasMetadata = true;
				measuredHeight += line.nextElementSibling.getBoundingClientRect().height;
			}
			const expectedHeight = this.getLineHeight(lineIndex, hasMetadata);
			if (measuredHeight === expectedHeight) continue;
			hasHeightChange = true;
			if (measuredHeight === this.metrics.lineHeight * (hasMetadata ? 2 : 1)) this.cache.heights.delete(lineIndex);
			else this.cache.heights.set(lineIndex, measuredHeight);
		}
		if (hasHeightChange || this.isResizeDebuggingEnabled()) this.computeApproximateSize(true);
		return hasHeightChange;
	}
	onRender = (dirty) => {
		if (this.fileContainer == null || this.file == null) return false;
		if (dirty) this.top = this.getVirtualizedTop();
		return this.render({ file: this.file });
	};
	prepareCodeViewItem(file, top, reset, lineAnnotations) {
		const annotationsChanged = this.syncLineAnnotations(lineAnnotations);
		let shouldResetLayoutCache = reset?.resetFileLayoutCache === true || annotationsChanged;
		if (reset?.metrics != null) {
			this.metrics = reset.metrics;
			shouldResetLayoutCache = true;
		}
		const { collapsed = false } = this.options;
		if (this.currentCollapsed !== collapsed) {
			this.currentCollapsed = collapsed;
			shouldResetLayoutCache = true;
		}
		if (shouldResetLayoutCache) this.resetLayoutCache();
		if (this.file !== file) this.layoutDirty = true;
		this.file = file;
		this.top = top;
		this.computeApproximateSize();
		return this.height;
	}
	getLinePosition(lineNumber) {
		if (this.file == null || lineNumber < 1) return;
		const { disableFileHeader = false, collapsed = false } = this.options;
		const lastLineIndex = getLastVisibleLineIndex(this.getOrCreateLineCache(this.file));
		let top = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		if (collapsed || lastLineIndex < 0) return {
			top,
			height: 0
		};
		const clampedLineIndex = Math.min(Math.max(lineNumber - 1, 0), lastLineIndex);
		const { overflow = "scroll" } = this.options;
		const { lineHeight } = this.metrics;
		top += this.cache.fileAnnotationHeight;
		if (overflow === "scroll" && !this.hasLineAnnotations()) return {
			top: top + clampedLineIndex * lineHeight,
			height: lineHeight
		};
		const checkpoint = this.getLayoutCheckpointBeforeLineIndex(clampedLineIndex);
		top = checkpoint?.top ?? top;
		for (let lineIndex = checkpoint?.lineIndex ?? 0; lineIndex < clampedLineIndex; lineIndex++) top += this.getLineHeight(lineIndex, false);
		return {
			top,
			height: this.getLineHeight(clampedLineIndex, false)
		};
	}
	getNumericScrollAnchor(localViewportTop) {
		if (this.file == null || this.renderRange == null) return;
		const { disableFileHeader = false, collapsed = false, overflow = "scroll" } = this.options;
		if (collapsed || this.renderRange.totalLines <= 0) return;
		const lastLineIndex = getLastVisibleLineIndex(this.getOrCreateLineCache(this.file));
		if (lastLineIndex < 0) return;
		const headerRegion = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		const firstRenderedLineIndex = Math.min(this.renderRange.startingLine, lastLineIndex);
		const lastRenderedLineIndex = Math.min(firstRenderedLineIndex + this.renderRange.totalLines - 1, lastLineIndex);
		if (lastRenderedLineIndex < firstRenderedLineIndex) return;
		const { fileAnnotationHeight } = this.cache;
		if (overflow === "scroll" && !this.hasLineAnnotations()) {
			const { lineHeight } = this.metrics;
			const firstRenderedLineTop = headerRegion + (firstRenderedLineIndex === 0 ? fileAnnotationHeight : this.renderRange.bufferBefore);
			const lineIndex = firstRenderedLineIndex + Math.max(Math.ceil((localViewportTop - firstRenderedLineTop) / lineHeight), 0);
			if (lineIndex > lastRenderedLineIndex) return;
			return {
				lineNumber: lineIndex + 1,
				top: headerRegion + fileAnnotationHeight + lineIndex * lineHeight
			};
		}
		let top = headerRegion + (firstRenderedLineIndex === 0 ? fileAnnotationHeight : this.renderRange.bufferBefore);
		for (let lineIndex = firstRenderedLineIndex; lineIndex <= lastRenderedLineIndex; lineIndex++) {
			if (top >= localViewportTop) return {
				lineNumber: lineIndex + 1,
				top
			};
			top += this.getLineHeight(lineIndex);
		}
	}
	getVirtualizedHeight() {
		return this.height;
	}
	getAdvancedStickySpecs(windowSpecs) {
		if (this.top == null || this.file == null) return;
		if (this.options.collapsed === true) return {
			topOffset: this.top,
			height: this.height
		};
		const renderRange = windowSpecs != null ? this.computeRenderRangeFromWindow(this.file, this.top, windowSpecs) : this.renderRange;
		if (renderRange == null) return;
		const { bufferBefore, bufferAfter, totalLines } = renderRange;
		let headerOnlyOffset = 0;
		if (totalLines === 0) {
			const activeWindow = windowSpecs ?? this.virtualizer.getWindowSpecs();
			if (this.top < activeWindow.top) headerOnlyOffset = bufferAfter;
		}
		return {
			topOffset: this.top + bufferBefore + headerOnlyOffset,
			height: this.height - (bufferBefore + bufferAfter)
		};
	}
	cleanUp(recycle = false) {
		if (this.fileContainer != null && this.isSimpleMode()) this.getSimpleVirtualizer()?.disconnect(this.fileContainer);
		if (!recycle) this.resetLayoutCache();
		this.isSetup = false;
		super.cleanUp(recycle);
	}
	computeApproximateSize(force = false) {
		const shouldValidateSize = this.isResizeDebuggingEnabled();
		if (!force && !this.layoutDirty && !shouldValidateSize) return;
		const isFirstCompute = this.height === 0;
		this.height = 0;
		this.cache.checkpoints = [];
		if (this.file == null) {
			this.layoutDirty = false;
			return;
		}
		const { disableFileHeader = false, collapsed = false, overflow = "scroll" } = this.options;
		const { lineHeight } = this.metrics;
		const lines = this.getOrCreateLineCache(this.file);
		const headerRegion = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		const paddingBottom = getVirtualFilePaddingBottom(this.metrics);
		this.height += headerRegion;
		if (collapsed) {
			this.layoutDirty = false;
			return;
		}
		this.height += this.cache.fileAnnotationHeight;
		if (overflow === "scroll" && !this.hasLineAnnotations()) this.height += this.getOrCreateLineCache(this.file).length * lineHeight;
		else iterateOverFile({
			lines,
			callback: ({ lineIndex }) => {
				this.addLayoutCheckpoint(lineIndex, this.height);
				this.height += this.getLineHeight(lineIndex, false);
			}
		});
		if (lines.length > 0) this.height += paddingBottom;
		if (this.fileContainer != null && shouldValidateSize && !isFirstCompute) {
			const rect = this.fileContainer.getBoundingClientRect();
			if (rect.height !== this.height) console.log("VirtualizedFile.computeApproximateSize: computed height doesnt match", {
				name: this.file.name,
				elementHeight: rect.height,
				computedHeight: this.height
			});
			else console.log("VirtualizedFile.computeApproximateSize: computed height IS CORRECT");
		}
		this.layoutDirty = false;
	}
	setVisibility(visible) {
		if (this.isAdvancedMode() || this.fileContainer == null) return;
		if (visible && !this.isVisible) {
			this.top = this.getVirtualizedTop();
			this.isVisible = true;
		} else if (!visible && this.isVisible) {
			this.isVisible = false;
			this.rerender();
		}
	}
	rerender() {
		if (!this.enabled || this.file == null) return;
		this.forceRenderOverride = true;
		this.virtualizer.instanceChanged(this, false);
	}
	render({ fileContainer, file, forceRender = false, lineAnnotations, ...props }) {
		const { forceRenderOverride, isSetup } = this;
		this.forceRenderOverride = void 0;
		const annotationsChanged = this.syncLineAnnotations(lineAnnotations);
		if (annotationsChanged) this.resetLayoutCache();
		this.file ??= file;
		fileContainer = this.getOrCreateFileContainerNode(fileContainer);
		if (this.file == null) {
			console.error("VirtualizedFile.render: attempting to virtually render when we dont have file");
			return false;
		}
		if (!isSetup) {
			this.computeApproximateSize();
			const virtualizer = this.getSimpleVirtualizer();
			this.top ??= this.getVirtualizedTop();
			if (this.isAdvancedMode()) this.isVisible = true;
			else {
				if (virtualizer == null) throw new Error("VirtualizedFile.render: simple virtualizer is not available");
				virtualizer.connect(fileContainer, this);
				this.isVisible = virtualizer.isInstanceVisible(this.top ?? 0, this.height);
			}
			this.isSetup = true;
		} else this.top ??= this.getVirtualizedTop();
		if (!this.isVisible && this.isSimpleMode()) return this.renderPlaceholder(this.height);
		const windowSpecs = this.virtualizer.getWindowSpecs();
		const fileTop = this.top ?? 0;
		const renderRange = this.computeRenderRangeFromWindow(this.file, fileTop, windowSpecs);
		return super.render({
			file: this.file,
			fileContainer,
			renderRange,
			lineAnnotations,
			forceRender: (forceRenderOverride ?? forceRender) || annotationsChanged,
			...props
		});
	}
	syncVirtualizedTop() {
		this.top = this.getVirtualizedTop();
	}
	shouldDisableVirtualizationBuffers() {
		return this.isAdvancedMode() || super.shouldDisableVirtualizationBuffers();
	}
	isSimpleMode() {
		return this.virtualizer.type === "simple";
	}
	isAdvancedMode() {
		return this.virtualizer.type === "advanced";
	}
	addLayoutCheckpoint(lineIndex, top) {
		if (lineIndex % LAYOUT_CHECKPOINT_INTERVAL !== 0) return;
		this.cache.checkpoints.push({
			lineIndex,
			top
		});
	}
	getLayoutCheckpointBeforeLineIndex(lineIndex) {
		if (lineIndex <= 0 || this.cache.checkpoints.length === 0) return;
		let low = 0;
		let high = this.cache.checkpoints.length - 1;
		let result;
		while (low <= high) {
			const mid = low + high >> 1;
			const checkpoint = this.cache.checkpoints[mid];
			if (checkpoint == null) throw new Error("VirtualizedFile: invalid checkpoint index");
			if (checkpoint.lineIndex <= lineIndex) {
				result = checkpoint;
				low = mid + 1;
			} else high = mid - 1;
		}
		return result;
	}
	getLayoutCheckpointBeforeTop(top, hunkLineCount) {
		let low = 0;
		let high = this.cache.checkpoints.length - 1;
		let resultIndex = -1;
		while (low <= high) {
			const mid = low + high >> 1;
			const checkpoint = this.cache.checkpoints[mid];
			if (checkpoint == null) throw new Error("VirtualizedFile: invalid checkpoint index");
			if (checkpoint.top <= top) {
				resultIndex = mid;
				low = mid + 1;
			} else high = mid - 1;
		}
		if (hunkLineCount == null) return resultIndex >= 0 ? this.cache.checkpoints[resultIndex] : void 0;
		for (let index = resultIndex; index >= 0; index--) {
			const checkpoint = this.cache.checkpoints[index];
			if (checkpoint == null) throw new Error("VirtualizedFile: invalid checkpoint index");
			if (checkpoint.lineIndex % hunkLineCount === 0) return checkpoint;
		}
	}
	getVirtualizedTop() {
		if (this.virtualizer.type === "advanced") return this.virtualizer.getLocalTopForInstance(this);
		return this.fileContainer != null ? this.virtualizer.getOffsetInScrollContainer(this.fileContainer) : 0;
	}
	getSimpleVirtualizer() {
		return this.virtualizer.type === "simple" ? this.virtualizer : void 0;
	}
	isResizeDebuggingEnabled() {
		return this.getSimpleVirtualizer()?.config.resizeDebugging ?? false;
	}
	computeRenderRangeFromWindow(file, fileTop, { top, bottom }) {
		const { disableFileHeader = false, overflow = "scroll" } = this.options;
		const { hunkLineCount, lineHeight } = this.metrics;
		const lines = this.getOrCreateLineCache(file);
		const lineCount = lines.length;
		const fileHeight = this.height;
		const headerRegion = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		const paddingBottom = lineCount > 0 ? getVirtualFilePaddingBottom(this.metrics) : 0;
		const { fileAnnotationHeight } = this.cache;
		const codeRegionTop = headerRegion + fileAnnotationHeight;
		const codeRowsHeight = Math.max(0, fileHeight - headerRegion - fileAnnotationHeight - paddingBottom);
		const hasFileAnnotations = includesFileAnnotations(this.lineAnnotations);
		const fileAnnotationTop = fileTop + headerRegion;
		const measuredFileAnnotationVisible = fileAnnotationHeight > 0 && hasFileAnnotations && fileAnnotationTop < bottom && fileAnnotationTop + fileAnnotationHeight > top;
		if (fileTop < top - fileHeight || fileTop > bottom) return {
			startingLine: 0,
			totalLines: 0,
			bufferBefore: 0,
			bufferAfter: fileHeight - headerRegion - paddingBottom
		};
		if (lineCount <= hunkLineCount) return {
			startingLine: 0,
			totalLines: hunkLineCount,
			bufferBefore: 0,
			bufferAfter: 0
		};
		const estimatedTargetLines = Math.ceil(Math.max(bottom - top, 0) / lineHeight);
		const totalLines = Math.ceil(estimatedTargetLines / hunkLineCount) * hunkLineCount + hunkLineCount * 2;
		const totalHunks = totalLines / hunkLineCount;
		const viewportCenter = (top + bottom) / 2;
		if (overflow === "scroll" && !this.hasLineAnnotations()) {
			const sourceRowsTop = fileTop + codeRegionTop;
			const sourceRowsBottom = sourceRowsTop + codeRowsHeight;
			if (!measuredFileAnnotationVisible && !(sourceRowsTop < bottom && sourceRowsBottom > top)) return {
				startingLine: 0,
				totalLines: 0,
				bufferBefore: 0,
				bufferAfter: fileHeight - headerRegion - paddingBottom
			};
			const centerLine = Math.floor(measuredFileAnnotationVisible && viewportCenter < fileTop + codeRegionTop ? 0 : (viewportCenter - (fileTop + codeRegionTop)) / lineHeight);
			const idealStartHunk = Math.floor(centerLine / hunkLineCount) - Math.floor(totalHunks / 2);
			const totalHunksInFile = Math.ceil(lineCount / hunkLineCount);
			const startingLine = Math.max(0, Math.min(idealStartHunk, totalHunksInFile)) * hunkLineCount;
			const clampedTotalLines = idealStartHunk < 0 ? totalLines + idealStartHunk * hunkLineCount : totalLines;
			const bufferBefore = startingLine === 0 ? 0 : fileAnnotationHeight + startingLine * lineHeight;
			const renderedLines = Math.min(clampedTotalLines, lineCount - startingLine);
			return {
				startingLine,
				totalLines: clampedTotalLines,
				bufferBefore,
				bufferAfter: Math.max(0, (lineCount - startingLine - renderedLines) * lineHeight)
			};
		}
		const overflowHunks = totalHunks;
		const hunkOffsets = [];
		const checkpoint = this.getLayoutCheckpointBeforeTop(Math.max(0, top - fileTop - totalLines * lineHeight * 2), hunkLineCount);
		let absoluteLineTop = fileTop + (checkpoint?.top ?? codeRegionTop);
		let currentLine = checkpoint?.lineIndex ?? 0;
		let firstVisibleHunk;
		let centerHunk;
		let overflowCounter;
		iterateOverFile({
			lines,
			startingLine: checkpoint?.lineIndex ?? 0,
			callback: ({ lineIndex }) => {
				const isAtHunkBoundary = currentLine % hunkLineCount === 0;
				const currentHunk = Math.floor(currentLine / hunkLineCount);
				if (isAtHunkBoundary) {
					hunkOffsets[currentHunk] = absoluteLineTop - (fileTop + codeRegionTop);
					if (overflowCounter != null) {
						if (overflowCounter <= 0) return true;
						overflowCounter--;
					}
				}
				const lineHeight = this.getLineHeight(lineIndex, false);
				if (absoluteLineTop > top - lineHeight && absoluteLineTop < bottom) firstVisibleHunk ??= currentHunk;
				if (absoluteLineTop + lineHeight > viewportCenter) centerHunk ??= currentHunk;
				if (overflowCounter == null && absoluteLineTop >= bottom && isAtHunkBoundary) overflowCounter = overflowHunks;
				currentLine++;
				absoluteLineTop += lineHeight;
				return false;
			}
		});
		if (firstVisibleHunk == null) if (measuredFileAnnotationVisible) {
			firstVisibleHunk = 0;
			centerHunk = 0;
		} else return {
			startingLine: 0,
			totalLines: 0,
			bufferBefore: 0,
			bufferAfter: fileHeight - headerRegion - paddingBottom
		};
		centerHunk ??= firstVisibleHunk;
		const idealStartHunk = Math.round(centerHunk - totalHunks / 2);
		const maxStartHunk = Math.max(0, Math.ceil(lineCount / hunkLineCount) - totalHunks);
		const startHunk = Math.max(0, Math.min(idealStartHunk, maxStartHunk));
		const startingLine = startHunk * hunkLineCount;
		const clampedTotalLines = idealStartHunk < 0 ? totalLines + idealStartHunk * hunkLineCount : totalLines;
		const codeBufferBefore = hunkOffsets[startHunk] ?? 0;
		const bufferBefore = startingLine === 0 ? 0 : fileAnnotationHeight + codeBufferBefore;
		const finalHunkIndex = startHunk + clampedTotalLines / hunkLineCount;
		const bufferAfter = finalHunkIndex < hunkOffsets.length ? codeRowsHeight - hunkOffsets[finalHunkIndex] : codeRowsHeight - (absoluteLineTop - fileTop - codeRegionTop);
		return {
			startingLine,
			totalLines: clampedTotalLines,
			bufferBefore,
			bufferAfter: Math.max(0, bufferAfter)
		};
	}
};
function measureFileAnnotationHeight(content) {
	let height;
	for (const child of content.children) {
		if (!(child instanceof HTMLElement)) continue;
		if (child.dataset.lineAnnotation !== FILE_ANNOTATION_DOM_KEY) continue;
		height = Math.max(height ?? 0, child.getBoundingClientRect().height);
	}
	return height;
}
function getLastVisibleLineIndex(lines) {
	const lastLine = lines.at(-1);
	if (lastLine == null || lastLine === "" || lastLine === "\n" || lastLine === "\r\n" || lastLine === "\r") return lines.length - 2;
	return lines.length - 1;
}
//#endregion
export { VirtualizedFile };

//# sourceMappingURL=VirtualizedFile.js.map