import { CUSTOM_HEADER_SLOT_ID, DEFAULT_THEMES, EMPTY_RENDER_RANGE, HEADER_METADATA_SLOT_ID, HEADER_PREFIX_SLOT_ID } from "../constants.js";
import { areThemesEqual } from "../utils/areThemesEqual.js";
import { isStyleNode } from "../utils/isStyleNode.js";
import { InteractionManager, pluckInteractionOptions } from "../managers/InteractionManager.js";
import { ResizeManager } from "../managers/ResizeManager.js";
import { areFilesEqual } from "../utils/areFilesEqual.js";
import { areRenderRangesEqual } from "../utils/areRenderRangesEqual.js";
import { getLineAnnotationName } from "../utils/getLineAnnotationName.js";
import { SVGSpriteSheet } from "../sprite.js";
import { arePrePropertiesEqual } from "../utils/arePrePropertiesEqual.js";
import { createAnnotationWrapperNode } from "../utils/createAnnotationWrapperNode.js";
import { createGutterUtilityContentNode } from "../utils/createGutterUtilityContentNode.js";
import { createUnsafeCSSStyleNode } from "../utils/createUnsafeCSSStyleNode.js";
import { getMeasuredScrollbarGutter } from "../utils/scrollbarGutter.js";
import { patchScrollbarGutterSize, wrapThemeCSS, wrapUnsafeCSS } from "../utils/cssWrappers.js";
import { getOrCreateCodeNode } from "../utils/getOrCreateCodeNode.js";
import { upsertHostThemeStyle } from "../utils/hostTheme.js";
import { prerenderHTMLIfNecessary } from "../utils/prerenderHTMLIfNecessary.js";
import { setPreNodeProperties } from "../utils/setWrapperNodeProps.js";
import "./web-components.js";
import { parseDiffFromFile } from "../utils/parseDiffFromFile.js";
import { ScrollSyncManager } from "../managers/ScrollSyncManager.js";
import { isDiffPlainText } from "../utils/isDiffPlainText.js";
import { DiffHunksRenderer } from "../renderers/DiffHunksRenderer.js";
import { areDiffLineAnnotationsEqual } from "../utils/areDiffLineAnnotationsEqual.js";
import { areHunkDataEqual } from "../utils/areHunkDataEqual.js";
import { getDiffHunksRendererOptions } from "../utils/getDiffHunksRendererOptions.js";
import { toHtml } from "hast-util-to-html";
//#region src/components/FileDiff.ts
let instanceId = -1;
var FileDiff = class {
	options;
	workerManager;
	isContainerManaged;
	static LoadedCustomComponent = true;
	__id = `file-diff:${++instanceId}`;
	type = "file-diff";
	fileContainer;
	spriteSVG;
	pre;
	codeUnified;
	codeDeletions;
	codeAdditions;
	bufferBefore;
	bufferAfter;
	themeCSSStyle;
	appliedThemeCSS;
	hasAdoptedThemeCSS = false;
	unsafeCSSStyle;
	appliedUnsafeCSS;
	gutterUtilityContent;
	headerElement;
	headerPrefix;
	headerMetadata;
	headerCustom;
	separatorCache = /* @__PURE__ */ new Map();
	errorWrapper;
	placeHolder;
	hunksRenderer;
	resizeManager;
	scrollSyncManager;
	interactionManager;
	annotationCache = /* @__PURE__ */ new Map();
	lineAnnotations = [];
	managersDirty = false;
	deletionFile;
	additionFile;
	fileDiff;
	renderRange;
	appliedPreAttributes;
	lastRenderedHeaderHTML;
	cachedHeaderHTML;
	lastRowCount;
	mounted = false;
	enabled = true;
	constructor(options = { theme: DEFAULT_THEMES }, workerManager, isContainerManaged = false) {
		this.options = options;
		this.workerManager = workerManager;
		this.isContainerManaged = isContainerManaged;
		this.hunksRenderer = this.createHunksRenderer(options);
		this.resizeManager = new ResizeManager();
		this.scrollSyncManager = new ScrollSyncManager();
		this.interactionManager = new InteractionManager("diff", pluckInteractionOptions(options, typeof options.hunkSeparators === "function" || (options.hunkSeparators ?? "line-info") === "line-info" || options.hunkSeparators === "line-info-basic" ? this.handleExpandHunk : void 0, this.getLineIndex));
		this.workerManager?.subscribeToThemeChanges(this);
		this.enabled = true;
	}
	handleHighlightRender = () => {
		this.rerender();
	};
	getHunksRendererOptions(options) {
		return getDiffHunksRendererOptions(options);
	}
	createHunksRenderer(options) {
		return new DiffHunksRenderer(this.getHunksRendererOptions(options), this.handleHighlightRender, this.workerManager);
	}
	getLineIndex = (lineNumber, side = "additions") => {
		if (this.fileDiff == null) return;
		const lastHunk = this.fileDiff.hunks.at(-1);
		let targetUnifiedIndex;
		let targetSplitIndex;
		hunkIterator: for (const hunk of this.fileDiff.hunks) {
			let currentLineNumber = side === "deletions" ? hunk.deletionStart : hunk.additionStart;
			const hunkCount = side === "deletions" ? hunk.deletionCount : hunk.additionCount;
			let splitIndex = hunk.splitLineStart;
			let unifiedIndex = hunk.unifiedLineStart;
			if (lineNumber < currentLineNumber) {
				const difference = currentLineNumber - lineNumber;
				targetUnifiedIndex = Math.max(unifiedIndex - difference, 0);
				targetSplitIndex = Math.max(splitIndex - difference, 0);
				break hunkIterator;
			}
			if (lineNumber >= currentLineNumber + hunkCount) {
				if (hunk === lastHunk) {
					const difference = lineNumber - (currentLineNumber + hunkCount);
					targetUnifiedIndex = unifiedIndex + hunk.unifiedLineCount + difference;
					targetSplitIndex = splitIndex + hunk.splitLineCount + difference;
					break hunkIterator;
				}
				continue;
			}
			for (const content of hunk.hunkContent) if (content.type === "context") if (lineNumber < currentLineNumber + content.lines) {
				const difference = lineNumber - currentLineNumber;
				targetSplitIndex = splitIndex + difference;
				targetUnifiedIndex = unifiedIndex + difference;
				break hunkIterator;
			} else {
				currentLineNumber += content.lines;
				splitIndex += content.lines;
				unifiedIndex += content.lines;
			}
			else {
				const sideCount = side === "deletions" ? content.deletions : content.additions;
				if (lineNumber < currentLineNumber + sideCount) {
					const indexDifference = lineNumber - currentLineNumber;
					targetUnifiedIndex = unifiedIndex + (side === "additions" ? content.deletions : 0) + indexDifference;
					targetSplitIndex = splitIndex + indexDifference;
					break hunkIterator;
				} else {
					currentLineNumber += sideCount;
					splitIndex += Math.max(content.deletions, content.additions);
					unifiedIndex += content.deletions + content.additions;
				}
			}
			break hunkIterator;
		}
		if (targetUnifiedIndex == null || targetSplitIndex == null) return;
		return [targetUnifiedIndex, targetSplitIndex];
	};
	setOptions(options) {
		if (options == null) return;
		this.options = options;
		this.cachedHeaderHTML = void 0;
		this.hunksRenderer.setOptions(this.getHunksRendererOptions(options));
		this.syncInteractionOptions();
	}
	syncInteractionOptions() {
		this.interactionManager.setOptions(pluckInteractionOptions(this.options, typeof this.options.hunkSeparators === "function" || (this.options.hunkSeparators ?? "line-info") === "line-info" || this.options.hunkSeparators === "line-info-basic" ? this.handleExpandHunk : void 0, this.getLineIndex));
	}
	mergeOptions(options) {
		this.options = {
			...this.options,
			...options
		};
	}
	setThemeType(themeType) {
		if ((this.options.themeType ?? "system") === themeType) return;
		this.mergeOptions({ themeType });
		this.applyCachedThemeState(themeType);
	}
	applyCachedThemeState(themeType) {
		if (typeof this.options.theme === "string" || this.fileContainer == null || this.appliedThemeCSS == null) return false;
		const effectiveThemeType = this.appliedThemeCSS.baseThemeType ?? themeType;
		if (this.appliedThemeCSS.themeType === effectiveThemeType) return false;
		this.applyThemeState(this.fileContainer, this.appliedThemeCSS.themeStyles, themeType, this.appliedThemeCSS.baseThemeType);
		return true;
	}
	hasThemeChanged() {
		return this.appliedThemeCSS != null && !areThemesEqual(this.appliedThemeCSS.theme, this.options.theme ?? DEFAULT_THEMES);
	}
	getHoveredLine = () => {
		return this.interactionManager.getHoveredLine();
	};
	setLineAnnotations(lineAnnotations) {
		this.lineAnnotations = lineAnnotations;
	}
	canPartiallyRender(forceRender, annotationsChanged, didContentChange) {
		if (forceRender || annotationsChanged || didContentChange || typeof this.options.hunkSeparators === "function") return false;
		return true;
	}
	setSelectedLines(range, options) {
		this.interactionManager.setSelection(range, options);
	}
	flushManagers() {
		if (!this.managersDirty || this.pre == null) {
			this.managersDirty = false;
			return;
		}
		const { diffStyle = "split", overflow = "scroll" } = this.options;
		this.interactionManager.setup(this.pre);
		this.resizeManager.setup(this.pre, overflow === "wrap");
		if (overflow === "scroll" && diffStyle === "split") this.scrollSyncManager.setup(this.pre, this.codeDeletions, this.codeAdditions);
		else this.scrollSyncManager.cleanUp();
		this.managersDirty = false;
	}
	cleanUp(recycle = false) {
		this.emitPostRender(true);
		this.resizeManager.cleanUp();
		this.interactionManager.cleanUp();
		this.scrollSyncManager.cleanUp();
		this.managersDirty = false;
		this.workerManager?.unsubscribeToThemeChanges(this);
		this.renderRange = void 0;
		if (!this.isContainerManaged) this.fileContainer?.remove();
		this.fileContainer = void 0;
		this.mounted = false;
		if (!recycle) this.lineAnnotations = [];
		this.clearAuxiliaryNodes();
		this.annotationCache.clear();
		this.pre = void 0;
		this.codeUnified = void 0;
		this.codeDeletions = void 0;
		this.codeAdditions = void 0;
		this.bufferBefore = void 0;
		this.bufferAfter = void 0;
		this.appliedPreAttributes = void 0;
		this.headerElement = void 0;
		this.headerPrefix = void 0;
		this.headerMetadata = void 0;
		this.headerCustom = void 0;
		this.placeHolder = void 0;
		this.lastRenderedHeaderHTML = void 0;
		if (!recycle) this.cachedHeaderHTML = void 0;
		this.errorWrapper = void 0;
		this.spriteSVG = void 0;
		this.lastRowCount = void 0;
		this.themeCSSStyle = void 0;
		this.appliedThemeCSS = void 0;
		this.hasAdoptedThemeCSS = false;
		this.unsafeCSSStyle = void 0;
		this.appliedUnsafeCSS = void 0;
		if (recycle) this.hunksRenderer.recycle();
		else {
			this.hunksRenderer.cleanUp();
			this.workerManager = void 0;
			this.fileDiff = void 0;
			this.deletionFile = void 0;
			this.additionFile = void 0;
		}
		this.enabled = false;
	}
	virtualizedSetup() {
		this.enabled = true;
		this.workerManager?.subscribeToThemeChanges(this);
	}
	hydrate(props) {
		const { fileContainer, prerenderedHTML, preventEmit = false, lineAnnotations, oldFile, newFile, fileDiff } = props;
		this.hydrateElements(fileContainer, prerenderedHTML);
		if (shouldRenderCode(this.pre, hasDiffContent({
			fileDiff,
			oldFile,
			newFile
		}), this.options.collapsed) || shouldRenderHeader(this.headerElement, hasDiffHeaderContent({
			fileDiff,
			oldFile,
			newFile
		}), this.options.disableFileHeader)) this.render({
			...props,
			preventEmit: true
		});
		else this.hydrationSetup({
			fileDiff,
			oldFile,
			newFile,
			lineAnnotations
		});
		if (!preventEmit) this.emitPostRender();
	}
	hydrateElements(fileContainer, prerenderedHTML) {
		if (this.fileContainer !== fileContainer) this.emitPostRender(true);
		prerenderHTMLIfNecessary(fileContainer, prerenderedHTML);
		for (const element of fileContainer.shadowRoot?.children ?? []) {
			if (element instanceof SVGElement) {
				this.spriteSVG = element;
				continue;
			}
			if (!(element instanceof HTMLElement)) continue;
			if (element instanceof HTMLPreElement) {
				this.pre = element;
				for (const code of element.children) {
					if (!(code instanceof HTMLElement) || code.tagName.toLowerCase() !== "code") continue;
					if ("deletions" in code.dataset) this.codeDeletions = code;
					if ("additions" in code.dataset) this.codeAdditions = code;
					if ("unified" in code.dataset) this.codeUnified = code;
				}
				continue;
			}
			if ("diffsHeader" in element.dataset) {
				this.headerElement = element;
				continue;
			}
			if (element instanceof HTMLStyleElement && element.hasAttribute("data-theme-css")) {
				this.themeCSSStyle = element;
				continue;
			}
			if (element instanceof HTMLStyleElement && element.hasAttribute("data-unsafe-css")) {
				this.unsafeCSSStyle = element;
				this.appliedUnsafeCSS = element.textContent;
				continue;
			}
		}
		if (this.pre != null) {
			this.syncCodeNodesFromPre(this.pre);
			this.pre.removeAttribute("data-dehydrated");
		}
		this.fileContainer = fileContainer;
		this.hydrateMeasuredScrollbar();
	}
	hydrationSetup({ fileDiff, oldFile, newFile, lineAnnotations }) {
		this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
		this.additionFile = newFile;
		this.deletionFile = oldFile;
		this.fileDiff = fileDiff ?? (oldFile != null && newFile != null ? parseDiffFromFile(oldFile, newFile, this.options.parseDiffOptions) : void 0);
		if (this.pre == null) return;
		this.syncInteractionOptions();
		this.hunksRenderer.hydrate(this.fileDiff);
		this.renderAnnotations();
		this.renderGutterUtility();
		this.injectUnsafeCSS();
		this.managersDirty = true;
		this.flushManagers();
	}
	rerender() {
		if (!this.enabled || this.fileDiff == null && this.additionFile == null && this.deletionFile == null) return;
		this.render({
			forceRender: true,
			renderRange: this.renderRange
		});
	}
	onThemeChange() {
		this.hunksRenderer.clearRenderCache();
		this.rerender();
	}
	handleExpandHunk = (hunkIndex, direction, expansionLineCountOverride) => {
		this.expandHunk(hunkIndex, direction, expansionLineCountOverride);
	};
	expandHunk = (hunkIndex, direction, expansionLineCountOverride) => {
		this.hunksRenderer.expandHunk(hunkIndex, direction, expansionLineCountOverride);
		this.rerender();
	};
	render({ oldFile, newFile, fileDiff, deferManagers = false, forceRender = false, preventEmit = false, lineAnnotations, fileContainer, containerWrapper, renderRange }) {
		if (!this.enabled) throw new Error("FileDiff.render: attempting to call render after cleaned up");
		const { collapsed = false, themeType = "system" } = this.options;
		const nextRenderRange = collapsed ? void 0 : renderRange;
		const themeChanged = this.hasThemeChanged();
		const filesDidChange = oldFile != null && newFile != null && (!areFilesEqual(oldFile, this.deletionFile) || !areFilesEqual(newFile, this.additionFile));
		let diffDidChange = fileDiff != null && fileDiff !== this.fileDiff;
		const annotationsChanged = lineAnnotations != null && (lineAnnotations.length > 0 || this.lineAnnotations.length > 0) ? lineAnnotations !== this.lineAnnotations : false;
		if (!collapsed && areRenderRangesEqual(nextRenderRange, this.renderRange) && !forceRender && !annotationsChanged && !themeChanged && (fileDiff != null && fileDiff === this.fileDiff || fileDiff == null && !filesDidChange)) return this.applyCachedThemeState(themeType);
		const { renderRange: previousRenderRange } = this;
		this.renderRange = nextRenderRange;
		this.deletionFile = oldFile;
		this.additionFile = newFile;
		if (fileDiff != null) this.fileDiff = fileDiff;
		else if (oldFile != null && newFile != null && filesDidChange) {
			diffDidChange = true;
			this.fileDiff = parseDiffFromFile(oldFile, newFile, this.options.parseDiffOptions);
		}
		if (diffDidChange) this.cachedHeaderHTML = void 0;
		if (lineAnnotations != null) this.setLineAnnotations(lineAnnotations);
		if (this.fileDiff == null) return false;
		this.hunksRenderer.setOptions(this.getHunksRendererOptions(this.options));
		this.syncInteractionOptions();
		this.hunksRenderer.setLineAnnotations(this.lineAnnotations);
		const { disableErrorHandling = false, disableFileHeader = false } = this.options;
		if (disableFileHeader) {
			if (this.headerElement != null) {
				this.headerElement.remove();
				this.headerElement = void 0;
				this.lastRenderedHeaderHTML = void 0;
			}
			this.clearHeaderSlots();
		}
		fileContainer = this.getOrCreateFileContainer(fileContainer, containerWrapper);
		this.applyCachedThemeState(themeType);
		if (collapsed) {
			this.removeRenderedCode();
			this.clearAuxiliaryNodes();
			try {
				const hunksResult = this.hunksRenderer.renderDiff(this.fileDiff, EMPTY_RENDER_RANGE);
				if (hunksResult != null) this.applyThemeState(fileContainer, hunksResult.themeStyles, themeType, hunksResult.baseThemeType);
				if (hunksResult?.headerElement != null) this.applyHeaderToDOM(hunksResult.headerElement, fileContainer);
				this.renderSeparators([]);
				this.injectUnsafeCSS();
			} catch (error) {
				if (disableErrorHandling) throw error;
				console.error(error);
				if (error instanceof Error) this.applyErrorToDOM(error, fileContainer);
			}
			if (!preventEmit) this.emitPostRender();
			return true;
		}
		try {
			const pre = this.getOrCreatePreNode(fileContainer);
			if (!(this.canPartiallyRender(forceRender, annotationsChanged, filesDidChange || diffDidChange || themeChanged) && this.applyPartialRender({
				previousRenderRange,
				renderRange: nextRenderRange
			}))) {
				const hunksResult = this.hunksRenderer.renderDiff(this.fileDiff, nextRenderRange);
				if (hunksResult == null) {
					if (this.workerManager?.isInitialized() === false) this.workerManager.initialize().then(() => this.rerender());
					return false;
				}
				this.applyThemeState(fileContainer, hunksResult.themeStyles, themeType, hunksResult.baseThemeType);
				if (hunksResult.headerElement != null) this.applyHeaderToDOM(hunksResult.headerElement, fileContainer);
				if (hunksResult.additionsContentAST != null || hunksResult.deletionsContentAST != null || hunksResult.unifiedContentAST != null) this.applyHunksToDOM(pre, hunksResult);
				else if (this.pre != null) {
					this.pre.remove();
					this.pre = void 0;
				}
				this.renderSeparators(hunksResult.hunkData);
			}
			this.applyBuffers(pre, nextRenderRange);
			this.injectUnsafeCSS();
			this.renderAnnotations();
			this.renderGutterUtility();
			this.managersDirty = true;
			if (!deferManagers) this.flushManagers();
		} catch (error) {
			if (disableErrorHandling) throw error;
			console.error(error);
			if (error instanceof Error) this.applyErrorToDOM(error, fileContainer);
		}
		if (!preventEmit) this.emitPostRender();
		return true;
	}
	emitPostRender(unmount = false) {
		const { fileContainer, options: { onPostRender } } = this;
		if (unmount) {
			if (!this.mounted) return;
			this.mounted = false;
			if (fileContainer == null) return;
			this.options.onPostRender?.(fileContainer, this, "unmount");
			return;
		}
		if (fileContainer == null) return;
		const phase = this.mounted ? "update" : "mount";
		this.mounted = true;
		onPostRender?.(fileContainer, this, phase);
	}
	removeRenderedCode() {
		this.resizeManager.cleanUp();
		this.scrollSyncManager.cleanUp();
		this.interactionManager.cleanUp();
		this.bufferBefore?.remove();
		this.bufferBefore = void 0;
		this.bufferAfter?.remove();
		this.bufferAfter = void 0;
		this.codeUnified?.remove();
		this.codeUnified = void 0;
		this.codeDeletions?.remove();
		this.codeDeletions = void 0;
		this.codeAdditions?.remove();
		this.codeAdditions = void 0;
		this.pre?.remove();
		this.pre = void 0;
		this.appliedPreAttributes = void 0;
		this.lastRowCount = void 0;
	}
	clearAuxiliaryNodes() {
		for (const { element } of this.separatorCache.values()) element.remove();
		this.separatorCache.clear();
		for (const { element } of this.annotationCache.values()) element.remove();
		this.annotationCache.clear();
		this.gutterUtilityContent?.remove();
		this.gutterUtilityContent = void 0;
	}
	renderPlaceholder(height) {
		if (this.fileContainer == null) return false;
		this.emitPostRender(true);
		this.cleanChildNodes();
		if (this.placeHolder == null) {
			const shadowRoot = this.fileContainer.shadowRoot ?? this.fileContainer.attachShadow({ mode: "open" });
			this.placeHolder = document.createElement("div");
			this.placeHolder.dataset.placeholder = "";
			shadowRoot.appendChild(this.placeHolder);
		}
		this.placeHolder.style.setProperty("height", `${height}px`);
		return true;
	}
	primeHighlightCache() {
		const { fileDiff, workerManager } = this;
		if (fileDiff == null || workerManager == null || isDiffPlainText(fileDiff)) return;
		const tokenizeMaxLength = this.options.tokenizeMaxLength ?? 1e5;
		if (Math.max(fileDiff.additionLines.length, fileDiff.deletionLines.length) > tokenizeMaxLength) return;
		workerManager.primeDiffHighlightCache(fileDiff);
	}
	cleanChildNodes() {
		this.resizeManager.cleanUp();
		this.scrollSyncManager.cleanUp();
		this.interactionManager.cleanUp();
		this.clearAuxiliaryNodes();
		this.bufferAfter?.remove();
		this.bufferBefore?.remove();
		this.codeAdditions?.remove();
		this.codeDeletions?.remove();
		this.codeUnified?.remove();
		this.errorWrapper?.remove();
		this.headerElement?.remove();
		this.headerPrefix?.remove();
		this.headerMetadata?.remove();
		this.headerCustom?.remove();
		this.pre?.remove();
		this.spriteSVG?.remove();
		this.themeCSSStyle?.remove();
		this.unsafeCSSStyle?.remove();
		this.bufferAfter = void 0;
		this.bufferBefore = void 0;
		this.codeAdditions = void 0;
		this.codeDeletions = void 0;
		this.codeUnified = void 0;
		this.errorWrapper = void 0;
		this.headerElement = void 0;
		this.headerPrefix = void 0;
		this.headerMetadata = void 0;
		this.headerCustom = void 0;
		this.pre = void 0;
		this.spriteSVG = void 0;
		this.themeCSSStyle = void 0;
		this.appliedThemeCSS = void 0;
		this.hasAdoptedThemeCSS = false;
		this.unsafeCSSStyle = void 0;
		this.appliedUnsafeCSS = void 0;
		this.lastRenderedHeaderHTML = void 0;
		this.lastRowCount = void 0;
		this.mounted = false;
	}
	renderSeparators(hunkData) {
		const { hunkSeparators } = this.options;
		if (this.isContainerManaged || this.fileContainer == null || typeof hunkSeparators !== "function") {
			for (const { element } of this.separatorCache.values()) element.remove();
			this.separatorCache.clear();
			return;
		}
		const staleSeparators = new Map(this.separatorCache);
		for (const hunk of hunkData) {
			const id = hunk.slotName;
			let cache = this.separatorCache.get(id);
			if (cache == null || !areHunkDataEqual(hunk, cache.hunkData)) {
				cache?.element.remove();
				const element = document.createElement("div");
				element.style.display = "contents";
				element.slot = hunk.slotName;
				const child = hunkSeparators(hunk, this);
				if (child != null) element.appendChild(child);
				this.fileContainer.appendChild(element);
				cache = {
					element,
					hunkData: hunk
				};
				this.separatorCache.set(id, cache);
			}
			staleSeparators.delete(id);
		}
		for (const [id, { element }] of staleSeparators.entries()) {
			this.separatorCache.delete(id);
			element.remove();
		}
	}
	renderAnnotations() {
		if (this.isContainerManaged || this.fileContainer == null) {
			for (const { element } of this.annotationCache.values()) element.remove();
			this.annotationCache.clear();
			return;
		}
		const staleAnnotations = new Map(this.annotationCache);
		const { renderAnnotation } = this.options;
		if (renderAnnotation != null && this.lineAnnotations.length > 0) for (const [index, annotation] of this.lineAnnotations.entries()) {
			const id = `${index}-${getLineAnnotationName(annotation)}`;
			let cache = this.annotationCache.get(id);
			if (cache == null || !areDiffLineAnnotationsEqual(annotation, cache.annotation)) {
				cache?.element.remove();
				const content = renderAnnotation(annotation);
				if (content == null) continue;
				cache = {
					element: createAnnotationWrapperNode(getLineAnnotationName(annotation)),
					annotation
				};
				cache.element.appendChild(content);
				this.fileContainer.appendChild(cache.element);
				this.annotationCache.set(id, cache);
			}
			staleAnnotations.delete(id);
		}
		for (const [id, { element }] of staleAnnotations.entries()) {
			this.annotationCache.delete(id);
			element.remove();
		}
	}
	renderGutterUtility() {
		const { renderGutterUtility } = this.options;
		if (this.fileContainer == null || renderGutterUtility == null) {
			this.gutterUtilityContent?.remove();
			this.gutterUtilityContent = void 0;
			return;
		}
		const element = renderGutterUtility(this.interactionManager.getHoveredLine);
		if (element != null && this.gutterUtilityContent != null) return;
		else if (element == null) {
			this.gutterUtilityContent?.remove();
			this.gutterUtilityContent = void 0;
			return;
		}
		const gutterUtilityContent = createGutterUtilityContentNode();
		gutterUtilityContent.appendChild(element);
		this.fileContainer.appendChild(gutterUtilityContent);
		this.gutterUtilityContent = gutterUtilityContent;
	}
	getOrCreateFileContainer(fileContainer, parentNode) {
		const { fileContainer: previousContainer } = this;
		const nextContainer = fileContainer ?? previousContainer ?? document.createElement("diffs-container");
		const containerChanged = previousContainer !== nextContainer;
		if (containerChanged) this.emitPostRender(true);
		this.fileContainer = nextContainer;
		if (previousContainer != null && containerChanged) {
			this.lastRenderedHeaderHTML = void 0;
			this.headerElement = void 0;
		}
		if (parentNode != null && this.fileContainer.parentNode !== parentNode) parentNode.appendChild(this.fileContainer);
		if (containerChanged) this.adoptReusableShellElements(this.fileContainer);
		this.ensureSpriteSVG(this.fileContainer);
		return this.fileContainer;
	}
	adoptReusableShellElements(fileContainer) {
		const { shadowRoot } = fileContainer;
		if (shadowRoot == null) return;
		for (const element of shadowRoot.children) if (element instanceof SVGElement) this.spriteSVG ??= element;
		else if (isStyleNode(element) && element.hasAttribute("data-theme-css")) {
			this.themeCSSStyle ??= element;
			this.hasAdoptedThemeCSS = true;
		} else if (isStyleNode(element) && element.hasAttribute("data-unsafe-css")) {
			this.unsafeCSSStyle ??= element;
			this.appliedUnsafeCSS ??= this.options.unsafeCSS ?? void 0;
		}
	}
	ensureSpriteSVG(fileContainer) {
		const shadowRoot = fileContainer.shadowRoot ?? fileContainer.attachShadow({ mode: "open" });
		if (this.spriteSVG == null) {
			const fragment = document.createElement("div");
			fragment.innerHTML = SVGSpriteSheet;
			const firstChild = fragment.firstChild;
			if (firstChild instanceof SVGElement) this.spriteSVG = firstChild;
		}
		if (this.spriteSVG != null && this.spriteSVG.parentNode !== shadowRoot) shadowRoot.appendChild(this.spriteSVG);
	}
	getOrCreatePreNode(container) {
		const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: "open" });
		if (this.pre == null) {
			this.pre = document.createElement("pre");
			this.appliedPreAttributes = void 0;
			this.codeUnified = void 0;
			this.codeDeletions = void 0;
			this.codeAdditions = void 0;
			shadowRoot.appendChild(this.pre);
		} else if (this.pre.parentNode !== shadowRoot) {
			shadowRoot.appendChild(this.pre);
			this.appliedPreAttributes = void 0;
		}
		this.placeHolder?.remove();
		this.placeHolder = void 0;
		return this.pre;
	}
	syncCodeNodesFromPre(pre) {
		this.codeUnified = void 0;
		this.codeDeletions = void 0;
		this.codeAdditions = void 0;
		for (const child of Array.from(pre.children)) {
			if (!(child instanceof HTMLElement)) continue;
			if (child.hasAttribute("data-unified")) this.codeUnified = child;
			else if (child.hasAttribute("data-deletions")) this.codeDeletions = child;
			else if (child.hasAttribute("data-additions")) this.codeAdditions = child;
		}
	}
	applyHeaderToDOM(headerAST, container) {
		this.cleanupErrorWrapper();
		this.placeHolder?.remove();
		this.placeHolder = void 0;
		const { fileDiff } = this;
		const headerHTML = this.cachedHeaderHTML ?? toHtml(headerAST);
		this.cachedHeaderHTML = headerHTML;
		if (headerHTML !== this.lastRenderedHeaderHTML) {
			const tempDiv = document.createElement("div");
			tempDiv.innerHTML = headerHTML;
			const newHeader = tempDiv.firstElementChild;
			if (!(newHeader instanceof HTMLElement)) return;
			if (this.headerElement != null) container.shadowRoot?.replaceChild(newHeader, this.headerElement);
			else container.shadowRoot?.prepend(newHeader);
			this.headerElement = newHeader;
			this.lastRenderedHeaderHTML = headerHTML;
		}
		if (this.isContainerManaged || fileDiff == null) return;
		const { renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata } = this.options;
		if (renderCustomHeader != null) {
			const content = renderCustomHeader(fileDiff) ?? void 0;
			this.headerCustom = this.upsertHeaderSlotElement(container, this.headerCustom, CUSTOM_HEADER_SLOT_ID, content);
			this.headerPrefix?.remove();
			this.headerMetadata?.remove();
			this.headerPrefix = void 0;
			this.headerMetadata = void 0;
			return;
		}
		const prefix = renderHeaderPrefix?.(fileDiff) ?? void 0;
		const content = renderHeaderMetadata?.(fileDiff) ?? void 0;
		this.headerPrefix = this.upsertHeaderSlotElement(container, this.headerPrefix, HEADER_PREFIX_SLOT_ID, prefix);
		this.headerMetadata = this.upsertHeaderSlotElement(container, this.headerMetadata, HEADER_METADATA_SLOT_ID, content);
		this.headerCustom?.remove();
		this.headerCustom = void 0;
	}
	clearHeaderSlots() {
		this.headerPrefix?.remove();
		this.headerMetadata?.remove();
		this.headerCustom?.remove();
		this.headerPrefix = void 0;
		this.headerMetadata = void 0;
		this.headerCustom = void 0;
	}
	upsertHeaderSlotElement(container, current, slot, content) {
		if (content == null) {
			current?.remove();
			return;
		}
		const element = current ?? this.createHeaderSlotElement(slot);
		if (current == null) container.appendChild(element);
		this.replaceHeaderSlotContent(element, content);
		return element;
	}
	replaceHeaderSlotContent(element, content) {
		element.replaceChildren();
		if (content instanceof Element) element.appendChild(content);
		else element.innerText = `${content}`;
	}
	createHeaderSlotElement(slot) {
		const element = document.createElement("div");
		element.slot = slot;
		return element;
	}
	injectUnsafeCSS() {
		const { unsafeCSS } = this.options;
		const shadowRoot = this.fileContainer?.shadowRoot;
		if (shadowRoot == null) return;
		if (unsafeCSS == null || unsafeCSS === "") {
			if (this.unsafeCSSStyle != null) {
				this.unsafeCSSStyle.remove();
				this.unsafeCSSStyle = void 0;
			}
			this.appliedUnsafeCSS = void 0;
			return;
		}
		if (this.unsafeCSSStyle?.parentNode === shadowRoot && this.appliedUnsafeCSS === unsafeCSS) return;
		this.unsafeCSSStyle ??= createUnsafeCSSStyleNode();
		if (this.unsafeCSSStyle.parentNode !== shadowRoot) shadowRoot.appendChild(this.unsafeCSSStyle);
		this.unsafeCSSStyle.textContent = wrapUnsafeCSS(unsafeCSS);
		this.appliedUnsafeCSS = unsafeCSS;
	}
	applyThemeState(container, themeStyles, themeType, baseThemeType) {
		const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: "open" });
		const effectiveThemeType = baseThemeType ?? themeType;
		const currentTheme = this.options.theme ?? DEFAULT_THEMES;
		const theme = typeof currentTheme === "string" ? currentTheme : { ...currentTheme };
		const scrollbarGutter = getMeasuredScrollbarGutter(shadowRoot);
		if (this.themeCSSStyle?.parentNode === shadowRoot && this.appliedThemeCSS?.themeStyles === themeStyles && this.appliedThemeCSS.themeType === effectiveThemeType && this.appliedThemeCSS.scrollbarGutter === scrollbarGutter) {
			this.appliedThemeCSS.theme = theme;
			return;
		}
		if (this.hasAdoptedThemeCSS && this.themeCSSStyle?.parentNode === shadowRoot) {
			this.hasAdoptedThemeCSS = false;
			this.appliedThemeCSS = {
				theme,
				themeStyles,
				themeType: effectiveThemeType,
				baseThemeType,
				scrollbarGutter
			};
			return;
		}
		this.themeCSSStyle = upsertHostThemeStyle({
			shadowRoot,
			currentNode: this.themeCSSStyle,
			themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType, scrollbarGutter)
		});
		this.appliedThemeCSS = this.themeCSSStyle != null ? {
			theme,
			themeStyles,
			themeType: effectiveThemeType,
			baseThemeType,
			scrollbarGutter
		} : void 0;
	}
	hydrateMeasuredScrollbar() {
		const shadowRoot = this.fileContainer?.shadowRoot;
		if (shadowRoot == null || this.themeCSSStyle == null) return;
		this.themeCSSStyle.textContent = patchScrollbarGutterSize(this.themeCSSStyle.textContent ?? "", getMeasuredScrollbarGutter(shadowRoot));
	}
	applyHunksToDOM(pre, result) {
		const { overflow = "scroll" } = this.options;
		const containerSize = (this.options.hunkSeparators ?? "line-info") === "line-info";
		const rowSpan = overflow === "wrap" ? result.rowCount : void 0;
		this.cleanupErrorWrapper();
		this.applyPreNodeAttributes(pre, result);
		let shouldReplace = false;
		const codeElements = [];
		const unifiedAST = this.hunksRenderer.renderCodeAST("unified", result);
		const deletionsAST = this.hunksRenderer.renderCodeAST("deletions", result);
		const additionsAST = this.hunksRenderer.renderCodeAST("additions", result);
		if (unifiedAST != null) {
			shouldReplace = this.codeUnified == null || this.codeAdditions != null || this.codeDeletions != null;
			this.codeDeletions?.remove();
			this.codeDeletions = void 0;
			this.codeAdditions?.remove();
			this.codeAdditions = void 0;
			this.codeUnified = getOrCreateCodeNode({
				code: this.codeUnified,
				columnType: "unified",
				rowSpan,
				containerSize
			});
			this.codeUnified.innerHTML = this.hunksRenderer.renderPartialHTML(unifiedAST);
			codeElements.push(this.codeUnified);
		} else if (deletionsAST != null || additionsAST != null) {
			if (deletionsAST != null) {
				shouldReplace = this.codeDeletions == null || this.codeUnified != null;
				this.codeUnified?.remove();
				this.codeUnified = void 0;
				this.codeDeletions = getOrCreateCodeNode({
					code: this.codeDeletions,
					columnType: "deletions",
					rowSpan,
					containerSize
				});
				this.codeDeletions.innerHTML = this.hunksRenderer.renderPartialHTML(deletionsAST);
				codeElements.push(this.codeDeletions);
			} else {
				this.codeDeletions?.remove();
				this.codeDeletions = void 0;
			}
			if (additionsAST != null) {
				shouldReplace = shouldReplace || this.codeAdditions == null || this.codeUnified != null;
				this.codeUnified?.remove();
				this.codeUnified = void 0;
				this.codeAdditions = getOrCreateCodeNode({
					code: this.codeAdditions,
					columnType: "additions",
					rowSpan,
					containerSize
				});
				this.codeAdditions.innerHTML = this.hunksRenderer.renderPartialHTML(additionsAST);
				codeElements.push(this.codeAdditions);
			} else {
				this.codeAdditions?.remove();
				this.codeAdditions = void 0;
			}
		} else {
			this.codeUnified?.remove();
			this.codeUnified = void 0;
			this.codeDeletions?.remove();
			this.codeDeletions = void 0;
			this.codeAdditions?.remove();
			this.codeAdditions = void 0;
		}
		if (codeElements.length === 0) pre.textContent = "";
		else if (shouldReplace) pre.replaceChildren(...codeElements);
		this.lastRowCount = result.rowCount;
	}
	applyPartialRender({ previousRenderRange, renderRange }) {
		const { pre, codeUnified, codeAdditions, codeDeletions, options: { diffStyle = "split" } } = this;
		if (pre == null || previousRenderRange == null || renderRange == null || !Number.isFinite(previousRenderRange.totalLines) || !Number.isFinite(renderRange.totalLines) || this.lastRowCount == null) return false;
		const codeElements = this.getCodeColumns(diffStyle, codeUnified, codeDeletions, codeAdditions);
		if (codeElements == null) return false;
		const previousStart = previousRenderRange.startingLine;
		const nextStart = renderRange.startingLine;
		const previousEnd = previousStart + previousRenderRange.totalLines;
		const nextEnd = nextStart + renderRange.totalLines;
		const overlapStart = Math.max(previousStart, nextStart);
		const overlapEnd = Math.min(previousEnd, nextEnd);
		if (overlapEnd <= overlapStart) return false;
		const trimStart = Math.max(0, overlapStart - previousStart);
		const trimEnd = Math.max(0, previousEnd - overlapEnd);
		const trimResult = this.trimColumns({
			columns: codeElements,
			trimStart,
			trimEnd,
			previousStart,
			overlapStart,
			overlapEnd,
			diffStyle
		});
		if (trimResult < 0) throw new Error("applyPartialRender: failed to trim to overlap");
		if (this.lastRowCount < trimResult) throw new Error("applyPartialRender: trimmed beyond DOM row count");
		let rowCount = this.lastRowCount - trimResult;
		const renderChunk = (startingLine, totalLines) => {
			if (totalLines <= 0 || this.fileDiff == null) return;
			return this.hunksRenderer.renderDiff(this.fileDiff, {
				startingLine,
				totalLines,
				bufferBefore: 0,
				bufferAfter: 0
			});
		};
		const prependResult = renderChunk(nextStart, Math.max(overlapStart - nextStart, 0));
		if (prependResult == null && nextStart < overlapStart) return false;
		const appendResult = renderChunk(overlapEnd, Math.max(nextEnd - overlapEnd, 0));
		if (appendResult == null && nextEnd > overlapEnd) return false;
		const applyChunk = (result, insertPosition) => {
			if (result == null) return;
			if (diffStyle === "unified" && !Array.isArray(codeElements)) this.insertPartialHTML(diffStyle, codeElements, result, insertPosition);
			else if (diffStyle === "split" && Array.isArray(codeElements)) this.insertPartialHTML(diffStyle, codeElements, result, insertPosition);
			else throw new Error("FileDiff.applyPartialRender.applyChunk: invalid chunk application");
			rowCount += result.rowCount;
		};
		this.cleanupErrorWrapper();
		applyChunk(prependResult, "afterbegin");
		applyChunk(appendResult, "beforeend");
		if (this.lastRowCount !== rowCount) {
			this.applyRowSpan(diffStyle, codeElements, rowCount);
			this.lastRowCount = rowCount;
		}
		return true;
	}
	insertPartialHTML(diffStyle, columns, result, insertPosition) {
		if (diffStyle === "unified" && !Array.isArray(columns)) {
			const unifiedAST = this.hunksRenderer.renderCodeAST("unified", result);
			this.renderPartialColumn(columns, unifiedAST, insertPosition);
		} else if (diffStyle === "split" && Array.isArray(columns)) {
			const deletionsAST = this.hunksRenderer.renderCodeAST("deletions", result);
			const additionsAST = this.hunksRenderer.renderCodeAST("additions", result);
			this.renderPartialColumn(columns[0], deletionsAST, insertPosition);
			this.renderPartialColumn(columns[1], additionsAST, insertPosition);
		} else throw new Error("FileDiff.insertPartialHTML: Invalid argument composition");
	}
	renderPartialColumn(column, ast, insertPosition) {
		if (column == null || ast == null) return;
		const gutterChildren = getElementChildren(ast[0]);
		const contentChildren = getElementChildren(ast[1]);
		if (gutterChildren == null || contentChildren == null) throw new Error("FileDiff.insertPartialHTML: Unexpected AST structure");
		const firstHASTElement = contentChildren.at(0);
		if (insertPosition === "beforeend" && firstHASTElement?.type === "element" && typeof firstHASTElement.properties["data-buffer-size"] === "number") this.mergeBuffersIfNecessary(firstHASTElement.properties["data-buffer-size"], column.content.children[column.content.children.length - 1], column.gutter.children[column.gutter.children.length - 1], gutterChildren, contentChildren, true);
		const lastHASTElement = contentChildren.at(-1);
		if (insertPosition === "afterbegin" && lastHASTElement?.type === "element" && typeof lastHASTElement.properties["data-buffer-size"] === "number") this.mergeBuffersIfNecessary(lastHASTElement.properties["data-buffer-size"], column.content.children[0], column.gutter.children[0], gutterChildren, contentChildren, false);
		column.gutter.insertAdjacentHTML(insertPosition, this.hunksRenderer.renderPartialHTML(gutterChildren));
		column.content.insertAdjacentHTML(insertPosition, this.hunksRenderer.renderPartialHTML(contentChildren));
	}
	mergeBuffersIfNecessary(adjustmentSize, contentElement, gutterElement, gutterChildren, contentChildren, fromStart) {
		if (!(contentElement instanceof HTMLElement) || !(gutterElement instanceof HTMLElement)) return;
		const currentSize = this.getBufferSize(contentElement.dataset);
		if (currentSize == null) return;
		if (fromStart) {
			gutterChildren.shift();
			contentChildren.shift();
		} else {
			gutterChildren.pop();
			contentChildren.pop();
		}
		this.updateBufferSize(contentElement, currentSize + adjustmentSize);
		this.updateBufferSize(gutterElement, currentSize + adjustmentSize);
	}
	applyRowSpan(diffStyle, columns, rowCount) {
		const applySpan = (column) => {
			if (column == null) return;
			column.gutter.style.setProperty("grid-row", `span ${rowCount}`);
			column.content.style.setProperty("grid-row", `span ${rowCount}`);
		};
		if (diffStyle === "unified" && !Array.isArray(columns)) applySpan(columns);
		else if (diffStyle === "split" && Array.isArray(columns)) {
			applySpan(columns[0]);
			applySpan(columns[1]);
		} else throw new Error("dun fuuuuked up");
	}
	trimColumnRows(columns, preTrimCount, postTrimStart) {
		let visibleLineIndex = 0;
		let rowCount = 0;
		let rowIndex = 0;
		let pendingMetadataTrim = false;
		const hasPostTrim = postTrimStart >= 0;
		if (columns == null) return 0;
		const contentChildren = Array.from(columns.content.children);
		const gutterChildren = Array.from(columns.gutter.children);
		if (contentChildren.length !== gutterChildren.length) throw new Error("FileDiff.trimColumnRows: columns do not match");
		while (rowIndex < contentChildren.length) {
			if (preTrimCount <= 0 && !hasPostTrim && !pendingMetadataTrim) break;
			const gutterElement = gutterChildren[rowIndex];
			const contentElement = contentChildren[rowIndex];
			rowIndex++;
			if (!(gutterElement instanceof HTMLElement) || !(contentElement instanceof HTMLElement)) {
				console.error({
					gutterElement,
					contentElement
				});
				throw new Error("FileDiff.trimColumnRows: invalid row elements");
			}
			if (pendingMetadataTrim) {
				pendingMetadataTrim = false;
				if (gutterElement.dataset.gutterBuffer === "annotation" && "lineAnnotation" in contentElement.dataset || gutterElement.dataset.gutterBuffer === "metadata" && "noNewline" in contentElement.dataset) {
					gutterElement.remove();
					contentElement.remove();
					rowCount++;
					continue;
				}
			}
			if ("lineIndex" in gutterElement.dataset && "lineIndex" in contentElement.dataset) {
				if (preTrimCount > 0 || hasPostTrim && visibleLineIndex >= postTrimStart) {
					gutterElement.remove();
					contentElement.remove();
					if (preTrimCount > 0) {
						preTrimCount--;
						if (preTrimCount === 0) pendingMetadataTrim = true;
					}
					rowCount++;
				}
				visibleLineIndex++;
				continue;
			}
			if ("separator" in gutterElement.dataset && "separator" in contentElement.dataset) {
				if (preTrimCount > 0 || hasPostTrim && visibleLineIndex >= postTrimStart) {
					gutterElement.remove();
					contentElement.remove();
					rowCount++;
				}
				continue;
			}
			if (gutterElement.dataset.gutterBuffer === "annotation" && "lineAnnotation" in contentElement.dataset) {
				if (preTrimCount > 0 || hasPostTrim && visibleLineIndex >= postTrimStart) {
					gutterElement.remove();
					contentElement.remove();
					rowCount++;
				}
				continue;
			}
			if (gutterElement.dataset.gutterBuffer === "metadata" && "noNewline" in contentElement.dataset) {
				if (preTrimCount > 0 || hasPostTrim && visibleLineIndex >= postTrimStart) {
					gutterElement.remove();
					contentElement.remove();
					rowCount++;
				}
				continue;
			}
			if (gutterElement.dataset.gutterBuffer === "buffer" && "contentBuffer" in contentElement.dataset) {
				const totalRows = this.getBufferSize(contentElement.dataset);
				if (totalRows == null) throw new Error("FileDiff.trimColumnRows: invalid element");
				if (preTrimCount > 0) {
					const rowsToRemove = Math.min(preTrimCount, totalRows);
					const newSize = totalRows - rowsToRemove;
					if (newSize > 0) {
						this.updateBufferSize(gutterElement, newSize);
						this.updateBufferSize(contentElement, newSize);
						rowCount += rowsToRemove;
					} else {
						gutterElement.remove();
						contentElement.remove();
						rowCount += totalRows;
					}
					preTrimCount -= rowsToRemove;
					if (preTrimCount === 0 && newSize === 0) pendingMetadataTrim = true;
				} else if (hasPostTrim) {
					const bufferStart = visibleLineIndex;
					const bufferEnd = visibleLineIndex + totalRows - 1;
					if (postTrimStart <= bufferStart) {
						gutterElement.remove();
						contentElement.remove();
						rowCount += totalRows;
					} else if (postTrimStart <= bufferEnd) {
						const rowsToRemove = bufferEnd - postTrimStart + 1;
						const newSize = totalRows - rowsToRemove;
						this.updateBufferSize(gutterElement, newSize);
						this.updateBufferSize(contentElement, newSize);
						rowCount += rowsToRemove;
					}
				}
				visibleLineIndex += totalRows;
				continue;
			}
			console.error({
				gutterElement,
				contentElement
			});
			throw new Error("FileDiff.trimColumnRows: unknown row elements");
		}
		return rowCount;
	}
	trimColumns({ columns, diffStyle, overlapEnd, overlapStart, previousStart, trimEnd, trimStart }) {
		const preTrimCount = Math.max(0, overlapStart - previousStart);
		const postTrimStart = overlapEnd - previousStart;
		if (postTrimStart < 0) throw new Error("FileDiff.trimColumns: overlap ends before previous");
		const shouldTrimStart = trimStart > 0;
		const shouldTrimEnd = trimEnd > 0;
		if (!shouldTrimStart && !shouldTrimEnd) return 0;
		const effectivePreTrimCount = shouldTrimStart ? preTrimCount : 0;
		const effectivePostTrimStart = shouldTrimEnd ? postTrimStart : -1;
		if (diffStyle === "unified" && !Array.isArray(columns)) return this.trimColumnRows(columns, effectivePreTrimCount, effectivePostTrimStart);
		else if (diffStyle === "split" && Array.isArray(columns)) {
			const deletionsTrim = this.trimColumnRows(columns[0], effectivePreTrimCount, effectivePostTrimStart);
			const additionsTrim = this.trimColumnRows(columns[1], effectivePreTrimCount, effectivePostTrimStart);
			if (columns[0] != null && columns[1] != null && deletionsTrim !== additionsTrim) throw new Error("FileDiff.trimColumns: split columns out of sync");
			return columns[0] != null ? deletionsTrim : additionsTrim;
		} else {
			console.error({
				diffStyle,
				columns
			});
			throw new Error("FileDiff.trimColumns: Invalid columns for diffType");
		}
	}
	getBufferSize(properties) {
		const parsed = Number.parseInt(properties?.bufferSize ?? "", 10);
		return Number.isNaN(parsed) ? void 0 : parsed;
	}
	updateBufferSize(element, size) {
		element.dataset.bufferSize = `${size}`;
		element.style.setProperty("grid-row", `span ${size}`);
		element.style.setProperty("min-height", `calc(${size} * 1lh)`);
	}
	getCodeColumns(diffStyle, codeUnified, codeDeletions, codeAdditions) {
		function getColumns(code) {
			if (code == null) return;
			const gutter = code.children[0];
			const content = code.children[1];
			if (!(gutter instanceof HTMLElement) || !(content instanceof HTMLElement) || gutter.dataset.gutter == null || content.dataset.content == null) return;
			return {
				gutter,
				content
			};
		}
		if (diffStyle === "unified") return getColumns(codeUnified);
		else {
			const deletions = getColumns(codeDeletions);
			const additions = getColumns(codeAdditions);
			return deletions != null || additions != null ? [deletions, additions] : void 0;
		}
	}
	applyBuffers(pre, renderRange) {
		if (renderRange == null || this.shouldDisableVirtualizationBuffers()) {
			if (this.bufferBefore != null) {
				this.bufferBefore.remove();
				this.bufferBefore = void 0;
			}
			if (this.bufferAfter != null) {
				this.bufferAfter.remove();
				this.bufferAfter = void 0;
			}
			return;
		}
		if (renderRange.bufferBefore > 0) {
			if (this.bufferBefore == null) {
				this.bufferBefore = document.createElement("div");
				this.bufferBefore.dataset.virtualizerBuffer = "before";
				pre.before(this.bufferBefore);
			}
			this.bufferBefore.style.setProperty("height", `${renderRange.bufferBefore}px`);
			this.bufferBefore.style.setProperty("contain", "strict");
		} else if (this.bufferBefore != null) {
			this.bufferBefore.remove();
			this.bufferBefore = void 0;
		}
		if (renderRange.bufferAfter > 0) {
			if (this.bufferAfter == null) {
				this.bufferAfter = document.createElement("div");
				this.bufferAfter.dataset.virtualizerBuffer = "after";
				pre.after(this.bufferAfter);
			}
			this.bufferAfter.style.setProperty("height", `${renderRange.bufferAfter}px`);
			this.bufferAfter.style.setProperty("contain", "strict");
		} else if (this.bufferAfter != null) {
			this.bufferAfter.remove();
			this.bufferAfter = void 0;
		}
	}
	shouldDisableVirtualizationBuffers() {
		return this.options.disableVirtualizationBuffers ?? false;
	}
	applyPreNodeAttributes(pre, { additionsContentAST, deletionsContentAST, totalLines }, customProperties) {
		const { diffIndicators = "bars", disableBackground = false, disableLineNumbers = false, overflow = "scroll", diffStyle = "split" } = this.options;
		const preProperties = {
			type: "diff",
			diffIndicators,
			disableBackground,
			disableLineNumbers,
			overflow,
			split: diffStyle === "unified" ? false : additionsContentAST != null && deletionsContentAST != null,
			totalLines,
			customProperties
		};
		if (arePrePropertiesEqual(preProperties, this.appliedPreAttributes)) return;
		setPreNodeProperties(pre, preProperties);
		this.appliedPreAttributes = preProperties;
	}
	applyErrorToDOM(error, container) {
		this.cleanupErrorWrapper();
		this.pre?.remove();
		this.pre = void 0;
		this.appliedPreAttributes = void 0;
		const shadowRoot = container.shadowRoot ?? container.attachShadow({ mode: "open" });
		this.errorWrapper ??= document.createElement("div");
		this.errorWrapper.dataset.errorWrapper = "";
		this.errorWrapper.textContent = "";
		shadowRoot.appendChild(this.errorWrapper);
		const errorMessage = document.createElement("div");
		errorMessage.dataset.errorMessage = "";
		errorMessage.innerText = error.message;
		this.errorWrapper.appendChild(errorMessage);
		const errorStack = document.createElement("pre");
		errorStack.dataset.errorStack = "";
		errorStack.innerText = error.stack ?? "No Error Stack";
		this.errorWrapper.appendChild(errorStack);
	}
	cleanupErrorWrapper() {
		this.errorWrapper?.remove();
		this.errorWrapper = void 0;
	}
};
function hasDiffContent({ fileDiff, oldFile, newFile }) {
	return fileDiff != null && fileDiff.hunks.length > 0 || oldFile != null || newFile != null;
}
function hasDiffHeaderContent({ fileDiff, oldFile, newFile }) {
	return fileDiff != null || oldFile != null || newFile != null;
}
function shouldRenderCode(pre, hasContent, collapsed = false) {
	return !collapsed && pre == null && hasContent;
}
function shouldRenderHeader(headerElement, hasContent, disableFileHeader = false) {
	return headerElement == null && hasContent && !disableFileHeader;
}
function getElementChildren(node) {
	if (node == null || node.type !== "element") return;
	return node.children ?? [];
}
//#endregion
export { FileDiff };

//# sourceMappingURL=FileDiff.js.map