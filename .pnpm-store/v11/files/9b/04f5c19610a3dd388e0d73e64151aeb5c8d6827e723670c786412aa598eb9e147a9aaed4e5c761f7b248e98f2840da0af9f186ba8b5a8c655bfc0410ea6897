import { DEFAULT_RENDER_RANGE, DEFAULT_THEMES } from "../constants.js";
import { getFileAnnotations, shouldRenderFileAnnotations } from "../utils/includesFileAnnotations.js";
import { iterateOverFile } from "../utils/iterateOverFile.js";
import { createGutterGap, createGutterItem, createGutterWrapper, createHastElement } from "../utils/hast_utils.js";
import { areLanguagesAttached } from "../highlighter/languages/areLanguagesAttached.js";
import { getHighlighterIfLoaded, getSharedHighlighter } from "../highlighter/shared_highlighter.js";
import { getThemes } from "../utils/getThemes.js";
import { areThemesAttached } from "../highlighter/themes/areThemesAttached.js";
import { hasResolvedThemes } from "../highlighter/themes/hasResolvedThemes.js";
import { areFileRenderOptionsEqual } from "../utils/areFileRenderOptionsEqual.js";
import { areFilesEqual } from "../utils/areFilesEqual.js";
import { areRenderRangesEqual } from "../utils/areRenderRangesEqual.js";
import { createAnnotationElement } from "../utils/createAnnotationElement.js";
import { createContentColumn } from "../utils/createContentColumn.js";
import { createFileHeaderElement } from "../utils/createFileHeaderElement.js";
import { createPreElement } from "../utils/createPreElement.js";
import { getFiletypeFromFileName } from "../utils/getFiletypeFromFileName.js";
import { getHighlighterOptions } from "../utils/getHighlighterOptions.js";
import { getLineAnnotationName } from "../utils/getLineAnnotationName.js";
import { isFilePlainText } from "../utils/isFilePlainText.js";
import { splitFileContents } from "../utils/splitFileContents.js";
import { renderFileWithHighlighter } from "../utils/renderFileWithHighlighter.js";
import { shouldUseTokenTransformer } from "../utils/shouldUseTokenTransformer.js";
import { toHtml } from "hast-util-to-html";
//#region src/renderers/FileRenderer.ts
let instanceId = -1;
var FileRenderer = class {
	options;
	onRenderUpdate;
	workerManager;
	__id = `file-renderer:${++instanceId}`;
	highlighter;
	renderCache;
	computedLang = "text";
	lineAnnotations = {};
	lineCache;
	constructor(options = { theme: DEFAULT_THEMES }, onRenderUpdate, workerManager) {
		this.options = options;
		this.onRenderUpdate = onRenderUpdate;
		this.workerManager = workerManager;
		if (workerManager?.isWorkingPool() !== true) this.highlighter = areThemesAttached(options.theme ?? DEFAULT_THEMES) ? getHighlighterIfLoaded() : void 0;
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
	setLineAnnotations(lineAnnotations) {
		this.lineAnnotations = {};
		for (const annotation of lineAnnotations) {
			const arr = this.lineAnnotations[annotation.lineNumber] ?? [];
			this.lineAnnotations[annotation.lineNumber] = arr;
			arr.push(annotation);
		}
	}
	cleanUp() {
		this.recycle();
		this.workerManager = void 0;
		this.onRenderUpdate = void 0;
	}
	recycle() {
		this.clearRenderCache();
		this.highlighter = void 0;
		this.workerManager?.cleanUpTasks(this);
		this.lineCache = void 0;
	}
	clearRenderCache() {
		this.renderCache = void 0;
	}
	hydrate(file) {
		const { options } = this.getRenderOptions(file);
		const massiveFile = isFileMassive(this.getOrCreateLineCache(file).length, this.getTokenizeMaxLength());
		let cache = this.workerManager?.getFileResultCache(file);
		if (cache != null && !areFileRenderOptionsEqual(options, cache.options)) cache = void 0;
		this.renderCache ??= {
			file,
			options,
			highlighted: !massiveFile && !isFilePlainText(file),
			result: massiveFile ? void 0 : cache?.result,
			renderRange: void 0
		};
		if (this.workerManager?.isWorkingPool() === true) {
			if (this.renderCache.result == null && !massiveFile) this.workerManager.highlightFileAST(this, file);
		} else if (this.highlighter == null) {
			this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
			this.initializeHighlighter();
		}
	}
	getRenderOptions(file) {
		const options = (() => {
			if (this.workerManager?.isWorkingPool() === true) return this.workerManager.getFileRenderOptions();
			const { theme = DEFAULT_THEMES, tokenizeMaxLineLength = 1e3 } = this.options;
			return {
				theme,
				useTokenTransformer: shouldUseTokenTransformer(this.options),
				tokenizeMaxLineLength
			};
		})();
		const { renderCache } = this;
		if (renderCache?.result == null) return {
			options,
			forceHighlight: true
		};
		if (!areFilesEqual(file, renderCache.file) || !areFileRenderOptionsEqual(options, renderCache.options)) return {
			options,
			forceHighlight: true
		};
		return {
			options,
			forceHighlight: false
		};
	}
	getOrCreateLineCache(file) {
		if (file.cacheKey == null) {
			this.lineCache = void 0;
			return splitFileContents(file.contents);
		}
		let { lineCache } = this;
		if (lineCache == null || lineCache.cacheKey !== file.cacheKey) lineCache = {
			cacheKey: file.cacheKey,
			lines: splitFileContents(file.contents)
		};
		this.lineCache = lineCache;
		return lineCache.lines;
	}
	renderFile(file = this.renderCache?.file, renderRange = DEFAULT_RENDER_RANGE) {
		if (file == null) return;
		let { options, forceHighlight } = this.getRenderOptions(file);
		const cache = this.getMatchingWorkerResultCache(file, options);
		if (cache != null && !this.hasHighlightedRenderCache(file, options)) {
			this.renderCache = {
				file,
				highlighted: true,
				renderRange: void 0,
				...cache
			};
			forceHighlight = false;
		}
		this.renderCache ??= {
			file,
			highlighted: false,
			options,
			result: void 0,
			renderRange: void 0
		};
		const lines = this.getOrCreateLineCache(file);
		const hasContent = file.contents.length > 0;
		const forcePlainText = !hasContent || isFilePlainText(file) || isFileMassive(lines.length, this.getTokenizeMaxLength());
		const newContent = !areFilesEqual(file, this.renderCache.file);
		const newRenderRange = !areRenderRangesEqual(this.renderCache.renderRange, renderRange);
		if (this.workerManager?.isWorkingPool() === true) {
			if (forcePlainText || this.renderCache.result == null || !this.renderCache.highlighted && (newContent || newRenderRange)) {
				this.renderCache.file = file;
				this.renderCache.options = options;
				this.renderCache.highlighted = false;
				if (this.renderCache.result == null || newContent || newRenderRange || forceHighlight) this.renderCache.result = this.workerManager.getPlainFileAST(file, renderRange.startingLine, renderRange.totalLines, lines);
				this.renderCache.renderRange = renderRange;
			}
			if (!forcePlainText && hasContent && (!this.renderCache.highlighted || forceHighlight)) this.workerManager.highlightFileAST(this, file);
		} else {
			this.computedLang = file.lang ?? getFiletypeFromFileName(file.name);
			const hasThemes = this.highlighter != null && areThemesAttached(options.theme);
			const hasLangs = this.highlighter != null && areLanguagesAttached(this.computedLang);
			const canHighlight = !forcePlainText && hasLangs;
			if (this.highlighter != null && hasThemes && (forceHighlight || forcePlainText || !this.renderCache.highlighted && canHighlight || this.renderCache.result == null)) {
				const { result, options } = this.renderFileWithHighlighter(file, this.highlighter, forcePlainText || !hasLangs);
				this.renderCache = {
					file,
					options,
					highlighted: canHighlight,
					result,
					renderRange: void 0
				};
			}
			if (!hasThemes || !forcePlainText && !hasLangs) this.asyncHighlight(file).then(({ result, options }) => {
				if (this.renderCache != null) this.renderCache.highlighted = false;
				this.onHighlightSuccess(file, result, options, !forcePlainText);
			});
		}
		return this.renderCache.result != null ? this.processFileResult(this.renderCache.file, renderRange, this.renderCache.result) : void 0;
	}
	async asyncRender(file, renderRange = DEFAULT_RENDER_RANGE) {
		const { result } = await this.asyncHighlight(file);
		return this.processFileResult(file, renderRange, result);
	}
	async asyncHighlight(file) {
		const forcePlainText = isFileMassive(this.getOrCreateLineCache(file).length, this.getTokenizeMaxLength());
		this.computedLang = forcePlainText ? "text" : file.lang ?? getFiletypeFromFileName(file.name);
		const hasThemes = this.highlighter != null && hasResolvedThemes(getThemes(this.options.theme));
		const hasLangs = forcePlainText || this.highlighter != null && areLanguagesAttached(this.computedLang);
		if (this.highlighter == null || !hasThemes || !hasLangs) this.highlighter = await this.initializeHighlighter();
		return this.renderFileWithHighlighter(file, this.highlighter, forcePlainText);
	}
	renderFileWithHighlighter(file, highlighter, forcePlainText = false) {
		const { options } = this.getRenderOptions(file);
		return {
			result: renderFileWithHighlighter(file, highlighter, options, { forcePlainText }),
			options
		};
	}
	processFileResult(file, renderRange, { code, themeStyles, baseThemeType }) {
		const { disableFileHeader = false } = this.options;
		const contentArray = [];
		const gutter = createGutterWrapper();
		const lines = this.getOrCreateLineCache(file);
		let rowCount = 0;
		const fileLevelAnnotations = shouldRenderFileAnnotations(renderRange) ? getFileAnnotations(this.lineAnnotations) : void 0;
		if (fileLevelAnnotations != null) {
			gutter.children.push(createGutterGap("context", "annotation", 1));
			contentArray.push(createAnnotationElement({
				type: "annotation",
				hunkIndex: -1,
				lineIndex: -1,
				annotations: fileLevelAnnotations.map((annotation) => getLineAnnotationName(annotation))
			}));
			rowCount++;
		}
		iterateOverFile({
			lines,
			startingLine: renderRange.startingLine,
			totalLines: renderRange.totalLines,
			callback: ({ lineIndex, lineNumber }) => {
				const line = code[lineIndex];
				if (line == null) {
					const message = "FileRenderer.processFileResult: Line doesnt exist";
					console.error(message, {
						name: file.name,
						lineIndex,
						lineNumber,
						lines
					});
					throw new Error(message);
				}
				if (line != null) {
					gutter.children.push(createGutterItem("context", lineNumber, `${lineIndex}`));
					contentArray.push(line);
					rowCount++;
					const annotations = this.lineAnnotations[lineNumber];
					if (annotations != null) {
						gutter.children.push(createGutterGap("context", "annotation", 1));
						contentArray.push(createAnnotationElement({
							type: "annotation",
							hunkIndex: 0,
							lineIndex: lineNumber,
							annotations: annotations.map((annotation) => getLineAnnotationName(annotation))
						}));
						rowCount++;
					}
				}
			}
		});
		gutter.properties.style = `grid-row: span ${rowCount}`;
		return {
			gutterAST: gutter.children ?? [],
			contentAST: contentArray,
			preAST: this.createPreElement(lines.length),
			headerAST: !disableFileHeader ? this.renderHeader(file) : void 0,
			totalLines: lines.length,
			rowCount,
			themeStyles,
			baseThemeType,
			bufferBefore: renderRange.bufferBefore,
			bufferAfter: renderRange.bufferAfter,
			css: ""
		};
	}
	renderHeader(file) {
		const { headerRenderMode = "default", stickyHeader = false } = this.options;
		return createFileHeaderElement({
			fileOrDiff: file,
			mode: headerRenderMode,
			stickyHeader
		});
	}
	renderFullHTML(result) {
		return toHtml(this.renderFullAST(result));
	}
	renderFullAST(result, children = []) {
		children.push(createHastElement({
			tagName: "code",
			children: this.renderCodeAST(result),
			properties: { "data-code": "" }
		}));
		return {
			...result.preAST,
			children
		};
	}
	renderCodeAST(result) {
		const gutter = createGutterWrapper();
		gutter.children = result.gutterAST;
		gutter.properties.style = `grid-row: span ${result.rowCount}`;
		return [gutter, createContentColumn(result.contentAST, result.rowCount)];
	}
	renderPartialHTML(children, includeCodeNode = false) {
		if (!includeCodeNode) return toHtml(children);
		return toHtml(createHastElement({
			tagName: "code",
			children,
			properties: { "data-code": "" }
		}));
	}
	async initializeHighlighter() {
		this.highlighter = await getSharedHighlighter(getHighlighterOptions(this.computedLang, this.options));
		return this.highlighter;
	}
	onHighlightSuccess(file, result, options, highlighted = true) {
		if (this.renderCache == null) return;
		const triggerRenderUpdate = !areFilesEqual(file, this.renderCache.file) || !this.renderCache.highlighted || !areFileRenderOptionsEqual(options, this.renderCache.options);
		this.renderCache = {
			file,
			options,
			highlighted,
			result,
			renderRange: void 0
		};
		if (triggerRenderUpdate) this.onRenderUpdate?.();
	}
	getMatchingWorkerResultCache(file, options) {
		const cache = this.workerManager?.getFileResultCache(file);
		if (cache == null || !areFileRenderOptionsEqual(options, cache.options)) return;
		return cache;
	}
	hasHighlightedRenderCache(file, options) {
		const { renderCache } = this;
		return renderCache?.result != null && renderCache.highlighted && areFilesEqual(file, renderCache.file) && areFileRenderOptionsEqual(options, renderCache.options);
	}
	onHighlightError(error) {
		console.error(error);
	}
	getTokenizeMaxLength() {
		return this.options.tokenizeMaxLength ?? 1e5;
	}
	createPreElement(totalLines) {
		const { disableLineNumbers = false, overflow = "scroll" } = this.options;
		return createPreElement({
			type: "file",
			diffIndicators: "none",
			disableBackground: true,
			disableLineNumbers,
			overflow,
			split: false,
			totalLines
		});
	}
};
function isFileMassive(lineCount, tokenizeMaxLength) {
	return lineCount > tokenizeMaxLength;
}
//#endregion
export { FileRenderer };

//# sourceMappingURL=FileRenderer.js.map