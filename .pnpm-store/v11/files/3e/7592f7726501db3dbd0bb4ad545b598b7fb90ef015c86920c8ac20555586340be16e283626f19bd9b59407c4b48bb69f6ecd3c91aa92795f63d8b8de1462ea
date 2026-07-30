import "../constants.js";
import { areObjectsEqual } from "../utils/areObjectsEqual.js";
import { areOptionsEqual } from "../utils/areOptionsEqual.js";
import { computeVirtualFileMetrics, getVirtualFileHeaderRegion, getVirtualFilePaddingBottom } from "../utils/computeVirtualFileMetrics.js";
import { FILE_ANNOTATION_DOM_KEY, includesFileAnnotations, shouldRenderFileAnnotations } from "../utils/includesFileAnnotations.js";
import { areDiffTargetsEqual } from "../utils/areDiffTargetsEqual.js";
import { getExpandedRegion, getLeadingHunkSeparatorLayout, getTrailingExpandedRegion, getTrailingHunkSeparatorLayout } from "../utils/virtualDiffLayout.js";
import { computeEstimatedDiffHeights } from "../utils/computeEstimatedDiffHeights.js";
import { iterateOverDiff } from "../utils/iterateOverDiff.js";
import { parseDiffFromFile } from "../utils/parseDiffFromFile.js";
import { FileDiff } from "./FileDiff.js";
//#region src/components/VirtualizedFileDiff.ts
const LAYOUT_CHECKPOINT_INTERVAL = 5e3;
let instanceId = -1;
var VirtualizedFileDiff = class extends FileDiff {
	__id = `little-virtualized-file-diff:${++instanceId}`;
	top;
	height = 0;
	metrics;
	cache = {
		heightDeltas: /* @__PURE__ */ new Map(),
		measuredHeightDeltaTotal: 0,
		estimatedSplitHeight: void 0,
		estimatedUnifiedHeight: void 0,
		checkpoints: [],
		totalLines: 0,
		fileAnnotationHeight: 0
	};
	isVisible = false;
	isSetup = false;
	virtualizer;
	layoutDirty = true;
	forceRenderOverride;
	currentCollapsed;
	constructor(options, virtualizer, metrics, workerManager, isContainerManaged = false) {
		super(options, workerManager, isContainerManaged);
		this.virtualizer = virtualizer;
		this.metrics = computeVirtualFileMetrics(metrics);
	}
	setMetrics(metrics, force = false) {
		const nextMetrics = computeVirtualFileMetrics(metrics);
		if (!force && areObjectsEqual(this.metrics, nextMetrics)) return;
		this.metrics = nextMetrics;
		this.resetLayoutCache({ includeEstimatedHeights: true });
	}
	setLineAnnotations(lineAnnotations) {
		if (this.syncLineAnnotations(lineAnnotations)) this.resetLayoutCache({ includeEstimatedHeights: false });
	}
	syncLineAnnotations(lineAnnotations) {
		if (lineAnnotations == null || lineAnnotations === this.lineAnnotations || lineAnnotations.length === 0 && this.lineAnnotations.length === 0) return false;
		super.setLineAnnotations(lineAnnotations);
		return true;
	}
	setFileAnnotationHeight(nextHeight) {
		const previousHeight = this.cache.fileAnnotationHeight;
		if (nextHeight === previousHeight) return false;
		this.cache.fileAnnotationHeight = nextHeight;
		this.cache.measuredHeightDeltaTotal += nextHeight - previousHeight;
		return true;
	}
	hasFileAnnotations(fileDiff = this.fileDiff) {
		if (fileDiff == null || !includesFileAnnotations(this.lineAnnotations)) return false;
		return this.lineAnnotations.some((annotation) => {
			if (annotation.lineNumber !== 0) return false;
			if (fileDiff.type === "new") return annotation.side === "additions";
			if (fileDiff.type === "deleted") return annotation.side === "deletions";
			return true;
		});
	}
	getLineHeight(lineIndex, hasMetadataLine = false) {
		return this.getEstimatedLineHeight(hasMetadataLine) + (this.cache.heightDeltas.get(lineIndex) ?? 0);
	}
	getEstimatedLineHeight(hasMetadataLine = false) {
		const multiplier = hasMetadataLine ? 2 : 1;
		return this.metrics.lineHeight * multiplier;
	}
	setOptions(options) {
		if (this.isAdvancedMode()) throw new Error("VirtualizedFileDiff.setOptions cannot be used inside CodeView. Update CodeView options instead.");
		if (options == null) return;
		const { options: previousOptions } = this;
		const optionsChanged = !areOptionsEqual(previousOptions, options);
		const layoutChanged = optionsChanged && hasDiffLayoutOptionChanged(previousOptions, options);
		super.setOptions(options);
		if (layoutChanged) this.resetLayoutCache({
			forceSimpleRecompute: true,
			includeEstimatedHeights: hasDiffEstimateOptionChanged(previousOptions, options)
		});
		if (optionsChanged) this.forceRenderOverride = true;
		if (optionsChanged && this.isSimpleMode()) this.virtualizer.instanceChanged(this, layoutChanged);
	}
	setThemeType(themeType) {
		if (this.isAdvancedMode()) throw new Error("VirtualizedFileDiff.setThemeType cannot be used inside CodeView. Update CodeView options instead.");
		super.setThemeType(themeType);
	}
	resetLayoutCache({ forceSimpleRecompute = false, includeEstimatedHeights = false } = {}) {
		this.layoutDirty = true;
		this.cache.fileAnnotationHeight = 0;
		if (this.cache.heightDeltas.size > 0) this.cache.heightDeltas.clear();
		if (this.cache.measuredHeightDeltaTotal !== 0) this.cache.measuredHeightDeltaTotal = 0;
		if (this.cache.checkpoints.length > 0) this.cache.checkpoints.length = 0;
		if (this.cache.totalLines !== 0) this.cache.totalLines = 0;
		if (includeEstimatedHeights) {
			this.cache.estimatedSplitHeight = void 0;
			this.cache.estimatedUnifiedHeight = void 0;
		}
		if (this.renderRange != null) this.renderRange = void 0;
		if (forceSimpleRecompute && this.isSimpleMode()) this.computeApproximateSize();
	}
	reconcileHeights() {
		let hasHeightChange = false;
		const { overflow = "scroll" } = this.options;
		if (this.fileContainer == null || this.fileDiff == null) {
			if (this.height !== 0) hasHeightChange = true;
			this.height = 0;
			return hasHeightChange;
		}
		this.top = this.getVirtualizedTop();
		if (overflow === "scroll" && this.lineAnnotations.length === 0 && !this.isResizeDebuggingEnabled()) return hasHeightChange;
		const diffStyle = this.getDiffStyle();
		const codeGroups = diffStyle === "split" ? [this.codeDeletions, this.codeAdditions] : [this.codeUnified];
		const hasFileAnnotations = this.hasFileAnnotations(this.fileDiff);
		if (this.renderRange != null && hasFileAnnotations && shouldRenderFileAnnotations(this.renderRange)) {
			const nextFileAnnotationHeight = measureFileAnnotationHeight(codeGroups) ?? 0;
			if (this.setFileAnnotationHeight(nextFileAnnotationHeight)) hasHeightChange = true;
		} else if (!hasFileAnnotations && this.setFileAnnotationHeight(0)) hasHeightChange = true;
		for (const codeGroup of codeGroups) {
			if (codeGroup == null) continue;
			const content = codeGroup.children[1];
			if (!(content instanceof HTMLElement)) continue;
			for (const line of content.children) {
				if (!(line instanceof HTMLElement)) continue;
				const lineIndexAttr = line.dataset.lineIndex;
				if (lineIndexAttr == null) continue;
				const lineIndex = parseLineIndex(lineIndexAttr, diffStyle);
				let measuredHeight = line.getBoundingClientRect().height;
				let hasMetadata = false;
				if (line.nextElementSibling instanceof HTMLElement && ("lineAnnotation" in line.nextElementSibling.dataset || "noNewline" in line.nextElementSibling.dataset)) {
					if ("noNewline" in line.nextElementSibling.dataset) hasMetadata = true;
					measuredHeight += line.nextElementSibling.getBoundingClientRect().height;
				}
				const estimatedHeight = this.getEstimatedLineHeight(hasMetadata);
				const previousDelta = this.cache.heightDeltas.get(lineIndex) ?? 0;
				const nextDelta = measuredHeight - estimatedHeight;
				if (nextDelta === previousDelta) continue;
				hasHeightChange = true;
				this.cache.measuredHeightDeltaTotal += nextDelta - previousDelta;
				if (nextDelta === 0) this.cache.heightDeltas.delete(lineIndex);
				else this.cache.heightDeltas.set(lineIndex, nextDelta);
			}
		}
		if (hasHeightChange || this.isResizeDebuggingEnabled()) this.computeApproximateSize(true);
		return hasHeightChange;
	}
	onRender = (dirty) => {
		if (this.fileContainer == null) return false;
		if (dirty) this.top = this.getVirtualizedTop();
		return this.render();
	};
	prepareCodeViewItem(fileDiff, top, reset, lineAnnotations) {
		const targetChanged = !areDiffTargetsEqual(this.fileDiff, fileDiff);
		const annotationsChanged = this.syncLineAnnotations(lineAnnotations);
		let shouldResetLayoutCache = reset?.resetDiffLayoutCache === true || targetChanged || annotationsChanged;
		let includeEstimatedHeights = targetChanged || reset?.resetDiffLayoutCache === true && reset.includeEstimatedDiffHeights;
		if (reset?.metrics != null) {
			this.metrics = computeVirtualFileMetrics(reset.metrics);
			shouldResetLayoutCache = true;
			includeEstimatedHeights = true;
		}
		const { collapsed = false } = this.options;
		if (this.currentCollapsed !== collapsed) {
			this.currentCollapsed = collapsed;
			shouldResetLayoutCache = true;
		}
		if (shouldResetLayoutCache) this.resetLayoutCache({ includeEstimatedHeights });
		this.fileDiff = fileDiff;
		this.top = top;
		this.computeApproximateSize();
		return this.height;
	}
	getLinePosition(lineNumber, side = "additions") {
		if (this.fileDiff == null || lineNumber < 1) return;
		const targetLineIndexes = this.getLineIndex(lineNumber, side);
		if (targetLineIndexes == null) return;
		const { disableFileHeader = false, expandUnchanged = false, collapsed = false, collapsedContextThreshold = 1 } = this.options;
		const diffStyle = this.getDiffStyle();
		const hunkSeparators = this.getHunkSeparatorType();
		const targetLineIndex = diffStyle === "split" ? targetLineIndexes[1] : targetLineIndexes[0];
		this.approximateLayoutCheckpoints();
		const headerRegion = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		const checkpoint = this.getLayoutCheckpointBeforeLineIndex(targetLineIndex);
		let top = checkpoint?.top ?? headerRegion + this.cache.fileAnnotationHeight;
		if (collapsed) return {
			top: headerRegion,
			height: 0
		};
		let position;
		iterateOverDiff({
			diff: this.fileDiff,
			diffStyle,
			startingLine: checkpoint?.renderedLineIndex ?? 0,
			expandedHunks: expandUnchanged ? true : this.hunksRenderer.getExpandedHunksMap(),
			collapsedContextThreshold,
			callback: ({ hunkIndex, hunk, collapsedBefore, collapsedAfter, deletionLine, additionLine }) => {
				const lineIndex = diffStyle === "split" ? additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex : additionLine?.unifiedLineIndex ?? deletionLine?.unifiedLineIndex;
				if (lineIndex == null) throw new Error("VirtualizedFileDiff.getLinePosition: missing line index data");
				if (collapsedBefore > 0) {
					const separator = getLeadingHunkSeparatorLayout({
						type: hunkSeparators,
						metrics: this.metrics,
						hunkIndex,
						hunkSpecs: hunk?.hunkSpecs
					});
					if (separator != null) {
						top += separator.gapBefore;
						if (targetLineIndex >= lineIndex - collapsedBefore && targetLineIndex < lineIndex) {
							position = {
								top,
								height: separator.height
							};
							return true;
						}
						top += separator.height + separator.gapAfter;
					}
				}
				const lineHeight = this.getLineHeight(lineIndex, (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false));
				if (lineIndex === targetLineIndex) {
					position = {
						top,
						height: lineHeight
					};
					return true;
				}
				top += lineHeight;
				if (collapsedAfter > 0) {
					const separator = getTrailingHunkSeparatorLayout({
						type: hunkSeparators,
						metrics: this.metrics
					});
					if (separator != null) {
						if (targetLineIndex > lineIndex && targetLineIndex <= lineIndex + collapsedAfter) {
							position = {
								top: top + separator.gapBefore,
								height: separator.height
							};
							return true;
						}
						top += separator.totalHeight;
					}
				}
				return false;
			}
		});
		return position;
	}
	getNumericScrollAnchor(localViewportTop) {
		if (this.fileDiff == null) return;
		const { disableFileHeader = false, expandUnchanged = false, collapsed = false, collapsedContextThreshold = 1 } = this.options;
		if (collapsed) return;
		const diffStyle = this.getDiffStyle();
		const hunkSeparators = this.getHunkSeparatorType();
		this.approximateLayoutCheckpoints();
		const checkpoint = this.getLayoutCheckpointBeforeTop(localViewportTop);
		let top = checkpoint?.top ?? getVirtualFileHeaderRegion(this.metrics, disableFileHeader) + this.cache.fileAnnotationHeight;
		let anchor;
		iterateOverDiff({
			diff: this.fileDiff,
			diffStyle,
			startingLine: checkpoint?.renderedLineIndex ?? 0,
			expandedHunks: expandUnchanged ? true : this.hunksRenderer.getExpandedHunksMap(),
			collapsedContextThreshold,
			callback: ({ hunkIndex, hunk, collapsedBefore, collapsedAfter, deletionLine, additionLine }) => {
				const lineIndex = diffStyle === "split" ? additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex : additionLine?.unifiedLineIndex ?? deletionLine?.unifiedLineIndex;
				if (lineIndex == null) throw new Error("VirtualizedFileDiff.getNumericScrollAnchor: missing line index data");
				if (collapsedBefore > 0) {
					const separator = getLeadingHunkSeparatorLayout({
						type: hunkSeparators,
						metrics: this.metrics,
						hunkIndex,
						hunkSpecs: hunk?.hunkSpecs
					});
					if (separator != null) top += separator.totalHeight;
				}
				if (top >= localViewportTop) {
					if (deletionLine != null) anchor = {
						lineNumber: deletionLine.lineNumber,
						side: "deletions",
						top
					};
					else if (additionLine != null) anchor = {
						lineNumber: additionLine.lineNumber,
						side: "additions",
						top
					};
					if (anchor != null) return true;
				}
				const lineHeight = this.getLineHeight(lineIndex, (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false));
				top += lineHeight;
				if (collapsedAfter > 0) {
					const separator = getTrailingHunkSeparatorLayout({
						type: hunkSeparators,
						metrics: this.metrics
					});
					if (separator != null) top += separator.totalHeight;
				}
				return false;
			}
		});
		return anchor;
	}
	getVirtualizedHeight() {
		return this.height;
	}
	getAdvancedStickySpecs(windowSpecs) {
		if (this.top == null || this.fileDiff == null) return;
		if (this.options.collapsed === true) return {
			topOffset: this.top,
			height: this.height
		};
		const renderRange = windowSpecs != null ? this.computeRenderRangeFromWindow(this.fileDiff, this.top, windowSpecs) : this.renderRange;
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
		if (!recycle) this.resetLayoutCache({ includeEstimatedHeights: true });
		this.isSetup = false;
		super.cleanUp(recycle);
	}
	expandHunk = (hunkIndex, direction, expansionLineCountOverride) => {
		this.hunksRenderer.expandHunk(hunkIndex, direction, expansionLineCountOverride);
		this.forceRenderOverride = true;
		this.resetLayoutCache({ includeEstimatedHeights: true });
		if (this.isSimpleMode()) this.computeApproximateSize();
		this.virtualizer.instanceChanged(this, true);
	};
	setVisibility(visible) {
		if (this.isAdvancedMode() || this.fileContainer == null) return;
		this.renderRange = void 0;
		if (visible && !this.isVisible) {
			this.top = this.getVirtualizedTop();
			this.isVisible = true;
		} else if (!visible && this.isVisible) {
			this.isVisible = false;
			this.rerender();
		}
	}
	rerender() {
		if (!this.enabled || this.fileDiff == null && this.additionFile == null && this.deletionFile == null) return;
		this.forceRenderOverride = true;
		this.virtualizer.instanceChanged(this, false);
	}
	computeApproximateSize(force = false) {
		const shouldValidateSize = this.isResizeDebuggingEnabled();
		if (!force && !this.layoutDirty && !shouldValidateSize) return;
		const isFirstCompute = this.height === 0;
		this.height = 0;
		this.cache.checkpoints = [];
		this.cache.totalLines = 0;
		if (this.fileDiff == null) {
			this.layoutDirty = false;
			return;
		}
		const { disableFileHeader = false, collapsed = false } = this.options;
		const headerRegion = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		this.height += headerRegion;
		if (collapsed) {
			this.layoutDirty = false;
			return;
		}
		this.height = this.getActiveEstimatedHeight() + this.cache.measuredHeightDeltaTotal;
		if (shouldValidateSize && !isFirstCompute) this.validateComputedHeight();
		this.layoutDirty = false;
	}
	getActiveEstimatedHeight() {
		this.ensureEstimatedDiffHeights();
		const estimatedHeight = this.getDiffStyle() === "split" ? this.cache.estimatedSplitHeight : this.cache.estimatedUnifiedHeight;
		if (estimatedHeight == null) throw new Error("VirtualizedFileDiff.getActiveEstimatedHeight: missing estimated height");
		return estimatedHeight;
	}
	ensureEstimatedDiffHeights() {
		if (this.fileDiff == null) {
			this.cache.estimatedSplitHeight = void 0;
			this.cache.estimatedUnifiedHeight = void 0;
			return;
		}
		if (this.cache.estimatedSplitHeight != null && this.cache.estimatedUnifiedHeight != null) return;
		const { disableFileHeader = false, expandUnchanged = false, collapsedContextThreshold = 1 } = this.options;
		const { splitHeight, unifiedHeight } = computeEstimatedDiffHeights({
			fileDiff: this.fileDiff,
			metrics: this.metrics,
			disableFileHeader,
			hunkSeparators: this.getHunkSeparatorType(),
			expandUnchanged,
			expandedHunks: this.hunksRenderer.getExpandedHunksMap(),
			collapsedContextThreshold
		});
		this.cache.estimatedSplitHeight = splitHeight;
		this.cache.estimatedUnifiedHeight = unifiedHeight;
	}
	validateComputedHeight() {
		if (this.fileContainer == null || this.fileDiff == null) return;
		const rect = this.fileContainer.getBoundingClientRect();
		if (rect.height !== this.height) console.log("VirtualizedFileDiff.computeApproximateSize: computed height doesnt match", {
			name: this.fileDiff.name,
			elementHeight: rect.height,
			computedHeight: this.height
		});
		else console.log("VirtualizedFileDiff.computeApproximateSize: computed height IS CORRECT");
	}
	render({ fileContainer, oldFile, newFile, fileDiff, forceRender = false, lineAnnotations, ...props } = {}) {
		const { forceRenderOverride, isSetup } = this;
		this.forceRenderOverride = void 0;
		const annotationsChanged = this.syncLineAnnotations(lineAnnotations);
		if (annotationsChanged) this.resetLayoutCache({ includeEstimatedHeights: false });
		this.fileDiff ??= fileDiff ?? (oldFile != null && newFile != null ? parseDiffFromFile(oldFile, newFile, this.options.parseDiffOptions) : void 0);
		fileContainer = this.getOrCreateFileContainer(fileContainer);
		if (this.fileDiff == null) {
			console.error("VirtualizedFileDiff.render: attempting to virtually render when we dont have the correct data");
			return false;
		}
		if (!isSetup) {
			this.computeApproximateSize();
			const virtualizer = this.getSimpleVirtualizer();
			this.top ??= this.getVirtualizedTop();
			if (this.isAdvancedMode()) this.isVisible = true;
			else {
				if (virtualizer == null) throw new Error("VirtualizedFileDiff.render: simple virtualizer is not available");
				virtualizer.connect(fileContainer, this);
				this.isVisible = virtualizer.isInstanceVisible(this.top ?? 0, this.height);
			}
			this.isSetup = true;
		} else this.top ??= this.getVirtualizedTop();
		if (!this.isVisible && this.isSimpleMode()) return this.renderPlaceholder(this.height);
		const windowSpecs = this.virtualizer.getWindowSpecs();
		const fileTop = this.top ?? 0;
		const renderRange = this.computeRenderRangeFromWindow(this.fileDiff, fileTop, windowSpecs);
		return super.render({
			fileDiff: this.fileDiff,
			fileContainer,
			renderRange,
			oldFile,
			newFile,
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
	getDiffStyle() {
		return this.options.diffStyle ?? "split";
	}
	getHunkSeparatorType() {
		return getOptionHunkSeparatorType(this.options.hunkSeparators);
	}
	approximateLayoutCheckpoints() {
		if (this.cache.checkpoints.length > 0 || this.fileDiff == null || this.fileDiff.hunks.length === 0 || this.options.collapsed === true) return;
		const { disableFileHeader = false, expandUnchanged = false, collapsedContextThreshold = 1 } = this.options;
		const finalHunkIndex = this.fileDiff.hunks.length - 1;
		const diffStyle = this.getDiffStyle();
		const hunkSeparators = this.getHunkSeparatorType();
		const expandedHunks = expandUnchanged ? true : this.hunksRenderer.getExpandedHunksMap();
		const heightDeltaPrefix = createHeightDeltaPrefix(this.cache.heightDeltas);
		let top = getVirtualFileHeaderRegion(this.metrics, disableFileHeader) + this.cache.fileAnnotationHeight;
		let renderedLineIndex = 0;
		const processRows = ({ rowCount, startLineIndex, preSeparatorHeight = 0, postSeparatorHeight = 0, metadataOffsets = [] }) => {
			if (rowCount <= 0) return;
			const blockStart = renderedLineIndex;
			const blockEnd = renderedLineIndex + rowCount;
			let nextCheckpoint = getNextCheckpointIndex(blockStart);
			while (nextCheckpoint < blockEnd) {
				const offset = nextCheckpoint - blockStart;
				const checkpointTop = top + (offset > 0 ? preSeparatorHeight : 0) + offset * this.metrics.lineHeight + countMetadataOffsetsBefore(metadataOffsets, offset) * this.metrics.lineHeight + sumHeightDeltas(heightDeltaPrefix, startLineIndex, startLineIndex + offset);
				this.cache.checkpoints.push({
					renderedLineIndex: nextCheckpoint,
					lineIndex: startLineIndex + offset,
					top: checkpointTop
				});
				nextCheckpoint += LAYOUT_CHECKPOINT_INTERVAL;
			}
			top += preSeparatorHeight + rowCount * this.metrics.lineHeight + metadataOffsets.length * this.metrics.lineHeight + sumHeightDeltas(heightDeltaPrefix, startLineIndex, startLineIndex + rowCount) + postSeparatorHeight;
			renderedLineIndex = blockEnd;
		};
		for (let hunkIndex = 0; hunkIndex < this.fileDiff.hunks.length; hunkIndex++) {
			const hunk = this.fileDiff.hunks[hunkIndex];
			if (hunk == null) throw new Error("VirtualizedFileDiff.approximateLayoutCheckpoints: invalid hunk index");
			const leadingRegion = getExpandedRegion({
				isPartial: this.fileDiff.isPartial,
				rangeSize: hunk.collapsedBefore,
				expandedHunks,
				hunkIndex,
				collapsedContextThreshold
			});
			const leadingSeparatorHeight = leadingRegion.collapsedLines > 0 ? getLeadingHunkSeparatorLayout({
				type: hunkSeparators,
				metrics: this.metrics,
				hunkIndex,
				hunkSpecs: hunk.hunkSpecs
			})?.totalHeight ?? 0 : 0;
			processRows({
				rowCount: leadingRegion.fromStart,
				startLineIndex: (diffStyle === "split" ? hunk.splitLineStart : hunk.unifiedLineStart) - leadingRegion.rangeSize
			});
			let pendingLeadingSeparatorHeight = leadingSeparatorHeight;
			processRows({
				rowCount: leadingRegion.fromEnd,
				startLineIndex: (diffStyle === "split" ? hunk.splitLineStart : hunk.unifiedLineStart) - leadingRegion.fromEnd,
				preSeparatorHeight: pendingLeadingSeparatorHeight
			});
			if (leadingRegion.fromEnd > 0) pendingLeadingSeparatorHeight = 0;
			const trailingRegion = hunkIndex === finalHunkIndex ? getTrailingExpandedRegion({
				fileDiff: this.fileDiff,
				hunkIndex,
				expandedHunks,
				collapsedContextThreshold,
				errorPrefix: "VirtualizedFileDiff"
			}) : void 0;
			const trailingSeparatorHeight = trailingRegion != null && trailingRegion.collapsedLines > 0 ? getTrailingHunkSeparatorLayout({
				type: hunkSeparators,
				metrics: this.metrics
			})?.totalHeight ?? 0 : 0;
			const trailingExpandedCount = trailingRegion != null ? trailingRegion.fromStart + trailingRegion.fromEnd : 0;
			const hunkBodyRowCount = diffStyle === "split" ? hunk.splitLineCount : hunk.unifiedLineCount;
			const hunkBodyStartLineIndex = diffStyle === "split" ? hunk.splitLineStart : hunk.unifiedLineStart;
			processRows({
				rowCount: hunkBodyRowCount,
				startLineIndex: hunkBodyStartLineIndex,
				preSeparatorHeight: pendingLeadingSeparatorHeight,
				postSeparatorHeight: trailingExpandedCount === 0 ? trailingSeparatorHeight : 0,
				metadataOffsets: getHunkMetadataOffsets({
					diffStyle,
					hunk,
					rowCount: hunkBodyRowCount
				})
			});
			if (trailingRegion != null && trailingExpandedCount > 0) processRows({
				rowCount: trailingExpandedCount,
				startLineIndex: hunkBodyStartLineIndex + hunkBodyRowCount,
				postSeparatorHeight: trailingSeparatorHeight
			});
		}
		this.cache.totalLines = renderedLineIndex;
	}
	getLayoutCheckpointBeforeLineIndex(lineIndex) {
		if (lineIndex <= 0 || this.cache.checkpoints.length === 0) return;
		let low = 0;
		let high = this.cache.checkpoints.length - 1;
		let result;
		while (low <= high) {
			const mid = low + high >> 1;
			const checkpoint = this.cache.checkpoints[mid];
			if (checkpoint == null) throw new Error("VirtualizedFileDiff: invalid checkpoint index");
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
			if (checkpoint == null) throw new Error("VirtualizedFileDiff: invalid checkpoint index");
			if (checkpoint.top <= top) {
				resultIndex = mid;
				low = mid + 1;
			} else high = mid - 1;
		}
		if (hunkLineCount == null) return resultIndex >= 0 ? this.cache.checkpoints[resultIndex] : void 0;
		for (let index = resultIndex; index >= 0; index--) {
			const checkpoint = this.cache.checkpoints[index];
			if (checkpoint == null) throw new Error("VirtualizedFileDiff: invalid checkpoint index");
			if (checkpoint.renderedLineIndex % hunkLineCount === 0) return checkpoint;
		}
	}
	getExpandedLineCount(fileDiff, diffStyle) {
		let count = 0;
		if (fileDiff.isPartial) {
			for (const hunk of fileDiff.hunks) count += diffStyle === "split" ? hunk.splitLineCount : hunk.unifiedLineCount;
			return count;
		}
		const { expandUnchanged = false, collapsedContextThreshold = 1 } = this.options;
		const expandedHunks = expandUnchanged ? true : this.hunksRenderer.getExpandedHunksMap();
		for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
			const hunkCount = diffStyle === "split" ? hunk.splitLineCount : hunk.unifiedLineCount;
			count += hunkCount;
			const collapsedBefore = Math.max(hunk.collapsedBefore, 0);
			const { fromStart, fromEnd, renderAll } = getExpandedRegion({
				isPartial: fileDiff.isPartial,
				rangeSize: collapsedBefore,
				expandedHunks,
				hunkIndex,
				collapsedContextThreshold
			});
			if (collapsedBefore > 0) count += renderAll ? collapsedBefore : fromStart + fromEnd;
		}
		const trailingRegion = getTrailingExpandedRegion({
			fileDiff,
			hunkIndex: fileDiff.hunks.length - 1,
			expandedHunks,
			collapsedContextThreshold,
			errorPrefix: "VirtualizedFileDiff"
		});
		if (trailingRegion != null) count += trailingRegion.fromStart + trailingRegion.fromEnd;
		return count;
	}
	computeRenderRangeFromWindow(fileDiff, fileTop, { top, bottom }) {
		const { disableFileHeader = false, expandUnchanged = false, collapsedContextThreshold = 1 } = this.options;
		const { hunkLineCount, lineHeight } = this.metrics;
		const diffStyle = this.getDiffStyle();
		const hunkSeparators = this.getHunkSeparatorType();
		const fileHeight = this.height;
		let lineCount = this.cache.totalLines > 0 ? this.cache.totalLines : this.getExpandedLineCount(fileDiff, diffStyle);
		const headerRegion = getVirtualFileHeaderRegion(this.metrics, disableFileHeader);
		const paddingBottom = fileDiff.hunks.length > 0 ? getVirtualFilePaddingBottom(this.metrics) : 0;
		const { fileAnnotationHeight } = this.cache;
		const codeRegionTop = headerRegion + fileAnnotationHeight;
		const codeHeight = Math.max(0, fileHeight - headerRegion - fileAnnotationHeight - paddingBottom);
		const hasFileAnnotations = this.hasFileAnnotations(fileDiff);
		const fileAnnotationTop = fileTop + headerRegion;
		const measuredFileAnnotationVisible = fileAnnotationHeight > 0 && hasFileAnnotations && fileAnnotationTop < bottom && fileAnnotationTop + fileAnnotationHeight > top;
		if (fileTop < top - fileHeight || fileTop > bottom) return {
			startingLine: 0,
			totalLines: 0,
			bufferBefore: 0,
			bufferAfter: fileHeight - headerRegion - paddingBottom
		};
		if (lineCount <= hunkLineCount || fileDiff.hunks.length === 0) return {
			startingLine: 0,
			totalLines: hunkLineCount,
			bufferBefore: 0,
			bufferAfter: 0
		};
		this.approximateLayoutCheckpoints();
		lineCount = this.cache.totalLines > 0 ? this.cache.totalLines : lineCount;
		const estimatedTargetLines = Math.ceil(Math.max(bottom - top, 0) / lineHeight);
		const totalLines = Math.ceil(estimatedTargetLines / hunkLineCount) * hunkLineCount + hunkLineCount;
		const totalHunks = totalLines / hunkLineCount;
		const overflowHunks = totalHunks;
		const hunkOffsets = [];
		const viewportCenter = (top + bottom) / 2;
		const checkpoint = this.getLayoutCheckpointBeforeTop(Math.max(0, top - fileTop - totalLines * lineHeight * 2), hunkLineCount);
		let absoluteLineTop = fileTop + (checkpoint?.top ?? codeRegionTop);
		let currentLine = checkpoint?.renderedLineIndex ?? 0;
		let firstVisibleHunk;
		let centerHunk;
		let overflowCounter;
		iterateOverDiff({
			diff: fileDiff,
			diffStyle,
			startingLine: checkpoint?.renderedLineIndex ?? 0,
			expandedHunks: expandUnchanged ? true : this.hunksRenderer.getExpandedHunksMap(),
			collapsedContextThreshold,
			callback: ({ hunkIndex, hunk, collapsedBefore, collapsedAfter, deletionLine, additionLine }) => {
				const splitLineIndex = additionLine != null ? additionLine.splitLineIndex : deletionLine.splitLineIndex;
				const unifiedLineIndex = additionLine != null ? additionLine.unifiedLineIndex : deletionLine.unifiedLineIndex;
				const hasMetadata = (additionLine?.noEOFCR ?? false) || (deletionLine?.noEOFCR ?? false);
				const gapAdjustment = (collapsedBefore > 0 ? getLeadingHunkSeparatorLayout({
					type: hunkSeparators,
					metrics: this.metrics,
					hunkIndex,
					hunkSpecs: hunk?.hunkSpecs
				}) : void 0)?.totalHeight ?? 0;
				absoluteLineTop += gapAdjustment;
				const isAtHunkBoundary = currentLine % hunkLineCount === 0;
				const currentHunk = Math.floor(currentLine / hunkLineCount);
				if (isAtHunkBoundary) {
					hunkOffsets[currentHunk] = absoluteLineTop - (fileTop + codeRegionTop + gapAdjustment);
					if (overflowCounter != null) {
						if (overflowCounter <= 0) return true;
						overflowCounter--;
					}
				}
				const lineHeight = this.getLineHeight(diffStyle === "split" ? splitLineIndex : unifiedLineIndex, hasMetadata);
				if (absoluteLineTop > top - lineHeight && absoluteLineTop < bottom) firstVisibleHunk ??= currentHunk;
				if (centerHunk == null && absoluteLineTop + lineHeight > viewportCenter) centerHunk = currentHunk;
				if (overflowCounter == null && absoluteLineTop >= bottom && isAtHunkBoundary) overflowCounter = overflowHunks;
				currentLine++;
				absoluteLineTop += lineHeight;
				if (collapsedAfter > 0) absoluteLineTop += getTrailingHunkSeparatorLayout({
					type: hunkSeparators,
					metrics: this.metrics
				})?.totalHeight ?? 0;
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
		const bufferAfter = finalHunkIndex < hunkOffsets.length ? codeHeight - hunkOffsets[finalHunkIndex] : codeHeight - (absoluteLineTop - fileTop - codeRegionTop);
		return {
			startingLine,
			totalLines: clampedTotalLines,
			bufferBefore,
			bufferAfter: Math.max(0, bufferAfter)
		};
	}
};
function measureFileAnnotationHeight(codeGroups) {
	let height;
	for (const codeGroup of codeGroups) {
		if (codeGroup == null) continue;
		const content = codeGroup.children[1];
		if (!(content instanceof HTMLElement)) continue;
		for (const child of content.children) {
			if (!(child instanceof HTMLElement)) continue;
			if (child.dataset.lineAnnotation !== FILE_ANNOTATION_DOM_KEY) continue;
			height = Math.max(height ?? 0, child.getBoundingClientRect().height);
		}
	}
	return height;
}
function createHeightDeltaPrefix(heightDeltas) {
	const entries = Array.from(heightDeltas).sort((a, b) => a[0] - b[0]);
	const lineIndexes = [];
	const prefixTotals = [0];
	let total = 0;
	for (const [lineIndex, delta] of entries) {
		lineIndexes.push(lineIndex);
		total += delta;
		prefixTotals.push(total);
	}
	return {
		lineIndexes,
		prefixTotals
	};
}
function sumHeightDeltas({ lineIndexes, prefixTotals }, startLineIndex, endLineIndex) {
	if (startLineIndex >= endLineIndex || lineIndexes.length === 0) return 0;
	const start = lowerBound(lineIndexes, startLineIndex);
	return (prefixTotals[lowerBound(lineIndexes, endLineIndex)] ?? 0) - (prefixTotals[start] ?? 0);
}
function lowerBound(values, target) {
	let low = 0;
	let high = values.length;
	while (low < high) {
		const mid = low + high >> 1;
		const value = values[mid];
		if (value == null) throw new Error("VirtualizedFileDiff: invalid prefix index");
		if (value < target) low = mid + 1;
		else high = mid;
	}
	return low;
}
function getNextCheckpointIndex(renderedLineIndex) {
	return Math.ceil(renderedLineIndex / LAYOUT_CHECKPOINT_INTERVAL) * LAYOUT_CHECKPOINT_INTERVAL;
}
function countMetadataOffsetsBefore(metadataOffsets, offset) {
	let count = 0;
	for (const metadataOffset of metadataOffsets) if (metadataOffset < offset) count++;
	return count;
}
function getHunkMetadataOffsets({ diffStyle, hunk, rowCount }) {
	if (rowCount <= 0 || !hunk.noEOFCRAdditions && !hunk.noEOFCRDeletions) return [];
	const lastContent = hunk.hunkContent.at(-1);
	if (lastContent == null) return [];
	if (lastContent.type === "context") return [rowCount - 1];
	const splitCount = Math.max(lastContent.deletions, lastContent.additions);
	const unifiedCount = lastContent.deletions + lastContent.additions;
	if (diffStyle === "split") return splitCount > 0 && (hunk.noEOFCRAdditions || hunk.noEOFCRDeletions) ? [rowCount - 1] : [];
	const offsets = [];
	const contentStartOffset = rowCount - unifiedCount;
	if (lastContent.deletions > 0 && hunk.noEOFCRDeletions) offsets.push(contentStartOffset + lastContent.deletions - 1);
	if (lastContent.additions > 0 && hunk.noEOFCRAdditions) offsets.push(rowCount - 1);
	return offsets;
}
function hasDiffLayoutOptionChanged(previousOptions, nextOptions) {
	return (previousOptions.diffStyle ?? "split") !== (nextOptions.diffStyle ?? "split") || (previousOptions.overflow ?? "scroll") !== (nextOptions.overflow ?? "scroll") || (previousOptions.collapsed ?? false) !== (nextOptions.collapsed ?? false) || (previousOptions.disableLineNumbers ?? false) !== (nextOptions.disableLineNumbers ?? false) || (previousOptions.disableFileHeader ?? false) !== (nextOptions.disableFileHeader ?? false) || (previousOptions.diffIndicators ?? "bars") !== (nextOptions.diffIndicators ?? "bars") || (previousOptions.hunkSeparators ?? "line-info") !== (nextOptions.hunkSeparators ?? "line-info") || (previousOptions.expandUnchanged ?? false) !== (nextOptions.expandUnchanged ?? false) || (previousOptions.collapsedContextThreshold ?? 1) !== (nextOptions.collapsedContextThreshold ?? 1) || previousOptions.unsafeCSS !== nextOptions.unsafeCSS;
}
function hasDiffEstimateOptionChanged(previousOptions, nextOptions) {
	return (previousOptions.disableFileHeader ?? false) !== (nextOptions.disableFileHeader ?? false) || (previousOptions.hunkSeparators ?? "line-info") !== (nextOptions.hunkSeparators ?? "line-info") || (previousOptions.expandUnchanged ?? false) !== (nextOptions.expandUnchanged ?? false) || (previousOptions.collapsedContextThreshold ?? 1) !== (nextOptions.collapsedContextThreshold ?? 1);
}
function getOptionHunkSeparatorType(hunkSeparators) {
	return typeof hunkSeparators === "function" ? "custom" : hunkSeparators ?? "line-info";
}
function parseLineIndex(lineIndexAttr, diffStyle) {
	const [unifiedIndex, splitIndex] = lineIndexAttr.split(",").map(Number);
	return diffStyle === "split" ? splitIndex : unifiedIndex;
}
//#endregion
export { VirtualizedFileDiff };

//# sourceMappingURL=VirtualizedFileDiff.js.map