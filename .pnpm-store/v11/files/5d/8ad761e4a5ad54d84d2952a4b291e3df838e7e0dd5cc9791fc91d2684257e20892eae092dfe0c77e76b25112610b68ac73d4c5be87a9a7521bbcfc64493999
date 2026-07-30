import { DEFAULT_EXPANDED_REGION, DEFAULT_RENDER_RANGE, DEFAULT_THEMES, DEFAULT_TOKENIZE_MAX_LENGTH } from "../constants.js";
import { getFileAnnotations, shouldRenderFileAnnotations } from "../utils/includesFileAnnotations.js";
import { createGutterGap, createGutterItem, createGutterWrapper, createHastElement } from "../utils/hast_utils.js";
import { areLanguagesAttached } from "../highlighter/languages/areLanguagesAttached.js";
import { getHighlighterIfLoaded, getSharedHighlighter } from "../highlighter/shared_highlighter.js";
import { areThemesAttached } from "../highlighter/themes/areThemesAttached.js";
import { areRenderRangesEqual } from "../utils/areRenderRangesEqual.js";
import { createAnnotationElement } from "../utils/createAnnotationElement.js";
import { createContentColumn } from "../utils/createContentColumn.js";
import { createFileHeaderElement } from "../utils/createFileHeaderElement.js";
import { createPreElement } from "../utils/createPreElement.js";
import { getFiletypeFromFileName } from "../utils/getFiletypeFromFileName.js";
import { getHighlighterOptions } from "../utils/getHighlighterOptions.js";
import { getLineAnnotationName } from "../utils/getLineAnnotationName.js";
import { shouldUseTokenTransformer } from "../utils/shouldUseTokenTransformer.js";
import { areDiffTargetsEqual } from "../utils/areDiffTargetsEqual.js";
import { getTrailingContextRangeSize } from "../utils/virtualDiffLayout.js";
import { iterateOverDiff } from "../utils/iterateOverDiff.js";
import { areDiffRenderOptionsEqual } from "../utils/areDiffRenderOptionsEqual.js";
import { createEmptyRowBuffer } from "../utils/createEmptyRowBuffer.js";
import { createNoNewlineElement } from "../utils/createNoNewlineElement.js";
import { createSeparator } from "../utils/createSeparator.js";
import { getHunkSeparatorSlotName } from "../utils/getHunkSeparatorSlotName.js";
import { getTotalLineCountFromHunks } from "../utils/getTotalLineCountFromHunks.js";
import { isDefaultRenderRange } from "../utils/isDefaultRenderRange.js";
import { isDiffPlainText } from "../utils/isDiffPlainText.js";
import { renderDiffWithHighlighter } from "../utils/renderDiffWithHighlighter.js";
import { toHtml } from "hast-util-to-html";
//#region src/renderers/DiffHunksRenderer.ts
let instanceId = -1;
var DiffHunksRenderer = class {
	options;
	onRenderUpdate;
	workerManager;
	__id = `diff-hunks-renderer:${++instanceId}`;
	highlighter;
	diff;
	expandedHunks = /* @__PURE__ */ new Map();
	deletionAnnotations = {};
	additionAnnotations = {};
	computedLang = "text";
	renderCache;
	constructor(options = { theme: DEFAULT_THEMES }, onRenderUpdate, workerManager) {
		this.options = options;
		this.onRenderUpdate = onRenderUpdate;
		this.workerManager = workerManager;
		if (workerManager?.isWorkingPool() !== true) this.highlighter = areThemesAttached(options.theme ?? DEFAULT_THEMES) ? getHighlighterIfLoaded() : void 0;
	}
	cleanUp() {
		this.recycle();
		this.expandedHunks.clear();
		this.workerManager = void 0;
		this.onRenderUpdate = void 0;
	}
	recycle() {
		this.highlighter = void 0;
		this.diff = void 0;
		this.clearRenderCache();
		this.additionAnnotations = {};
		this.deletionAnnotations = {};
		this.workerManager?.cleanUpTasks(this);
	}
	clearRenderCache() {
		this.renderCache = void 0;
	}
	setOptions(options) {
		this.options = options;
	}
	mergeOptions(options) {
		this.options = {
			...this.options,
			...options
		};
	}
	expandHunk(index, direction, expansionLineCount = this.getOptionsWithDefaults().expansionLineCount) {
		const region = { ...this.expandedHunks.get(index) ?? {
			fromStart: 0,
			fromEnd: 0
		} };
		if (direction === "up" || direction === "both") region.fromStart += expansionLineCount;
		if (direction === "down" || direction === "both") region.fromEnd += expansionLineCount;
		if (this.renderCache?.highlighted !== true) this.clearRenderCache();
		this.expandedHunks.set(index, region);
	}
	getExpandedHunk(hunkIndex) {
		return this.expandedHunks.get(hunkIndex) ?? DEFAULT_EXPANDED_REGION;
	}
	getExpandedHunksMap() {
		return this.expandedHunks;
	}
	setLineAnnotations(lineAnnotations) {
		this.additionAnnotations = {};
		this.deletionAnnotations = {};
		for (const annotation of lineAnnotations) {
			const map = (() => {
				switch (annotation.side) {
					case "deletions": return this.deletionAnnotations;
					case "additions": return this.additionAnnotations;
				}
			})();
			const arr = map[annotation.lineNumber] ?? [];
			map[annotation.lineNumber] = arr;
			arr.push(annotation);
		}
	}
	getUnifiedLineDecoration({ lineType }) {
		return { gutterLineType: lineType };
	}
	getSplitLineDecoration({ side, type }) {
		if (type !== "change") return { gutterLineType: type };
		return { gutterLineType: side === "deletions" ? "change-deletion" : "change-addition" };
	}
	createAnnotationElement = (span) => {
		return createAnnotationElement(span);
	};
	getOptionsWithDefaults() {
		const { diffIndicators = "bars", diffStyle = "split", disableBackground = false, disableFileHeader = false, disableLineNumbers = false, disableVirtualizationBuffers = false, collapsed = false, expandUnchanged = false, collapsedContextThreshold = 1, expansionLineCount = 100, hunkSeparators = "line-info", lineDiffType = "word-alt", maxLineDiffLength = 1e3, overflow = "scroll", stickyHeader = false, theme = DEFAULT_THEMES, headerRenderMode = "default", tokenizeMaxLineLength = 1e3, tokenizeMaxLength = DEFAULT_TOKENIZE_MAX_LENGTH, useTokenTransformer = false, useCSSClasses = false } = this.options;
		return {
			diffIndicators,
			diffStyle,
			disableBackground,
			disableFileHeader,
			disableLineNumbers,
			disableVirtualizationBuffers,
			collapsed,
			expandUnchanged,
			collapsedContextThreshold,
			expansionLineCount,
			hunkSeparators,
			lineDiffType,
			maxLineDiffLength,
			overflow,
			stickyHeader,
			theme: this.workerManager?.getDiffRenderOptions().theme ?? theme,
			headerRenderMode,
			tokenizeMaxLineLength,
			tokenizeMaxLength,
			useTokenTransformer,
			useCSSClasses
		};
	}
	async initializeHighlighter() {
		this.highlighter = await getSharedHighlighter(getHighlighterOptions(this.computedLang, this.options));
		return this.highlighter;
	}
	hydrate(diff) {
		if (diff == null) return;
		this.diff = diff;
		const { options } = this.getRenderOptions(diff);
		const massiveDiff = isDiffMassive(diff, this.getTokenizeMaxLength());
		let cache = this.workerManager?.getDiffResultCache(diff);
		if (cache != null && !areDiffRenderOptionsEqual(options, cache.options)) cache = void 0;
		this.renderCache ??= {
			diff,
			highlighted: !massiveDiff && !isDiffPlainText(diff),
			options,
			result: massiveDiff ? void 0 : cache?.result,
			renderRange: void 0
		};
		if (this.workerManager?.isWorkingPool() === true) {
			if (this.renderCache.result == null && !massiveDiff) this.workerManager.highlightDiffAST(this, this.diff);
		} else if (this.highlighter == null) {
			this.computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
			this.initializeHighlighter();
		}
	}
	getRenderOptions(diff) {
		const options = (() => {
			if (this.workerManager?.isWorkingPool() === true) return this.workerManager.getDiffRenderOptions();
			const { theme, tokenizeMaxLineLength, lineDiffType, maxLineDiffLength } = this.getOptionsWithDefaults();
			return {
				theme,
				useTokenTransformer: shouldUseTokenTransformer(this.options),
				tokenizeMaxLineLength,
				lineDiffType,
				maxLineDiffLength
			};
		})();
		this.getOptionsWithDefaults();
		const { renderCache } = this;
		if (renderCache?.result == null) return {
			options,
			forceHighlight: true
		};
		if (!areDiffTargetsEqual(diff, renderCache.diff) || !areDiffRenderOptionsEqual(options, renderCache.options)) return {
			options,
			forceHighlight: true
		};
		return {
			options,
			forceHighlight: false
		};
	}
	renderDiff(diff = this.renderCache?.diff, renderRange = DEFAULT_RENDER_RANGE) {
		if (diff == null) return;
		const { expandUnchanged = false, collapsedContextThreshold } = this.getOptionsWithDefaults();
		let { options, forceHighlight } = this.getRenderOptions(diff);
		const cache = this.getMatchingWorkerResultCache(diff, options);
		if (cache != null && !this.hasHighlightedRenderCache(diff, options)) {
			this.renderCache = {
				diff,
				highlighted: true,
				renderRange: void 0,
				...cache
			};
			forceHighlight = false;
		}
		this.renderCache ??= {
			diff,
			highlighted: false,
			options,
			result: void 0,
			renderRange: void 0
		};
		const hasContent = diff.additionLines.length > 0 || diff.deletionLines.length > 0;
		const forcePlainText = !hasContent || isDiffPlainText(diff) || isDiffMassive(diff, this.getTokenizeMaxLength());
		const newContent = !areDiffTargetsEqual(diff, this.renderCache.diff);
		const newRenderRange = !areRenderRangesEqual(this.renderCache.renderRange, renderRange);
		if (this.workerManager?.isWorkingPool() === true) {
			if (forcePlainText || this.renderCache.result == null || !this.renderCache.highlighted && (newContent || newRenderRange)) {
				this.renderCache.diff = diff;
				this.renderCache.options = options;
				this.renderCache.highlighted = false;
				if (this.renderCache.result == null || newContent || newRenderRange || forceHighlight) this.renderCache.result = this.workerManager.getPlainDiffAST(diff, renderRange.startingLine, renderRange.totalLines, isDefaultRenderRange(renderRange) ? true : expandUnchanged ? true : this.expandedHunks, collapsedContextThreshold);
				this.renderCache.renderRange = renderRange;
			}
			if (!forcePlainText && hasContent && (!this.renderCache.highlighted || forceHighlight)) this.workerManager.highlightDiffAST(this, diff);
		} else {
			this.computedLang = diff.lang ?? getFiletypeFromFileName(diff.name);
			const hasThemes = this.highlighter != null && areThemesAttached(options.theme);
			const hasLangs = this.highlighter != null && areLanguagesAttached(this.computedLang);
			const canHighlight = !forcePlainText && hasLangs;
			if (this.highlighter != null && hasThemes && (forceHighlight || forcePlainText || !this.renderCache.highlighted && canHighlight || this.renderCache.result == null)) {
				const { result, options } = this.renderDiffWithHighlighter(diff, this.highlighter, forcePlainText || !hasLangs);
				this.renderCache = {
					diff,
					options,
					highlighted: canHighlight,
					result,
					renderRange: void 0
				};
			}
			if (!hasThemes || !forcePlainText && !hasLangs) this.asyncHighlight(diff).then(({ result, options }) => {
				if (this.renderCache != null) this.renderCache.highlighted = false;
				this.onHighlightSuccess(diff, result, options, !forcePlainText);
			});
		}
		return this.renderCache.result != null ? this.processDiffResult(this.renderCache.diff, renderRange, this.renderCache.result) : void 0;
	}
	async asyncRender(diff, renderRange = DEFAULT_RENDER_RANGE) {
		const { result } = await this.asyncHighlight(diff);
		return this.processDiffResult(diff, renderRange, result);
	}
	createPreElement(split, totalLines, customProperties) {
		const { diffIndicators, disableBackground, disableLineNumbers, overflow } = this.getOptionsWithDefaults();
		return createPreElement({
			type: "diff",
			diffIndicators,
			disableBackground,
			disableLineNumbers,
			overflow,
			split,
			totalLines,
			customProperties
		});
	}
	async asyncHighlight(diff) {
		const forcePlainText = isDiffMassive(diff, this.getTokenizeMaxLength());
		this.computedLang = forcePlainText ? "text" : diff.lang ?? getFiletypeFromFileName(diff.name);
		const hasThemes = this.highlighter != null && areThemesAttached(this.options.theme ?? DEFAULT_THEMES);
		const hasLangs = forcePlainText || this.highlighter != null && areLanguagesAttached(this.computedLang);
		if (this.highlighter == null || !hasThemes || !hasLangs) this.highlighter = await this.initializeHighlighter();
		return this.renderDiffWithHighlighter(diff, this.highlighter, forcePlainText);
	}
	renderDiffWithHighlighter(diff, highlighter, forcePlainText = false) {
		const { options } = this.getRenderOptions(diff);
		const { collapsedContextThreshold } = this.getOptionsWithDefaults();
		return {
			result: renderDiffWithHighlighter(diff, highlighter, options, {
				forcePlainText,
				expandedHunks: forcePlainText ? true : void 0,
				collapsedContextThreshold
			}),
			options
		};
	}
	onHighlightSuccess(diff, result, options, highlighted = true) {
		if (this.renderCache == null) return;
		const triggerRenderUpdate = !this.renderCache.highlighted || !areDiffRenderOptionsEqual(this.renderCache.options, options) || !areDiffTargetsEqual(this.renderCache.diff, diff);
		this.renderCache = {
			diff,
			options,
			highlighted,
			result,
			renderRange: void 0
		};
		if (triggerRenderUpdate) this.onRenderUpdate?.();
	}
	getMatchingWorkerResultCache(diff, options) {
		const cache = this.workerManager?.getDiffResultCache(diff);
		if (cache == null || !areDiffRenderOptionsEqual(options, cache.options)) return;
		return cache;
	}
	hasHighlightedRenderCache(diff, options) {
		const { renderCache } = this;
		return renderCache?.result != null && renderCache.highlighted && areDiffTargetsEqual(diff, renderCache.diff) && areDiffRenderOptionsEqual(options, renderCache.options);
	}
	onHighlightError(error) {
		console.error(error);
	}
	getTokenizeMaxLength() {
		return this.options.tokenizeMaxLength ?? 1e5;
	}
	processDiffResult(fileDiff, renderRange, { code, themeStyles, baseThemeType }) {
		const { diffStyle, disableFileHeader, expandUnchanged, expansionLineCount, collapsedContextThreshold, hunkSeparators } = this.getOptionsWithDefaults();
		this.diff = fileDiff;
		const unified = diffStyle === "unified";
		let additionsContentAST = [];
		let deletionsContentAST = [];
		let unifiedContentAST = [];
		const hunkData = [];
		const { additionLines, deletionLines } = code;
		const context = {
			rowCount: 0,
			hunkSeparators,
			additionsContentAST,
			deletionsContentAST,
			unifiedContentAST,
			unifiedGutterAST: createGutterWrapper(),
			deletionsGutterAST: createGutterWrapper(),
			additionsGutterAST: createGutterWrapper(),
			expansionLineCount,
			hunkData,
			incrementRowCount(count = 1) {
				context.rowCount += count;
			},
			pushToGutter(type, element) {
				switch (type) {
					case "unified":
						context.unifiedGutterAST.children.push(element);
						break;
					case "deletions":
						context.deletionsGutterAST.children.push(element);
						break;
					case "additions":
						context.additionsGutterAST.children.push(element);
						break;
				}
			}
		};
		const trailingRangeSize = getTrailingContextRangeSize({
			fileDiff,
			errorPrefix: "DiffHunksRenderer.processDiffResult"
		});
		const pendingSplitContext = {
			size: 0,
			side: void 0,
			increment() {
				this.size += 1;
			},
			flush() {
				if (diffStyle === "unified") return;
				if (this.size <= 0 || this.side == null) {
					this.side = void 0;
					this.size = 0;
					return;
				}
				if (this.side === "additions") {
					context.pushToGutter("additions", createGutterGap(void 0, "buffer", this.size));
					additionsContentAST?.push(createEmptyRowBuffer(this.size));
				} else {
					context.pushToGutter("deletions", createGutterGap(void 0, "buffer", this.size));
					deletionsContentAST?.push(createEmptyRowBuffer(this.size));
				}
				this.size = 0;
				this.side = void 0;
			}
		};
		const pushGutterLineNumber = (type, lineType, lineNumber, lineIndex, gutterProperties) => {
			context.pushToGutter(type, createGutterItem(lineType, lineNumber, lineIndex, gutterProperties));
		};
		function pushSeparators(props) {
			pendingSplitContext.flush();
			if (diffStyle === "unified") pushSeparator("unified", props, context);
			else {
				pushSeparator("deletions", props, context);
				pushSeparator("additions", props, context);
			}
		}
		this.pushFileLevelAnnotations(fileDiff, diffStyle, renderRange, context);
		iterateOverDiff({
			diff: fileDiff,
			diffStyle,
			startingLine: renderRange.startingLine,
			totalLines: renderRange.totalLines,
			expandedHunks: expandUnchanged ? true : this.expandedHunks,
			collapsedContextThreshold,
			callback: ({ hunkIndex, hunk, collapsedBefore, collapsedAfter, additionLine, deletionLine, type }) => {
				const splitLineIndex = deletionLine != null ? deletionLine.splitLineIndex : additionLine.splitLineIndex;
				const unifiedLineIndex = additionLine != null ? additionLine.unifiedLineIndex : deletionLine.unifiedLineIndex;
				if (diffStyle === "split" && type !== "change") pendingSplitContext.flush();
				if (collapsedBefore > 0) pushSeparators({
					hunkIndex,
					collapsedLines: collapsedBefore,
					rangeSize: Math.max(hunk?.collapsedBefore ?? 0, 0),
					hunkSpecs: hunk?.hunkSpecs,
					isFirstHunk: hunkIndex === 0,
					isLastHunk: false,
					isExpandable: !fileDiff.isPartial
				});
				const lineIndex = diffStyle === "unified" ? unifiedLineIndex : splitLineIndex;
				const renderedLineContext = {
					type,
					hunkIndex,
					lineIndex,
					unifiedLineIndex,
					splitLineIndex,
					deletionLine,
					additionLine
				};
				if (diffStyle === "unified") {
					const injectedRows = this.getUnifiedInjectedRowsForLine?.(renderedLineContext);
					if (injectedRows?.before != null) pushUnifiedInjectedRows(injectedRows.before, context);
					let deletionLineContent = deletionLine != null ? deletionLines[deletionLine.lineIndex] : void 0;
					let additionLineContent = additionLine != null ? additionLines[additionLine.lineIndex] : void 0;
					if (deletionLineContent == null && additionLineContent == null) {
						const errorMessage = "DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong";
						console.error(errorMessage, { file: fileDiff.name });
						throw new Error(errorMessage);
					}
					const lineType = type === "change" ? additionLine != null ? "change-addition" : "change-deletion" : type;
					const lineDecoration = this.getUnifiedLineDecoration({
						type,
						lineType,
						additionLineIndex: additionLine?.lineIndex,
						deletionLineIndex: deletionLine?.lineIndex
					});
					pushGutterLineNumber("unified", lineDecoration.gutterLineType, additionLine != null ? additionLine.lineNumber : deletionLine.lineNumber, `${unifiedLineIndex},${splitLineIndex}`, lineDecoration.gutterProperties);
					if (additionLineContent != null) additionLineContent = withContentProperties(additionLineContent, lineDecoration.contentProperties);
					else if (deletionLineContent != null) deletionLineContent = withContentProperties(deletionLineContent, lineDecoration.contentProperties);
					pushLineWithAnnotation({
						diffStyle: "unified",
						type,
						deletionLine: deletionLineContent,
						additionLine: additionLineContent,
						unifiedSpan: this.getAnnotations("unified", deletionLine?.lineNumber, additionLine?.lineNumber, hunkIndex, lineIndex),
						createAnnotationElement: (span) => this.createAnnotationElement(span),
						context
					});
					if (injectedRows?.after != null) pushUnifiedInjectedRows(injectedRows.after, context);
				} else {
					const injectedRows = this.getSplitInjectedRowsForLine?.(renderedLineContext);
					if (injectedRows?.before != null) pushSplitInjectedRows(injectedRows.before, context, pendingSplitContext);
					let deletionLineContent = deletionLine != null ? deletionLines[deletionLine.lineIndex] : void 0;
					let additionLineContent = additionLine != null ? additionLines[additionLine.lineIndex] : void 0;
					const deletionLineDecoration = this.getSplitLineDecoration({
						side: "deletions",
						type,
						lineIndex: deletionLine?.lineIndex
					});
					const additionLineDecoration = this.getSplitLineDecoration({
						side: "additions",
						type,
						lineIndex: additionLine?.lineIndex
					});
					if (deletionLineContent == null && additionLineContent == null) {
						const errorMessage = "DiffHunksRenderer.processDiffResult: deletionLine and additionLine are null, something is wrong";
						console.error(errorMessage, { file: fileDiff.name });
						throw new Error(errorMessage);
					}
					const missingSide = (() => {
						if (type === "change") {
							if (additionLineContent == null) return "additions";
							else if (deletionLineContent == null) return "deletions";
						}
					})();
					if (missingSide != null) {
						if (pendingSplitContext.side != null && pendingSplitContext.side !== missingSide) throw new Error("DiffHunksRenderer.processDiffResult: iterateOverDiff, invalid pending splits");
						pendingSplitContext.side = missingSide;
						pendingSplitContext.increment();
					}
					const annotationSpans = this.getAnnotations("split", deletionLine?.lineNumber, additionLine?.lineNumber, hunkIndex, lineIndex);
					if (annotationSpans != null && pendingSplitContext.size > 0) pendingSplitContext.flush();
					if (deletionLine != null) {
						const deletionLineDecorated = withContentProperties(deletionLineContent, deletionLineDecoration.contentProperties);
						pushGutterLineNumber("deletions", deletionLineDecoration.gutterLineType, deletionLine.lineNumber, `${deletionLine.unifiedLineIndex},${splitLineIndex}`, deletionLineDecoration.gutterProperties);
						if (deletionLineDecorated != null) deletionLineContent = deletionLineDecorated;
					}
					if (additionLine != null) {
						const additionLineDecorated = withContentProperties(additionLineContent, additionLineDecoration.contentProperties);
						pushGutterLineNumber("additions", additionLineDecoration.gutterLineType, additionLine.lineNumber, `${additionLine.unifiedLineIndex},${splitLineIndex}`, additionLineDecoration.gutterProperties);
						if (additionLineDecorated != null) additionLineContent = additionLineDecorated;
					}
					pushLineWithAnnotation({
						diffStyle: "split",
						type,
						additionLine: additionLineContent,
						deletionLine: deletionLineContent,
						...annotationSpans,
						createAnnotationElement: (span) => this.createAnnotationElement(span),
						context
					});
					if (injectedRows?.after != null) pushSplitInjectedRows(injectedRows.after, context, pendingSplitContext);
				}
				const isFinalSplitHunkRow = diffStyle === "split" && hunk != null && splitLineIndex === hunk.splitLineStart + hunk.splitLineCount - 1;
				const splitNoEOFCRDeletion = isFinalSplitHunkRow ? hunk.noEOFCRDeletions : false;
				const splitNoEOFCRAddition = isFinalSplitHunkRow ? hunk.noEOFCRAdditions : false;
				const noEOFCRDeletion = (deletionLine?.noEOFCR ?? false) || splitNoEOFCRDeletion;
				const noEOFCRAddition = (additionLine?.noEOFCR ?? false) || splitNoEOFCRAddition;
				if (noEOFCRAddition || noEOFCRDeletion) {
					if (diffStyle === "split") pendingSplitContext.flush();
					if (noEOFCRDeletion) {
						const noEOFType = type === "context" || type === "context-expanded" ? type : "change-deletion";
						if (diffStyle === "unified") {
							context.unifiedContentAST.push(createNoNewlineElement(noEOFType));
							context.pushToGutter("unified", createGutterGap(noEOFType, "metadata", 1));
						} else {
							context.deletionsContentAST.push(createNoNewlineElement(noEOFType));
							context.pushToGutter("deletions", createGutterGap(noEOFType, "metadata", 1));
							if (!noEOFCRAddition) {
								context.pushToGutter("additions", createGutterGap(void 0, "buffer", 1));
								context.additionsContentAST.push(createEmptyRowBuffer(1));
							}
						}
					}
					if (noEOFCRAddition) {
						const noEOFType = type === "context" || type === "context-expanded" ? type : "change-addition";
						if (diffStyle === "unified") {
							context.unifiedContentAST.push(createNoNewlineElement(noEOFType));
							context.pushToGutter("unified", createGutterGap(noEOFType, "metadata", 1));
						} else {
							context.additionsContentAST.push(createNoNewlineElement(noEOFType));
							context.pushToGutter("additions", createGutterGap(noEOFType, "metadata", 1));
							if (!noEOFCRDeletion) {
								context.pushToGutter("deletions", createGutterGap(void 0, "buffer", 1));
								context.deletionsContentAST.push(createEmptyRowBuffer(1));
							}
						}
					}
					context.incrementRowCount(1);
				}
				if (collapsedAfter > 0 && hunkSeparators !== "simple") pushSeparators({
					hunkIndex: type === "context-expanded" ? hunkIndex : hunkIndex + 1,
					collapsedLines: collapsedAfter,
					rangeSize: trailingRangeSize,
					hunkSpecs: void 0,
					isFirstHunk: false,
					isLastHunk: true,
					isExpandable: !fileDiff.isPartial
				});
				context.incrementRowCount(1);
			}
		});
		if (diffStyle === "split") pendingSplitContext.flush();
		const totalLines = Math.max(getTotalLineCountFromHunks(fileDiff.hunks), fileDiff.additionLines.length ?? 0, fileDiff.deletionLines.length ?? 0);
		const hasBuffer = renderRange.bufferBefore > 0 || renderRange.bufferAfter > 0;
		const shouldIncludeAdditions = !unified && fileDiff.type !== "deleted";
		const shouldIncludeDeletions = !unified && fileDiff.type !== "new";
		const hasContent = context.rowCount > 0 || hasBuffer;
		additionsContentAST = shouldIncludeAdditions && hasContent ? additionsContentAST : void 0;
		deletionsContentAST = shouldIncludeDeletions && hasContent ? deletionsContentAST : void 0;
		unifiedContentAST = unified && hasContent ? unifiedContentAST : void 0;
		const preNode = this.createPreElement(deletionsContentAST != null && additionsContentAST != null, totalLines);
		return {
			unifiedGutterAST: unified && hasContent ? context.unifiedGutterAST.children : void 0,
			unifiedContentAST,
			deletionsGutterAST: shouldIncludeDeletions && hasContent ? context.deletionsGutterAST.children : void 0,
			deletionsContentAST,
			additionsGutterAST: shouldIncludeAdditions && hasContent ? context.additionsGutterAST.children : void 0,
			additionsContentAST,
			hunkData,
			preNode,
			themeStyles,
			baseThemeType,
			headerElement: !disableFileHeader ? this.renderHeader(this.diff) : void 0,
			totalLines,
			rowCount: context.rowCount,
			bufferBefore: renderRange.bufferBefore,
			bufferAfter: renderRange.bufferAfter,
			css: ""
		};
	}
	renderCodeAST(type, result) {
		const gutterAST = type === "unified" ? result.unifiedGutterAST : type === "deletions" ? result.deletionsGutterAST : result.additionsGutterAST;
		const contentAST = type === "unified" ? result.unifiedContentAST : type === "deletions" ? result.deletionsContentAST : result.additionsContentAST;
		if (gutterAST == null || contentAST == null) return;
		const gutter = createGutterWrapper(gutterAST);
		gutter.properties.style = `grid-row: span ${result.rowCount}`;
		return [gutter, createContentColumn(contentAST, result.rowCount)];
	}
	renderFullAST(result, children = []) {
		const containerSize = this.getOptionsWithDefaults().hunkSeparators === "line-info";
		const unifiedAST = this.renderCodeAST("unified", result);
		if (unifiedAST != null) {
			children.push(createHastElement({
				tagName: "code",
				children: unifiedAST,
				properties: {
					"data-code": "",
					"data-container-size": containerSize ? "" : void 0,
					"data-unified": ""
				}
			}));
			return {
				...result.preNode,
				children
			};
		}
		const deletionsAST = this.renderCodeAST("deletions", result);
		if (deletionsAST != null) children.push(createHastElement({
			tagName: "code",
			children: deletionsAST,
			properties: {
				"data-code": "",
				"data-container-size": containerSize ? "" : void 0,
				"data-deletions": ""
			}
		}));
		const additionsAST = this.renderCodeAST("additions", result);
		if (additionsAST != null) children.push(createHastElement({
			tagName: "code",
			children: additionsAST,
			properties: {
				"data-code": "",
				"data-container-size": containerSize ? "" : void 0,
				"data-additions": ""
			}
		}));
		return {
			...result.preNode,
			children
		};
	}
	renderFullHTML(result, tempChildren = []) {
		return toHtml(this.renderFullAST(result, tempChildren));
	}
	renderPartialHTML(children, columnType) {
		if (columnType == null) return toHtml(children);
		return toHtml(createHastElement({
			tagName: "code",
			children,
			properties: {
				"data-code": "",
				"data-container-size": this.getOptionsWithDefaults().hunkSeparators === "line-info" ? "" : void 0,
				[`data-${columnType}`]: ""
			}
		}));
	}
	pushFileLevelAnnotations(fileDiff, diffStyle, renderRange, context) {
		if (!shouldRenderFileAnnotations(renderRange)) return;
		const deletionAnnotationNames = fileDiff.type !== "new" ? getAnnotationNames(getFileAnnotations(this.deletionAnnotations)) : [];
		const additionAnnotationNames = fileDiff.type !== "deleted" ? getAnnotationNames(getFileAnnotations(this.additionAnnotations)) : [];
		if (deletionAnnotationNames.length === 0 && additionAnnotationNames.length === 0) return;
		const hunkIndex = -1;
		const lineIndex = -1;
		const { createAnnotationElement } = this;
		if (diffStyle === "unified") {
			pushLineWithAnnotation({
				diffStyle,
				type: "context",
				unifiedSpan: {
					type: "annotation",
					hunkIndex,
					lineIndex,
					annotations: deletionAnnotationNames.concat(additionAnnotationNames)
				},
				createAnnotationElement,
				context
			});
			return;
		}
		pushLineWithAnnotation({
			diffStyle,
			type: "context",
			deletionSpan: {
				type: "annotation",
				hunkIndex,
				lineIndex,
				annotations: deletionAnnotationNames
			},
			additionSpan: {
				type: "annotation",
				hunkIndex,
				lineIndex,
				annotations: additionAnnotationNames
			},
			createAnnotationElement,
			context
		});
	}
	getAnnotations(type, deletionLineNumber, additionLineNumber, hunkIndex, lineIndex) {
		const deletionSpan = {
			type: "annotation",
			hunkIndex,
			lineIndex,
			annotations: []
		};
		if (deletionLineNumber != null) for (const anno of this.deletionAnnotations[deletionLineNumber] ?? []) deletionSpan.annotations.push(getLineAnnotationName(anno));
		const additionSpan = {
			type: "annotation",
			hunkIndex,
			lineIndex,
			annotations: []
		};
		if (additionLineNumber != null) for (const anno of this.additionAnnotations[additionLineNumber] ?? []) (type === "unified" ? deletionSpan : additionSpan).annotations.push(getLineAnnotationName(anno));
		if (type === "unified") {
			if (deletionSpan.annotations.length > 0) return deletionSpan;
			return;
		}
		if (additionSpan.annotations.length === 0 && deletionSpan.annotations.length === 0) return;
		return {
			deletionSpan,
			additionSpan
		};
	}
	renderHeader(diff) {
		const { headerRenderMode, stickyHeader } = this.getOptionsWithDefaults();
		return createFileHeaderElement({
			fileOrDiff: diff,
			mode: headerRenderMode,
			stickyHeader
		});
	}
};
function getAnnotationNames(annotations) {
	return annotations?.map((annotation) => getLineAnnotationName(annotation)) ?? [];
}
const EN_PLURAL_RULES = new Intl.PluralRules("en-US");
function getModifiedLinesString(lines) {
	return `${lines} unmodified line${EN_PLURAL_RULES.select(lines) === "one" ? "" : "s"}`;
}
function pushUnifiedInjectedRows(rows, context) {
	for (const row of rows) {
		context.unifiedContentAST.push(row.content);
		context.pushToGutter("unified", row.gutter);
		context.incrementRowCount(1);
	}
}
function pushSplitInjectedRows(rows, context, pendingSplitContext) {
	for (const { deletion, addition } of rows) {
		if (deletion == null && addition == null) continue;
		const missingSide = deletion != null && addition != null ? void 0 : deletion == null ? "deletions" : "additions";
		if (missingSide == null || pendingSplitContext.side !== missingSide) pendingSplitContext.flush();
		if (deletion != null) {
			context.deletionsContentAST.push(deletion.content);
			context.pushToGutter("deletions", deletion.gutter);
		}
		if (addition != null) {
			context.additionsContentAST.push(addition.content);
			context.pushToGutter("additions", addition.gutter);
		}
		if (missingSide != null) {
			pendingSplitContext.side = missingSide;
			pendingSplitContext.increment();
		}
		context.incrementRowCount(1);
	}
}
function pushLineWithAnnotation({ diffStyle, type, deletionLine, additionLine, unifiedSpan, deletionSpan, additionSpan, createAnnotationElement, context }) {
	let hasAnnotationRow = false;
	if (diffStyle === "unified") {
		if (additionLine != null) context.unifiedContentAST.push(additionLine);
		else if (deletionLine != null) context.unifiedContentAST.push(deletionLine);
		if (unifiedSpan != null) {
			const lineType = type === "change" ? deletionLine != null ? "change-deletion" : "change-addition" : type;
			context.unifiedContentAST.push(createAnnotationElement(unifiedSpan));
			context.pushToGutter("unified", createGutterGap(lineType, "annotation", 1));
			hasAnnotationRow = true;
		}
	} else if (diffStyle === "split") {
		if (deletionLine != null) context.deletionsContentAST.push(deletionLine);
		if (additionLine != null) context.additionsContentAST.push(additionLine);
		if (deletionSpan != null) {
			const lineType = type === "change" ? deletionLine != null ? "change-deletion" : "context" : type;
			context.deletionsContentAST.push(createAnnotationElement(deletionSpan));
			context.pushToGutter("deletions", createGutterGap(lineType, "annotation", 1));
			hasAnnotationRow = true;
		}
		if (additionSpan != null) {
			const lineType = type === "change" ? additionLine != null ? "change-addition" : "context" : type;
			context.additionsContentAST.push(createAnnotationElement(additionSpan));
			context.pushToGutter("additions", createGutterGap(lineType, "annotation", 1));
			hasAnnotationRow = true;
		}
	}
	if (hasAnnotationRow) context.incrementRowCount(1);
}
function pushSeparator(type, { hunkIndex, collapsedLines, rangeSize, hunkSpecs, isFirstHunk, isLastHunk, isExpandable }, context) {
	if (collapsedLines <= 0) return;
	const linesAST = type === "unified" ? context.unifiedContentAST : type === "deletions" ? context.deletionsContentAST : context.additionsContentAST;
	if (context.hunkSeparators === "metadata") {
		if (hunkSpecs != null) {
			context.pushToGutter(type, createSeparator({
				type: "metadata",
				content: hunkSpecs,
				isFirstHunk,
				isLastHunk
			}));
			linesAST.push(createSeparator({
				type: "metadata",
				content: hunkSpecs,
				isFirstHunk,
				isLastHunk
			}));
			if (type !== "additions") context.incrementRowCount(1);
		}
		return;
	}
	if (context.hunkSeparators === "simple") {
		if (hunkIndex > 0) {
			context.pushToGutter(type, createSeparator({
				type: "simple",
				isFirstHunk,
				isLastHunk: false
			}));
			linesAST.push(createSeparator({
				type: "simple",
				isFirstHunk,
				isLastHunk: false
			}));
			if (type !== "additions") context.incrementRowCount(1);
		}
		return;
	}
	const slotName = getHunkSeparatorSlotName(type, hunkIndex);
	const chunked = rangeSize > context.expansionLineCount;
	const expandIndex = isExpandable ? hunkIndex : void 0;
	context.pushToGutter(type, createSeparator({
		type: context.hunkSeparators,
		content: getModifiedLinesString(collapsedLines),
		expandIndex,
		chunked,
		slotName,
		isFirstHunk,
		isLastHunk
	}));
	linesAST.push(createSeparator({
		type: context.hunkSeparators,
		content: getModifiedLinesString(collapsedLines),
		expandIndex,
		chunked,
		slotName,
		isFirstHunk,
		isLastHunk
	}));
	if (type !== "additions") context.incrementRowCount(1);
	context.hunkData.push({
		slotName,
		hunkIndex,
		lines: collapsedLines,
		type,
		expandable: isExpandable ? {
			up: !isFirstHunk,
			down: !isLastHunk,
			chunked
		} : void 0
	});
}
function withContentProperties(lineNode, contentProperties) {
	if (lineNode == null || lineNode.type !== "element" || contentProperties == null) return lineNode;
	return {
		...lineNode,
		properties: {
			...lineNode.properties,
			...contentProperties
		}
	};
}
function isDiffMassive(diff, tokenizeMaxLength) {
	return Math.max(diff.additionLines.length, diff.deletionLines.length) > tokenizeMaxLength;
}
//#endregion
export { DiffHunksRenderer };

//# sourceMappingURL=DiffHunksRenderer.js.map