import { CUSTOM_HEADER_SLOT_ID, DEFAULT_THEMES, EMPTY_RENDER_RANGE, HEADER_METADATA_SLOT_ID, HEADER_PREFIX_SLOT_ID } from "../constants.js";
import { areThemesEqual } from "../utils/areThemesEqual.js";
import { isStyleNode } from "../utils/isStyleNode.js";
import { InteractionManager, pluckInteractionOptions } from "../managers/InteractionManager.js";
import { ResizeManager } from "../managers/ResizeManager.js";
import { areFilesEqual } from "../utils/areFilesEqual.js";
import { areRenderRangesEqual } from "../utils/areRenderRangesEqual.js";
import { getLineAnnotationName } from "../utils/getLineAnnotationName.js";
import { isFilePlainText } from "../utils/isFilePlainText.js";
import { FileRenderer } from "../renderers/FileRenderer.js";
import { SVGSpriteSheet } from "../sprite.js";
import { areLineAnnotationsEqual } from "../utils/areLineAnnotationsEqual.js";
import { arePrePropertiesEqual } from "../utils/arePrePropertiesEqual.js";
import { createAnnotationWrapperNode } from "../utils/createAnnotationWrapperNode.js";
import { createGutterUtilityContentNode } from "../utils/createGutterUtilityContentNode.js";
import { createUnsafeCSSStyleNode } from "../utils/createUnsafeCSSStyleNode.js";
import { getMeasuredScrollbarGutter } from "../utils/scrollbarGutter.js";
import { patchScrollbarGutterSize, wrapThemeCSS, wrapUnsafeCSS } from "../utils/cssWrappers.js";
import { getFileRendererOptions } from "../utils/getFileRendererOptions.js";
import { getOrCreateCodeNode } from "../utils/getOrCreateCodeNode.js";
import { upsertHostThemeStyle } from "../utils/hostTheme.js";
import { prerenderHTMLIfNecessary } from "../utils/prerenderHTMLIfNecessary.js";
import { setPreNodeProperties } from "../utils/setWrapperNodeProps.js";
import "./web-components.js";
import { toHtml } from "hast-util-to-html";
//#region src/components/File.ts
const EMPTY_STRINGS = [];
let instanceId = -1;
var File = class {
	options;
	workerManager;
	isContainerManaged;
	static LoadedCustomComponent = true;
	__id = `file:${++instanceId}`;
	type = "file";
	fileContainer;
	spriteSVG;
	pre;
	code;
	bufferBefore;
	bufferAfter;
	themeCSSStyle;
	appliedThemeCSS;
	hasAdoptedThemeCSS = false;
	unsafeCSSStyle;
	appliedUnsafeCSS;
	gutterUtilityContent;
	errorWrapper;
	placeHolder;
	lastRenderedHeaderHTML;
	cachedHeaderHTML;
	appliedPreAttributes;
	lastRowCount;
	mounted = false;
	headerElement;
	headerCustom;
	headerPrefix;
	headerMetadata;
	fileRenderer;
	resizeManager;
	interactionManager;
	annotationCache = /* @__PURE__ */ new Map();
	lineAnnotations = [];
	managersDirty = false;
	file;
	renderRange;
	enabled = true;
	constructor(options = { theme: DEFAULT_THEMES }, workerManager, isContainerManaged = false) {
		this.options = options;
		this.workerManager = workerManager;
		this.isContainerManaged = isContainerManaged;
		this.fileRenderer = new FileRenderer(options, this.handleHighlightRender, this.workerManager);
		this.resizeManager = new ResizeManager();
		this.interactionManager = new InteractionManager("file", pluckInteractionOptions(options));
		this.workerManager?.subscribeToThemeChanges(this);
	}
	handleHighlightRender = () => {
		this.rerender();
	};
	rerender() {
		if (!this.enabled || this.file == null) return;
		this.render({
			file: this.file,
			forceRender: true,
			renderRange: this.renderRange
		});
	}
	onThemeChange() {
		this.fileRenderer.clearRenderCache();
		this.rerender();
	}
	setOptions(options) {
		if (options == null) return;
		this.options = options;
		this.cachedHeaderHTML = void 0;
		this.syncInteractionOptions();
	}
	syncInteractionOptions() {
		this.interactionManager.setOptions(pluckInteractionOptions(this.options));
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
	setSelectedLines(range, options) {
		this.interactionManager.setSelection(range, options);
	}
	flushManagers() {
		if (!this.managersDirty || this.pre == null) {
			this.managersDirty = false;
			return;
		}
		const { overflow = "scroll" } = this.options;
		this.interactionManager.setup(this.pre);
		this.resizeManager.setup(this.pre, overflow === "wrap");
		this.managersDirty = false;
	}
	cleanUp(recycle = false) {
		this.emitPostRender(true);
		this.resizeManager.cleanUp();
		this.interactionManager.cleanUp();
		this.managersDirty = false;
		this.workerManager?.unsubscribeToThemeChanges(this);
		this.renderRange = void 0;
		if (!this.isContainerManaged) this.fileContainer?.remove();
		this.fileContainer = void 0;
		this.mounted = false;
		if (!recycle) this.lineAnnotations = [];
		this.annotationCache.clear();
		this.pre = void 0;
		this.bufferBefore = void 0;
		this.bufferAfter = void 0;
		this.appliedPreAttributes = void 0;
		this.lastRowCount = void 0;
		this.headerElement = void 0;
		this.headerPrefix = void 0;
		this.headerMetadata = void 0;
		this.headerCustom = void 0;
		this.lastRenderedHeaderHTML = void 0;
		if (!recycle) this.cachedHeaderHTML = void 0;
		this.errorWrapper = void 0;
		this.themeCSSStyle = void 0;
		this.appliedThemeCSS = void 0;
		this.hasAdoptedThemeCSS = false;
		this.unsafeCSSStyle = void 0;
		this.appliedUnsafeCSS = void 0;
		this.placeHolder = void 0;
		this.unsafeCSSStyle = void 0;
		if (recycle) this.fileRenderer.recycle();
		else {
			this.fileRenderer.cleanUp();
			this.workerManager = void 0;
			this.file = void 0;
		}
		this.enabled = false;
	}
	virtualizedSetup() {
		this.enabled = true;
		this.workerManager?.subscribeToThemeChanges(this);
	}
	hydrate(props) {
		const { fileContainer, prerenderedHTML, preventEmit = false, file, lineAnnotations } = props;
		this.hydrateElements(fileContainer, prerenderedHTML);
		if (shouldRenderCode(this.pre, file, this.options.collapsed) || shouldRenderHeader(this.headerElement, file, this.options.disableFileHeader)) this.render({
			...props,
			preventEmit: true
		});
		else this.hydrationSetup({
			file,
			lineAnnotations
		});
		if (!preventEmit) this.emitPostRender();
	}
	hydrateElements(fileContainer, prerenderedHTML) {
		if (this.fileContainer !== fileContainer) this.emitPostRender(true);
		prerenderHTMLIfNecessary(fileContainer, prerenderedHTML);
		for (const element of Array.from(fileContainer.shadowRoot?.children ?? [])) {
			if (element instanceof SVGElement) {
				this.spriteSVG = element;
				continue;
			}
			if (!(element instanceof HTMLElement)) continue;
			if (element instanceof HTMLPreElement) {
				this.pre = element;
				this.appliedPreAttributes = void 0;
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
			if ("diffsHeader" in element.dataset) {
				this.headerElement = element;
				this.lastRenderedHeaderHTML = void 0;
				continue;
			}
		}
		if (this.pre != null) {
			this.syncCodeNodeFromPre(this.pre);
			this.pre.removeAttribute("data-dehydrated");
		}
		this.fileContainer = fileContainer;
		this.hydrateMeasuredScrollbar();
	}
	hydrationSetup({ file, lineAnnotations }) {
		this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
		this.file = file;
		this.fileRenderer.setOptions(getFileRendererOptions(this.options));
		this.syncInteractionOptions();
		if (this.pre == null) return;
		this.fileRenderer.hydrate(file);
		this.renderAnnotations();
		this.renderGutterUtility();
		this.injectUnsafeCSS();
		this.managersDirty = true;
		this.flushManagers();
	}
	getOrCreateLineCache(file = this.file) {
		return file != null ? this.fileRenderer.getOrCreateLineCache(file) : EMPTY_STRINGS;
	}
	render({ file, fileContainer, forceRender = false, preventEmit = false, containerWrapper, deferManagers = false, lineAnnotations, renderRange }) {
		const { collapsed = false, themeType = "system" } = this.options;
		if (!this.enabled) throw new Error("File.render: attempting to call render after cleaned up");
		const nextRenderRange = collapsed ? void 0 : renderRange;
		const previousRenderRange = this.renderRange;
		const themeChanged = this.hasThemeChanged();
		const annotationsChanged = lineAnnotations != null && (lineAnnotations.length > 0 || this.lineAnnotations.length > 0) ? lineAnnotations !== this.lineAnnotations : false;
		const didFileChange = !areFilesEqual(this.file, file);
		if (!collapsed && !forceRender && areRenderRangesEqual(nextRenderRange, this.renderRange) && !didFileChange && !annotationsChanged && !themeChanged) return this.applyCachedThemeState(themeType);
		this.renderRange = nextRenderRange;
		if (didFileChange) this.cachedHeaderHTML = void 0;
		this.file = file;
		this.fileRenderer.setOptions(getFileRendererOptions(this.options));
		this.syncInteractionOptions();
		if (lineAnnotations != null) this.setLineAnnotations(lineAnnotations);
		this.fileRenderer.setLineAnnotations(this.lineAnnotations);
		const { disableErrorHandling = false, disableFileHeader = false } = this.options;
		if (disableFileHeader) {
			if (this.headerElement != null) {
				this.headerElement.remove();
				this.headerElement = void 0;
				this.lastRenderedHeaderHTML = void 0;
			}
			this.clearHeaderSlots();
		}
		fileContainer = this.getOrCreateFileContainerNode(fileContainer, containerWrapper);
		this.applyCachedThemeState(themeType);
		if (collapsed) {
			this.removeRenderedCode();
			this.clearAuxiliaryNodes();
			try {
				const fileResult = this.fileRenderer.renderFile(file, EMPTY_RENDER_RANGE);
				if (fileResult != null) this.applyThemeState(fileContainer, fileResult.themeStyles, themeType, fileResult.baseThemeType);
				if (fileResult?.headerAST != null) this.applyHeaderToDOM(fileResult.headerAST, fileContainer);
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
			if (!this.canPartiallyRender(forceRender, annotationsChanged, didFileChange || themeChanged) || !this.applyPartialRender(previousRenderRange, nextRenderRange)) {
				const fileResult = this.fileRenderer.renderFile(file, nextRenderRange);
				if (fileResult == null) {
					if (this.workerManager?.isInitialized() === false) this.workerManager.initialize().then(() => this.rerender());
					return false;
				}
				this.applyThemeState(fileContainer, fileResult.themeStyles, themeType, fileResult.baseThemeType);
				if (fileResult.headerAST != null) this.applyHeaderToDOM(fileResult.headerAST, fileContainer);
				this.applyFullRender(fileResult, pre);
			}
			this.applyBuffers(pre, nextRenderRange);
			this.injectUnsafeCSS();
			this.managersDirty = true;
			if (!deferManagers) this.flushManagers();
			this.renderAnnotations();
			this.renderGutterUtility();
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
			onPostRender?.(fileContainer, this, "unmount");
			return;
		}
		if (fileContainer == null) return;
		const phase = this.mounted ? "update" : "mount";
		this.mounted = true;
		onPostRender?.(fileContainer, this, phase);
	}
	removeRenderedCode() {
		this.resizeManager.cleanUp();
		this.interactionManager.cleanUp();
		this.bufferBefore?.remove();
		this.bufferBefore = void 0;
		this.bufferAfter?.remove();
		this.bufferAfter = void 0;
		this.code?.remove();
		this.code = void 0;
		this.pre?.remove();
		this.pre = void 0;
		this.appliedPreAttributes = void 0;
		this.lastRowCount = void 0;
	}
	clearAuxiliaryNodes() {
		for (const { element } of this.annotationCache.values()) element.remove();
		this.annotationCache.clear();
		this.gutterUtilityContent?.remove();
		this.gutterUtilityContent = void 0;
	}
	canPartiallyRender(forceRender, annotationsChanged, didContentChange) {
		if (forceRender || annotationsChanged || didContentChange) return false;
		return true;
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
		const { file, workerManager } = this;
		if (file == null || file.cacheKey == null || workerManager == null || isFilePlainText(file)) return;
		if (this.fileRenderer.getOrCreateLineCache(file).length > (this.options.tokenizeMaxLength ?? 1e5)) return;
		workerManager.primeFileHighlightCache(file);
	}
	cleanChildNodes() {
		this.resizeManager.cleanUp();
		this.interactionManager.cleanUp();
		this.bufferAfter?.remove();
		this.bufferBefore?.remove();
		this.code?.remove();
		this.errorWrapper?.remove();
		this.headerElement?.remove();
		this.gutterUtilityContent?.remove();
		this.headerPrefix?.remove();
		this.headerMetadata?.remove();
		this.headerCustom?.remove();
		this.pre?.remove();
		this.spriteSVG?.remove();
		this.themeCSSStyle?.remove();
		this.unsafeCSSStyle?.remove();
		this.bufferAfter = void 0;
		this.bufferBefore = void 0;
		this.code = void 0;
		this.errorWrapper = void 0;
		this.headerElement = void 0;
		this.gutterUtilityContent = void 0;
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
			if (cache == null || !areLineAnnotationsEqual(annotation, cache.annotation)) {
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
	applyFullRender(result, pre) {
		this.cleanupErrorWrapper();
		this.applyPreNodeAttributes(pre, result);
		this.code = getOrCreateCodeNode({ code: this.code });
		this.code.innerHTML = this.fileRenderer.renderPartialHTML(this.fileRenderer.renderCodeAST(result));
		pre.replaceChildren(this.code);
		this.lastRowCount = result.rowCount;
	}
	applyPartialRender(previousRenderRange, renderRange) {
		if (previousRenderRange == null || renderRange == null) return false;
		const { file, code } = this;
		const columns = code != null ? this.getColumns(code) : void 0;
		if (file == null || code == null || columns == null) return false;
		const previousStart = previousRenderRange.startingLine;
		const nextStart = renderRange.startingLine;
		const previousEnd = previousRenderRange.totalLines === Infinity ? Number.POSITIVE_INFINITY : previousStart + previousRenderRange.totalLines;
		const nextEnd = renderRange.totalLines === Infinity ? Number.POSITIVE_INFINITY : nextStart + renderRange.totalLines;
		const overlapStart = Math.max(previousStart, nextStart);
		const overlapEnd = Math.min(previousEnd, nextEnd);
		if (overlapEnd <= overlapStart) return false;
		if (!this.trimDOMToOverlap(columns.gutter, overlapStart, overlapEnd) || !this.trimDOMToOverlap(columns.content, overlapStart, overlapEnd)) return false;
		let { length: rowCount } = columns.content.children;
		const renderChunk = (startingLine, totalLines) => {
			if (totalLines <= 0) return;
			return this.fileRenderer.renderFile(file, {
				startingLine,
				totalLines,
				bufferBefore: 0,
				bufferAfter: 0
			});
		};
		const prependResult = nextStart < overlapStart ? renderChunk(nextStart, overlapStart - nextStart) : void 0;
		if (prependResult === void 0 && nextStart < overlapStart) return false;
		const appendTotalLines = nextEnd === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, nextEnd - overlapEnd);
		const appendResult = nextEnd > overlapEnd ? renderChunk(overlapEnd, appendTotalLines) : void 0;
		if (appendResult === void 0 && nextEnd > overlapEnd) return false;
		this.cleanupErrorWrapper();
		if (prependResult != null) {
			columns.gutter.insertAdjacentHTML("afterbegin", this.fileRenderer.renderPartialHTML(prependResult.gutterAST));
			columns.content.insertAdjacentHTML("afterbegin", this.fileRenderer.renderPartialHTML(prependResult.contentAST));
			rowCount += prependResult.rowCount;
		}
		if (appendResult != null) {
			columns.gutter.insertAdjacentHTML("beforeend", this.fileRenderer.renderPartialHTML(appendResult.gutterAST));
			columns.content.insertAdjacentHTML("beforeend", this.fileRenderer.renderPartialHTML(appendResult.contentAST));
			rowCount += appendResult.rowCount;
		}
		if (this.lastRowCount !== rowCount) {
			columns.gutter.style.setProperty("grid-row", `span ${rowCount}`);
			columns.content.style.setProperty("grid-row", `span ${rowCount}`);
			this.lastRowCount = rowCount;
		}
		return true;
	}
	getColumns(code) {
		const gutter = code.children[0];
		const content = code.children[1];
		if (!(gutter instanceof HTMLElement) || !(content instanceof HTMLElement) || gutter.dataset.gutter == null || content.dataset.content == null) return;
		return {
			gutter,
			content
		};
	}
	trimDOMToOverlap(container, overlapStart, overlapEnd) {
		const boundaryIndices = this.getDOMBoundaryIndices(container, [overlapStart, overlapEnd]);
		const startIndex = boundaryIndices.get(overlapStart) ?? container.children.length;
		const endIndex = boundaryIndices.get(overlapEnd) ?? container.children.length;
		if (startIndex > endIndex) return false;
		for (let i = container.children.length - 1; i >= endIndex; i -= 1) container.children[i]?.remove();
		for (let i = startIndex - 1; i >= 0; i -= 1) container.children[i]?.remove();
		return true;
	}
	getDOMBoundaryIndices(container, boundaries) {
		const sortedBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
		const boundaryIndices = /* @__PURE__ */ new Map();
		if (sortedBoundaries.length === 0) return boundaryIndices;
		let boundaryIndex = 0;
		let nextBoundary = sortedBoundaries[boundaryIndex];
		const { children } = container;
		if (nextBoundary === 0) {
			boundaryIndices.set(0, 0);
			boundaryIndex += 1;
			nextBoundary = sortedBoundaries[boundaryIndex];
		}
		for (let i = 0; i < children.length; i += 1) {
			const child = children[i];
			if (!(child instanceof HTMLElement)) continue;
			const lineIndex = this.getLineIndexFromDOMNode(child);
			if (lineIndex == null) continue;
			while (nextBoundary != null && lineIndex >= nextBoundary) {
				boundaryIndices.set(nextBoundary, i);
				boundaryIndex += 1;
				nextBoundary = sortedBoundaries[boundaryIndex];
			}
			if (boundaryIndex >= sortedBoundaries.length) break;
		}
		for (const boundary of sortedBoundaries) if (!boundaryIndices.has(boundary)) boundaryIndices.set(boundary, children.length);
		return boundaryIndices;
	}
	getLineIndexFromDOMNode(node) {
		const lineIndexAttr = node.dataset.lineIndex;
		if (lineIndexAttr == null) return;
		const parsed = Number(lineIndexAttr);
		return Number.isNaN(parsed) ? void 0 : parsed;
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
	applyHeaderToDOM(headerAST, container) {
		const { file } = this;
		if (file == null) return;
		this.cleanupErrorWrapper();
		this.placeHolder?.remove();
		this.placeHolder = void 0;
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
		if (this.isContainerManaged) return;
		const { renderHeaderPrefix, renderCustomHeader, renderHeaderMetadata } = this.options;
		if (renderCustomHeader != null) {
			const content = renderCustomHeader(file) ?? void 0;
			this.headerCustom = this.upsertHeaderSlotElement(container, this.headerCustom, CUSTOM_HEADER_SLOT_ID, content);
			this.headerPrefix?.remove();
			this.headerMetadata?.remove();
			this.headerPrefix = void 0;
			this.headerMetadata = void 0;
		} else {
			const prefix = renderHeaderPrefix?.(file) ?? void 0;
			const content = renderHeaderMetadata?.(file) ?? void 0;
			this.headerPrefix = this.upsertHeaderSlotElement(container, this.headerPrefix, HEADER_PREFIX_SLOT_ID, prefix);
			this.headerMetadata = this.upsertHeaderSlotElement(container, this.headerMetadata, HEADER_METADATA_SLOT_ID, content);
			this.headerCustom?.remove();
			this.headerCustom = void 0;
		}
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
	getOrCreateFileContainerNode(fileContainer, parentNode) {
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
			this.code = void 0;
			shadowRoot.appendChild(this.pre);
		} else if (this.pre.parentNode !== shadowRoot) {
			container.shadowRoot?.appendChild(this.pre);
			this.appliedPreAttributes = void 0;
		}
		this.placeHolder?.remove();
		this.placeHolder = void 0;
		return this.pre;
	}
	syncCodeNodeFromPre(pre) {
		this.code = void 0;
		for (const child of Array.from(pre.children)) {
			if (!(child instanceof HTMLElement)) continue;
			if (child.hasAttribute("data-code")) {
				this.code = child;
				return;
			}
		}
	}
	applyPreNodeAttributes(pre, { totalLines }) {
		const { overflow = "scroll", disableLineNumbers = false } = this.options;
		const preProperties = {
			type: "file",
			split: false,
			overflow,
			disableLineNumbers,
			diffIndicators: "none",
			disableBackground: true,
			totalLines
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
function shouldRenderCode(pre, file, collapsed = false) {
	return !collapsed && pre == null && file != null;
}
function shouldRenderHeader(headerElement, file, disableFileHeader = false) {
	return headerElement == null && file != null && !disableFileHeader;
}
//#endregion
export { File };

//# sourceMappingURL=File.js.map