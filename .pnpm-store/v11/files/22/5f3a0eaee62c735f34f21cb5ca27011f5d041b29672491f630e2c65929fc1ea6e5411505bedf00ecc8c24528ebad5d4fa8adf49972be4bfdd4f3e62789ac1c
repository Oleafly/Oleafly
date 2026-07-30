import { DEFAULT_CODE_VIEW_FILE_METRICS, DEFAULT_CODE_VIEW_LAYOUT, DEFAULT_SMOOTH_SCROLL_SETTINGS, DEFAULT_THEMES, DIFFS_DEVELOPMENT_BUILD, DIFFS_TAG_NAME } from "../constants.js";
import { dequeueRender, queueRender } from "../managers/UniversalRenderingManager.js";
import { areObjectsEqual } from "../utils/areObjectsEqual.js";
import { areThemesEqual } from "../utils/areThemesEqual.js";
import { areOptionsEqual } from "../utils/areOptionsEqual.js";
import { areSelectionsEqual } from "../utils/areSelectionsEqual.js";
import { createWindowFromScrollPosition } from "../utils/createWindowFromScrollPosition.js";
import { isStyleNode } from "../utils/isStyleNode.js";
import { prefersReducedMotion } from "../utils/prefersReducedMotion.js";
import { roundToDevicePixel } from "../utils/roundToDevicePixel.js";
import { VirtualizedFile } from "./VirtualizedFile.js";
import { VirtualizedFileDiff } from "./VirtualizedFileDiff.js";
//#region src/components/CodeView.ts
const CODE_VIEW_DIFF_OPTION_KEYS = [
	"theme",
	"disableLineNumbers",
	"overflow",
	"themeType",
	"disableFileHeader",
	"disableVirtualizationBuffers",
	"preferredHighlighter",
	"useCSSClasses",
	"useTokenTransformer",
	"tokenizeMaxLineLength",
	"tokenizeMaxLength",
	"unsafeCSS",
	"diffStyle",
	"diffIndicators",
	"disableBackground",
	"expandUnchanged",
	"collapsedContextThreshold",
	"lineDiffType",
	"maxLineDiffLength",
	"expansionLineCount",
	"lineHoverHighlight",
	"enableTokenInteractionsOnWhitespace",
	"enableGutterUtility",
	"__debugPointerEvents",
	"enableLineSelection",
	"controlledSelection",
	"disableErrorHandling"
];
const CODE_VIEW_FILE_OPTION_KEYS = [
	"theme",
	"disableLineNumbers",
	"overflow",
	"themeType",
	"disableFileHeader",
	"disableVirtualizationBuffers",
	"preferredHighlighter",
	"useCSSClasses",
	"useTokenTransformer",
	"tokenizeMaxLineLength",
	"tokenizeMaxLength",
	"unsafeCSS",
	"lineHoverHighlight",
	"enableTokenInteractionsOnWhitespace",
	"enableGutterUtility",
	"__debugPointerEvents",
	"enableLineSelection",
	"controlledSelection",
	"disableErrorHandling"
];
const CODE_VIEW_SHARED_CALLBACK_KEYS = [
	"renderCustomHeader",
	"renderHeaderPrefix",
	"renderHeaderMetadata",
	"renderAnnotation",
	"renderGutterUtility",
	"onPostRender",
	"onGutterUtilityClick",
	"onLineClick",
	"onLineNumberClick",
	"onLineEnter",
	"onLineLeave",
	"onTokenClick",
	"onTokenEnter",
	"onTokenLeave"
];
const CODE_VIEW_SELECTION_CALLBACK_KEYS = [
	"onLineSelected",
	"onLineSelectionStart",
	"onLineSelectionChange",
	"onLineSelectionEnd"
];
const CODE_VIEW_ITEM_OPTIONS_STATE = Symbol("CodeView.itemOptionsState");
function defineOptionsState(options, state) {
	Object.defineProperty(options, CODE_VIEW_ITEM_OPTIONS_STATE, {
		configurable: false,
		enumerable: false,
		value: state
	});
}
function getItemOptionsState(options) {
	return options[CODE_VIEW_ITEM_OPTIONS_STATE];
}
function defineItemOption(target, key, get) {
	Object.defineProperty(target, key, {
		configurable: false,
		enumerable: true,
		get() {
			return get(this);
		}
	});
}
const DEFAULT_SCROLL_INTERACTION_RESTORE_DELAY_MS = 120;
const SCROLLING_CODE_OVERFLOW_FIX_VARIABLE = "--diffs-overflow-override";
const SCROLL_REBASE_CONTAINER_HEIGHT = 12e6;
const SCROLL_REBASE_TRIGGER_TOP = 1e6;
const SCROLL_REBASE_TARGET_TOP = 2e6;
const SCROLL_REBASE_TARGET_BOTTOM = SCROLL_REBASE_CONTAINER_HEIGHT - SCROLL_REBASE_TARGET_TOP;
const SCROLL_REBASE_THRESHOLD = SCROLL_REBASE_CONTAINER_HEIGHT - SCROLL_REBASE_TRIGGER_TOP;
const MOBILE_SAFARI = (() => {
	const { navigator } = globalThis;
	const userAgent = navigator.userAgent;
	const isIOS = /iP(?:hone|ad|od)/.test(userAgent);
	const isIPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
	return (isIOS || isIPadOS) && /AppleWebKit/.test(userAgent) && /Safari/.test(userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(userAgent);
})();
var CodeView = class CodeView {
	static __STOP = false;
	static __lastScrollPosition = 0;
	type = "advanced";
	config = {
		overscrollSize: 200,
		intersectionObserverMargin: 0,
		resizeDebugging: false
	};
	items = [];
	idToItem = /* @__PURE__ */ new Map();
	selectedLines = null;
	instanceToItem = /* @__PURE__ */ new Map();
	layoutDirtyIndex;
	pendingLayoutReset;
	renderOptionsRevision = 0;
	slotCoordinator;
	slotSnapshot;
	scrollListeners = /* @__PURE__ */ new Set();
	scrollHeight = 0;
	containerHeight = -1;
	scrollTop = 0;
	scrollPageOffset = 0;
	scrollDirty = true;
	scrollInteractionFixTimer;
	pointerEventsDisabled = false;
	codeOverflowFix = false;
	height = 0;
	heightDirty = true;
	windowSpecs = {
		top: 0,
		bottom: 0
	};
	renderState = {
		scrollTop: -1,
		firstIndex: -1,
		lastIndex: -1,
		stickyHeight: 0,
		stickyTop: -1,
		stickyBottom: -1
	};
	itemMetricsCache = DEFAULT_CODE_VIEW_FILE_METRICS;
	fileOptionsPrototype;
	diffOptionsPrototype;
	pendingScrollTarget;
	pendingLayoutAnchor;
	shouldFixContainerFocus = false;
	scrollAnimation;
	root;
	resizeObserver;
	container = document.createElement("div");
	stickyContainer = document.createElement("div");
	stickyOffset = document.createElement("div");
	elementPool = [];
	elementPoolVersion = 0;
	elementPoolTracker = /* @__PURE__ */ new WeakMap();
	pendingElementPool = [];
	options;
	workerManager;
	isContainerManaged;
	constructor(options = { theme: DEFAULT_THEMES }, workerManager, isContainerManaged = false) {
		this.options = options;
		this.computeMetricsCache(options.itemMetrics);
		this.fileOptionsPrototype = this.createFileOptionsPrototype();
		this.diffOptionsPrototype = this.createDiffOptionsPrototype();
		this.workerManager = workerManager;
		this.isContainerManaged = isContainerManaged;
		this.stickyOffset.style.contain = "layout size";
		this.stickyContainer.style.position = "sticky";
		this.stickyContainer.style.width = "100%";
		this.stickyContainer.style.contain = "layout style inline-size";
		this.stickyContainer.style.isolation = "isolate";
		this.stickyContainer.style.display = "flex";
		this.stickyContainer.style.flexDirection = "column";
	}
	getLayout() {
		return this.options.layout ?? DEFAULT_CODE_VIEW_LAYOUT;
	}
	computeMetricsCache(itemMetrics) {
		this.itemMetricsCache = {
			hunkLineCount: itemMetrics?.hunkLineCount ?? DEFAULT_CODE_VIEW_FILE_METRICS.hunkLineCount,
			lineHeight: itemMetrics?.lineHeight ?? DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight,
			diffHeaderHeight: itemMetrics?.diffHeaderHeight ?? DEFAULT_CODE_VIEW_FILE_METRICS.diffHeaderHeight,
			hunkSeparatorHeight: itemMetrics?.hunkSeparatorHeight,
			spacing: itemMetrics?.spacing ?? DEFAULT_CODE_VIEW_FILE_METRICS.spacing,
			paddingTop: itemMetrics?.paddingTop,
			paddingBottom: itemMetrics?.paddingBottom
		};
		return this.itemMetricsCache;
	}
	getSmoothScrollSettings() {
		return this.options.smoothScrollSettings ?? DEFAULT_SMOOTH_SCROLL_SETTINGS;
	}
	shouldDisablePointerEvents() {
		return this.options.pointerEventsOnScroll !== true;
	}
	shouldValidateItemHeights() {
		return DIFFS_DEVELOPMENT_BUILD && this.options.__devOnlyValidateItemHeights === true;
	}
	validateRenderedItemHeight(item) {
		if (!this.shouldValidateItemHeights() || item.element == null) return;
		const stickySpecs = item.instance.getAdvancedStickySpecs();
		if (stickySpecs == null) return;
		const expectedHeight = stickySpecs.height;
		const actualHeight = item.element.getBoundingClientRect().height;
		if (expectedHeight === actualHeight) return;
		console.error("CodeView: reconciled item height does not match DOM height", {
			id: item.item.id,
			type: item.type,
			index: item.index,
			version: item.version,
			expectedHeight,
			actualHeight,
			delta: actualHeight - expectedHeight,
			stickyTopOffset: stickySpecs.topOffset,
			virtualizedHeight: item.instance.getVirtualizedHeight(),
			top: item.top,
			scrollTop: this.getScrollTop(),
			windowSpecs: { ...this.windowSpecs },
			element: item.element,
			instance: item.instance
		});
	}
	validateStickyContainerHeight() {
		if (!this.shouldValidateItemHeights()) return;
		const { firstIndex, lastIndex, stickyHeight, stickyTop, stickyBottom } = this.renderState;
		if (firstIndex === -1 || lastIndex === -1) return;
		const actualHeight = this.stickyContainer.getBoundingClientRect().height;
		if (Math.abs(actualHeight - stickyHeight) < 1) return;
		console.error("CodeView: sticky container height does not match computed layout", {
			computedStickyHeight: stickyHeight,
			actualStickyHeight: actualHeight,
			delta: actualHeight - stickyHeight,
			stickyTop,
			stickyBottom,
			firstIndex,
			lastIndex,
			firstStickySpecs: this.items[firstIndex]?.instance.getAdvancedStickySpecs(),
			lastStickySpecs: this.items[lastIndex]?.instance.getAdvancedStickySpecs(),
			scrollTop: this.getScrollTop(),
			scrollPageOffset: this.scrollPageOffset,
			windowSpecs: { ...this.windowSpecs },
			stickyContainer: this.stickyContainer
		});
	}
	clearScrollInteractionTimer() {
		if (this.scrollInteractionFixTimer != null) {
			clearTimeout(this.scrollInteractionFixTimer);
			this.scrollInteractionFixTimer = void 0;
		}
	}
	suspendScrollInteractions() {
		this.clearScrollInteractionTimer();
		if (this.shouldDisablePointerEvents() && !this.pointerEventsDisabled) {
			this.stickyContainer.style.pointerEvents = "none";
			this.pointerEventsDisabled = true;
		}
		if (MOBILE_SAFARI && !this.codeOverflowFix) {
			this.stickyContainer.style.setProperty(SCROLLING_CODE_OVERFLOW_FIX_VARIABLE, "hidden");
			this.codeOverflowFix = true;
		}
		this.scrollInteractionFixTimer = setTimeout(this.restoreScrollInteractions, DEFAULT_SCROLL_INTERACTION_RESTORE_DELAY_MS);
	}
	restoreScrollInteractions = () => {
		this.clearScrollInteractionTimer();
		if (this.pointerEventsDisabled) {
			this.stickyContainer.style.removeProperty("pointer-events");
			this.pointerEventsDisabled = false;
		}
		if (this.codeOverflowFix) {
			this.stickyContainer.style.setProperty(SCROLLING_CODE_OVERFLOW_FIX_VARIABLE, "auto");
			this.codeOverflowFix = false;
		}
	};
	syncLayout() {
		const { gap, paddingBottom, paddingTop } = this.getLayout();
		this.stickyContainer.style.gap = `${gap}px`;
		this.container?.style.setProperty("margin-top", `${paddingTop}px`);
		this.container?.style.setProperty("margin-bottom", `${paddingBottom}px`);
	}
	setup(root) {
		if (this.root != null) throw new Error("CodeView.setup: already setup");
		this.workerManager?.subscribeToThemeChanges(this);
		this.root = root;
		this.root.style.overflowAnchor = "none";
		if (!this.root.hasAttribute("tabindex")) this.root.tabIndex = -1;
		this.container ??= document.createElement("div");
		this.container.style.contain = "layout style";
		this.syncLayout();
		this.container.appendChild(this.stickyOffset);
		this.container.appendChild(this.stickyContainer);
		this.root.appendChild(this.container);
		this.scrollDirty = true;
		this.heightDirty = true;
		this.resizeObserver = new ResizeObserver(this.handleResize);
		this.resizeObserver.observe(this.stickyContainer);
		this.root.addEventListener("scroll", this.handleScroll, { passive: true });
		this.root.addEventListener("wheel", this.clearPendingScroll, { passive: true });
		this.root.addEventListener("touchstart", this.clearPendingScroll, { passive: true });
		this.root.addEventListener("pointerdown", this.clearPendingScroll, { passive: true });
		this.root.addEventListener("keydown", this.clearPendingScroll, { passive: true });
		this.resizeObserver.observe(this.root);
		this.render(true);
		window.__INSTANCE = this;
		window.__TOGGLE = () => {
			if (CodeView.__STOP) {
				CodeView.__STOP = false;
				this.scrollTo({
					type: "position",
					position: CodeView.__lastScrollPosition,
					behavior: "instant"
				});
			} else {
				CodeView.__lastScrollPosition = this.getScrollTop();
				CodeView.__STOP = true;
			}
		};
	}
	reset() {
		this.restoreScrollInteractions();
		this.cleanAllRenderedItems();
		this.selectedLines = null;
		this.items.length = 0;
		this.idToItem.clear();
		this.instanceToItem.clear();
		this.layoutDirtyIndex = void 0;
		this.pendingLayoutReset = void 0;
		this.stickyContainer.textContent = "";
		this.stickyOffset.style.height = "";
		this.container?.style.removeProperty("height");
		this.containerHeight = -1;
		this.windowSpecs = {
			top: 0,
			bottom: 0
		};
		this.pendingLayoutAnchor = void 0;
		this.shouldFixContainerFocus = false;
		this.height = 0;
		this.scrollTop = 0;
		this.scrollPageOffset = 0;
		this.scrollHeight = 0;
		this.scrollDirty = true;
		this.heightDirty = true;
		this.resetRenderState();
		if (!this.isContainerManaged) this.flushSlotCoordinator();
	}
	cleanUp() {
		this.reset();
		this.clearElementPool();
		this.restoreScrollInteractions();
		this.workerManager?.unsubscribeToThemeChanges(this);
		this.resizeObserver?.disconnect();
		this.resizeObserver = void 0;
		this.root?.removeEventListener("scroll", this.handleScroll);
		this.root?.removeEventListener("wheel", this.clearPendingScroll);
		this.root?.removeEventListener("touchstart", this.clearPendingScroll);
		this.root?.removeEventListener("pointerdown", this.clearPendingScroll);
		this.root?.removeEventListener("keydown", this.clearPendingScroll);
		this.root?.style.removeProperty("overflow-anchor");
		this.container?.remove();
		this.stickyOffset.remove();
		this.stickyContainer.remove();
		this.stickyContainer.textContent = "";
		this.root = void 0;
		this.container = void 0;
	}
	cleanAllRenderedItems() {
		if (this.renderState.firstIndex === -1) return;
		for (let index = this.renderState.firstIndex; index <= this.renderState.lastIndex; index++) {
			const item = this.items[index];
			if (item == null) throw new Error(`CodeView.cleanAllRenderedItems: Item does not exist at index: ${index}`);
			this.releaseRenderedItem(item);
		}
	}
	primeScrollTarget(target) {
		if (target.type === "position") return;
		const item = this.idToItem.get(target.id);
		if (item == null) return;
		item.instance.primeHighlightCache();
	}
	getElementPoolLimit() {
		const viewportSize = this.getHeight() + this.config.overscrollSize * 2;
		const { diffHeaderHeight } = this.itemMetricsCache;
		return Math.max(8, Math.ceil(viewportSize / Math.max(diffHeaderHeight, 10)) + 1) * (this.isContainerManaged ? 2 : 1);
	}
	acquireElement() {
		this.promotePendingPooledElements();
		let element = this.elementPool.pop();
		while (element != null && !this.isElementPoolGenerationCurrent(element)) element = this.elementPool.pop();
		element ??= document.createElement(DIFFS_TAG_NAME);
		this.markElementPoolGenerationCurrent(element);
		return element;
	}
	releaseRenderedItem(item) {
		const { element } = item;
		if (element != null && this.renderedItemOwnsFocus(element)) this.shouldFixContainerFocus = true;
		item.instance.cleanUp(true);
		item.element = void 0;
		if (element == null) return;
		element.remove();
		this.cleanElement(element);
		this.queueElementForPool(element);
	}
	renderedItemOwnsFocus(element) {
		const { activeElement } = document;
		return activeElement === element || element.contains(activeElement) || element.shadowRoot?.activeElement != null;
	}
	fixContainerFocus() {
		if (this.shouldFixContainerFocus) {
			this.shouldFixContainerFocus = false;
			this.root?.focus({ preventScroll: true });
		}
	}
	cleanElement(element) {
		const { shadowRoot } = element;
		if (shadowRoot != null) {
			for (const child of Array.from(shadowRoot.children)) if (!isPooledShadowChild(child)) child.remove();
		}
		if (!this.isContainerManaged) element.replaceChildren();
	}
	queueElementForPool(element) {
		const poolLimit = this.getElementPoolLimit();
		if (!this.isElementPoolGenerationCurrent(element) || this.getElementPoolSize() >= poolLimit) return;
		if (this.isElementClean(element)) this.elementPool.push(element);
		else this.pendingElementPool.push(element);
	}
	promotePendingPooledElements() {
		if (this.pendingElementPool.length === 0) return;
		const { pendingElementPool: pendingElements } = this;
		this.pendingElementPool = [];
		const poolLimit = this.getElementPoolLimit();
		for (const element of pendingElements) if (this.isElementPoolGenerationCurrent(element) && this.isElementClean(element) && this.elementPool.length < poolLimit) this.elementPool.push(element);
		else if (this.isElementPoolGenerationCurrent(element) && this.getElementPoolSize() < poolLimit) this.pendingElementPool.push(element);
	}
	isElementClean(element) {
		return element.childNodes.length === 0;
	}
	getElementPoolSize() {
		return this.elementPool.length + this.pendingElementPool.length;
	}
	clearElementPool() {
		this.elementPool.length = 0;
		this.pendingElementPool.length = 0;
	}
	invalidateElementPool() {
		this.elementPoolVersion++;
		this.clearElementPool();
	}
	markElementPoolGenerationCurrent(element) {
		this.elementPoolTracker.set(element, this.elementPoolVersion);
	}
	isElementPoolGenerationCurrent(element) {
		return this.elementPoolTracker.get(element) === this.elementPoolVersion;
	}
	resolveEffectiveScrollBehavior(target, destination) {
		if (prefersReducedMotion()) return "instant";
		if (target.behavior !== "smooth-auto") return target.behavior ?? "instant";
		return Math.abs(destination - this.getScrollTop()) <= this.getHeight() * 10 ? "smooth" : "instant";
	}
	scrollTo(target) {
		if (this.root == null) return;
		const pendingTarget = this.normalizeScrollTarget(target);
		if (pendingTarget == null) return;
		const destination = this.resolveScrollTargetTop(pendingTarget);
		if (destination == null) return;
		this.primeScrollTarget(pendingTarget);
		if (this.resolveEffectiveScrollBehavior(pendingTarget, destination) === "smooth") this.scrollAnimation ??= {
			position: this.getScrollTop(),
			velocity: 0,
			lastTimestamp: performance.now()
		};
		else this.scrollAnimation = void 0;
		this.suspendScrollInteractions();
		this.pendingLayoutAnchor = void 0;
		this.pendingScrollTarget = pendingTarget;
		this.render();
	}
	setSelectedLines(selection, options) {
		this.applySelectedLines(selection, options);
	}
	getSelectedLines() {
		return this.selectedLines;
	}
	clearSelectedLines(options) {
		this.applySelectedLines(null, options);
	}
	getItem(itemId) {
		return this.idToItem.get(itemId)?.item;
	}
	updateItem(input) {
		const item = this.idToItem.get(input.id);
		if (item == null) {
			console.error(`CodeView.updateItem: unknown item id "${input.id}"`);
			return false;
		}
		if (!this.syncItemRecord(item, input)) return false;
		this.markItemLayoutDirty(item);
		this.scrollDirty = true;
		this.render();
		this.syncSelection();
		return true;
	}
	updateItemId(oldId, newId) {
		if (oldId === newId) return true;
		const item = this.idToItem.get(oldId);
		if (item == null) {
			console.error(`CodeView.updateItemId: unknown item id "${oldId}"`);
			return false;
		}
		if (this.idToItem.has(newId)) {
			console.error(`CodeView.updateItemId: duplicate item id "${newId}"`);
			return false;
		}
		this.idToItem.delete(oldId);
		item.item.id = newId;
		this.idToItem.set(newId, item);
		this.updateItemOptionsId(item.instance.options, newId);
		if (this.selectedLines?.id === oldId) {
			this.selectedLines = {
				...this.selectedLines,
				id: newId
			};
			this.options.onSelectedLinesChange?.(this.selectedLines);
		}
		this.renamePendingScrollTarget(oldId, newId);
		this.renamePendingLayoutAnchor(oldId, newId);
		this.render();
		return true;
	}
	addItem(input) {
		this.addItems([input]);
		this.syncSelection();
	}
	addItems(inputs) {
		this.appendItemsInternal(inputs);
		this.syncSelection();
	}
	setItems(items) {
		if (items.length === 0) this.reset();
		else if (this.items.length === 0) this.appendItemsInternal(items);
		else if (!this.tryAppendItems(items)) this.reconcileItems(items);
		this.syncSelection();
	}
	/**
	* Append new records to the viewer while preserving existing layout state.
	* This is the shared path for imperative adds and the append-only reconcile
	* fast path, so it measures new items immediately and only triggers render
	* once at the end.
	*/
	appendItemsInternal(inputs, render = true) {
		if (inputs.length === 0) return;
		const layout = this.getLayout();
		let nextTop = this.items.length === 0 ? 0 : this.scrollHeight + layout.gap;
		const appendedTop = nextTop;
		for (let index = 0; index < inputs.length; index++) {
			const input = inputs[index];
			if (input == null) throw new Error("CodeView.appendItemsInternal: missing input item");
			if (this.idToItem.has(input.id)) throw new Error(`CodeView.addItem: duplicate id "${input.id}"`);
			const item = this.createItem(input, this.items.length, nextTop);
			this.items.push(item);
			this.idToItem.set(item.item.id, item);
			this.instanceToItem.set(item.instance, item);
			item.height = prepareItemInstance(item);
			nextTop += item.height + layout.gap;
		}
		this.scrollHeight = nextTop - layout.gap;
		this.scrollDirty = true;
		if (render) if (this.canSkipRenderForAppend(appendedTop)) this.syncContainerHeight();
		else this.render();
	}
	canSkipRenderForAppend(appendedTop) {
		return this.container != null && this.renderState.firstIndex !== -1 && this.pendingScrollTarget == null && this.scrollAnimation == null && this.layoutDirtyIndex == null && appendedTop > this.windowSpecs.bottom;
	}
	onThemeChange() {
		this.invalidateElementPool();
	}
	setOptions(options) {
		if (options == null) return;
		this.capturePendingLayoutAnchor();
		const { options: prevOptions } = this;
		const previousLayout = this.getLayout();
		const { itemMetricsCache: previousItemMetrics } = this;
		if (shouldClearPool(prevOptions, options)) this.invalidateElementPool();
		this.options = options;
		const nextItemMetrics = this.computeMetricsCache(options.itemMetrics);
		const itemMetricsChanged = !areObjectsEqual(previousItemMetrics, nextItemMetrics);
		const layoutChanged = !areObjectsEqual(previousLayout, this.getLayout());
		if (layoutChanged) this.syncLayout();
		const itemLayoutChanged = itemMetricsChanged || hasItemLayoutOptionChanged(prevOptions, options);
		if (itemLayoutChanged) {
			const previousReset = this.pendingLayoutReset;
			this.pendingLayoutReset = {
				metrics: itemMetricsChanged ? nextItemMetrics : previousReset?.metrics,
				resetFileLayoutCache: true,
				resetDiffLayoutCache: true,
				includeEstimatedDiffHeights: previousReset?.includeEstimatedDiffHeights === true || itemMetricsChanged || hasCodeViewDiffEstimateOptionChanged(prevOptions, options)
			};
		}
		if (layoutChanged || itemLayoutChanged) {
			this.markLayoutDirtyFromIndex(0);
			this.scrollDirty = true;
		}
		if (!areOptionsEqual(prevOptions, options)) this.renderOptionsRevision++;
		if (!this.isContainerManaged && this.items.length > 0) this.render();
	}
	capturePendingLayoutAnchor() {
		if (this.root == null || this.items.length === 0 || this.pendingScrollTarget != null) return;
		this.pendingLayoutAnchor = this.getScrollAnchor(this.getScrollTop());
	}
	render(immediate = false) {
		if (CodeView.__STOP) return;
		if (immediate) {
			dequeueRender(this.computeRenderRangeAndEmit);
			this.computeRenderRangeAndEmit();
		} else queueRender(this.computeRenderRangeAndEmit);
	}
	instanceChanged(instance, layoutDirty) {
		const item = this.instanceToItem.get(instance);
		if (item == null) throw new Error("CodeView.instanceChanged: An instance has changed that is not registered");
		if (layoutDirty) this.markItemLayoutDirty(item);
		this.render();
	}
	getWindowSpecs() {
		return this.windowSpecs;
	}
	getContainerElement() {
		return this.root;
	}
	getRenderedItems() {
		const { firstIndex, lastIndex } = this.renderState;
		if (firstIndex === -1 || lastIndex === -1 || lastIndex < firstIndex) return [];
		const renderedItems = [];
		for (let index = firstIndex; index <= lastIndex; index++) {
			const item = this.items[index];
			if (item?.element == null) continue;
			if (item.type === "diff") renderedItems.push({
				id: item.item.id,
				type: "diff",
				item: item.item,
				version: item.version,
				element: item.element,
				instance: item.instance
			});
			else renderedItems.push({
				id: item.item.id,
				type: "file",
				item: item.item,
				version: item.version,
				element: item.element,
				instance: item.instance
			});
		}
		return renderedItems;
	}
	setSlotCoordinator(coordinator) {
		if (coordinator === this.slotCoordinator) return false;
		this.slotCoordinator = coordinator;
		this.slotSnapshot = void 0;
		return true;
	}
	getSlotSnapshot(coordinator) {
		return getSlotSnapshot(this.getRenderedItems(), coordinator);
	}
	subscribeToScroll(listener) {
		this.scrollListeners.add(listener);
		return () => {
			this.scrollListeners.delete(listener);
		};
	}
	getLocalTopForInstance(instance) {
		const item = this.instanceToItem.get(instance);
		if (item == null) throw new Error("CodeView.getLocalTopForInstance: unknown virtualized instance");
		return item.top;
	}
	getTopForItem(id) {
		const item = this.idToItem.get(id);
		if (item == null) return;
		return item.top + this.getLayout().paddingTop;
	}
	createItem(input, index, top) {
		const { itemMetricsCache: itemMetrics } = this;
		if (input.type === "diff") {
			const instance = new VirtualizedFileDiff(this.createDiffOptions(input.id), this, itemMetrics, this.workerManager, this.isContainerManaged);
			return {
				type: "diff",
				item: input,
				version: input.version,
				index,
				top,
				height: 0,
				element: void 0,
				renderedOptionsRevision: this.renderOptionsRevision,
				instance
			};
		}
		const instance = new VirtualizedFile(this.createFileOptions(input.id), this, itemMetrics, this.workerManager, this.isContainerManaged);
		return {
			type: "file",
			item: input,
			version: input.version,
			index,
			top,
			height: 0,
			element: void 0,
			renderedOptionsRevision: this.renderOptionsRevision,
			instance
		};
	}
	applySelectedLines(selection, options) {
		const { selectedLines: prevSelection } = this;
		if (selection == null && prevSelection == null || selection != null && prevSelection?.id === selection.id && areSelectionsEqual(prevSelection.range, selection.range)) return;
		if (prevSelection != null && prevSelection.id !== selection?.id) this.idToItem.get(prevSelection.id)?.instance.setSelectedLines(null, { notify: false });
		this.selectedLines = selection;
		this.idToItem.get(selection?.id ?? "")?.instance.setSelectedLines(selection?.range ?? null, options);
	}
	syncSelection() {
		if (this.selectedLines == null) return;
		const item = this.idToItem.get(this.selectedLines.id);
		if (item == null) {
			this.selectedLines = null;
			return;
		}
		item.instance.setSelectedLines(this.selectedLines.range, { notify: false });
	}
	renamePendingScrollTarget(oldId, newId) {
		const { pendingScrollTarget } = this;
		if (pendingScrollTarget == null || pendingScrollTarget.type === "position" || pendingScrollTarget.id !== oldId) return;
		this.pendingScrollTarget = {
			...pendingScrollTarget,
			id: newId
		};
	}
	renamePendingLayoutAnchor(oldId, newId) {
		if (this.pendingLayoutAnchor?.id === oldId) this.pendingLayoutAnchor.id = newId;
	}
	createFileOptionsPrototype() {
		const prototype = {};
		for (const key of CODE_VIEW_FILE_OPTION_KEYS) defineItemOption(prototype, key, () => this.options[key]);
		defineItemOption(prototype, "stickyHeader", () => this.options.stickyHeaders);
		defineItemOption(prototype, "collapsed", (receiver) => this.getItemOptions(getItemOptionsState(receiver), "file")?.item.collapsed === true);
		for (const key of CODE_VIEW_SHARED_CALLBACK_KEYS) this.defineItemSharedCallback(prototype, "file", key);
		for (const key of CODE_VIEW_SELECTION_CALLBACK_KEYS) this.defineItemSelectionCallback(prototype, "file", key);
		return prototype;
	}
	createDiffOptionsPrototype() {
		const prototype = {};
		for (const key of CODE_VIEW_DIFF_OPTION_KEYS) defineItemOption(prototype, key, () => this.options[key]);
		defineItemOption(prototype, "stickyHeader", () => this.options.stickyHeaders);
		defineItemOption(prototype, "hunkSeparators", () => this.options.hunkSeparators);
		defineItemOption(prototype, "collapsed", (receiver) => this.getItemOptions(getItemOptionsState(receiver), "diff")?.item.collapsed === true);
		for (const key of CODE_VIEW_SHARED_CALLBACK_KEYS) this.defineItemSharedCallback(prototype, "diff", key);
		for (const key of CODE_VIEW_SELECTION_CALLBACK_KEYS) this.defineItemSelectionCallback(prototype, "diff", key);
		return prototype;
	}
	createFileOptions(id) {
		const options = Object.create(this.fileOptionsPrototype);
		defineOptionsState(options, { id });
		return options;
	}
	createDiffOptions(id) {
		const options = Object.create(this.diffOptionsPrototype);
		defineOptionsState(options, { id });
		return options;
	}
	updateItemOptionsId(options, id) {
		getItemOptionsState(options).id = id;
	}
	getItemOptions(state, mode) {
		const item = this.idToItem.get(state.id);
		if (item == null || item.type !== mode) return;
		return item;
	}
	defineItemSharedCallback(options, mode, key) {
		defineItemOption(options, key, (receiver) => {
			if (this.options[key] == null) return;
			const state = getItemOptionsState(receiver);
			const callbackCache = state.callbackCache ??= {};
			let wrapped = callbackCache[key];
			if (wrapped == null) {
				wrapped = ((...args) => {
					const latest = this.getItemOptions(state, mode);
					if (latest == null) return;
					const callback = this.options[key];
					return callback?.(...args, latest);
				});
				callbackCache[key] = wrapped;
			}
			return wrapped;
		});
	}
	defineItemSelectionCallback(options, mode, key) {
		defineItemOption(options, key, (receiver) => {
			if (this.options.enableLineSelection !== true) return;
			const state = getItemOptionsState(receiver);
			const callbackCache = state.callbackCache ??= {};
			let wrapped = callbackCache[key];
			if (wrapped == null) {
				wrapped = ((range) => {
					const latest = this.getItemOptions(state, mode);
					if (latest == null) return;
					const selection = range == null ? null : {
						id: latest.item.id,
						range
					};
					if (this.options.controlledSelection !== true) {
						if (range != null || this.selectedLines?.id === latest.item.id) this.applySelectedLines(selection, { notify: false });
					}
					this.options.onSelectedLinesChange?.(selection);
					const callback = this.options[key];
					return callback?.(range, latest);
				});
				callbackCache[key] = wrapped;
			}
			return wrapped;
		});
	}
	/**
	* Track the earliest index whose measured layout may now be stale. Later
	* render passes relayout from this point forward so we do not have to rebuild
	* positions for the whole list after every change.
	*/
	markLayoutDirtyFromIndex(index) {
		this.layoutDirtyIndex = Math.min(this.layoutDirtyIndex ?? index, index);
	}
	/**
	* Mark the earliest affected item as layout-dirty after an imperative change.
	* Each record carries its current array index so this stays O(1) even when
	* the viewer holds a very large number of items.
	*/
	markItemLayoutDirty(item) {
		if (this.items[item.index] !== item) throw new Error(`CodeView.markItemLayoutDirty: unknown item id "${item.item.id}"`);
		this.markLayoutDirtyFromIndex(item.index);
	}
	/**
	* Detect the common controlled-update case where the new list simply extends
	* the existing ordered prefix. When that happens we can reuse every current
	* record in place, sync any versioned payload changes, and append only the new
	* tail instead of rebuilding the whole list.
	*/
	tryAppendItems(items) {
		if (items.length <= this.items.length) return false;
		for (let index = 0; index < this.items.length; index++) {
			const existingItem = this.items[index];
			if (existingItem == null) throw new Error("CodeView.tryAppendItems: missing existing item");
			const nextItem = items[index];
			if (nextItem == null || existingItem.item.id !== nextItem.id || existingItem.type !== nextItem.type) return false;
		}
		for (let index = 0; index < this.items.length; index++) {
			const existingItem = this.items[index];
			if (existingItem == null) throw new Error("CodeView.tryAppendItems: missing existing item");
			const nextItem = items[index];
			if (nextItem == null) throw new Error("CodeView.tryAppendItems: append candidate missing prefix item");
			if (this.syncItemRecord(existingItem, nextItem)) this.markLayoutDirtyFromIndex(index);
		}
		this.appendItemsInternal(items.slice(this.items.length), false);
		this.scrollDirty = true;
		this.render();
		return true;
	}
	/**
	* Reconcile a new controlled item list against the existing records by id.
	* This reuses records and instances when type matches, cleans up removed
	* records, rebuilds the lookup maps, and marks layout dirty whenever order,
	* membership, or versioned item data changes.
	*/
	reconcileItems(items) {
		const { items: previousItems, idToItem: previousById } = this;
		const removedItems = new Set(previousItems);
		const nextItems = [];
		const nextIdToItem = /* @__PURE__ */ new Map();
		const nextInstanceToItem = /* @__PURE__ */ new Map();
		let firstDirtyIndex;
		for (let index = 0; index < items.length; index++) {
			const input = items[index];
			if (input == null) throw new Error("CodeView.reconcileItems: missing input item");
			if (nextIdToItem.has(input.id)) throw new Error(`CodeView.setItems: duplicate id "${input.id}"`);
			const previousItem = previousById.get(input.id);
			const item = previousItem != null && previousItem.type === input.type ? previousItem : this.createItem(input, index, 0);
			item.index = index;
			if (previousItem != null && previousItem.type === input.type) {
				removedItems.delete(previousItem);
				if (this.syncItemRecord(item, input)) firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
			} else firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
			if (previousItems[index] !== item) firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
			nextItems.push(item);
			nextIdToItem.set(input.id, item);
			nextInstanceToItem.set(item.instance, item);
		}
		for (let index = 0; index < previousItems.length; index++) {
			const removedItem = previousItems[index];
			if (removedItem == null || !removedItems.has(removedItem)) continue;
			this.releaseRenderedItem(removedItem);
			const dirtyIndex = Math.max(nextItems.length - 1, 0);
			firstDirtyIndex = Math.min(firstDirtyIndex ?? dirtyIndex, dirtyIndex);
		}
		if (firstDirtyIndex == null) return;
		this.items = nextItems;
		this.idToItem = nextIdToItem;
		this.instanceToItem = nextInstanceToItem;
		if (this.renderState.firstIndex >= nextItems.length) this.resetRenderState();
		else if (this.renderState.lastIndex >= nextItems.length) this.renderState.lastIndex = nextItems.length - 1;
		this.markLayoutDirtyFromIndex(firstDirtyIndex);
		this.scrollDirty = true;
		this.render();
	}
	/**
	* Update a reused record from the latest controlled item only when its item
	* version changes. Matching versions mean CodeView keeps the current record
	* snapshot, which lets imperative updates remain in place until the caller
	* intentionally publishes a newer version.
	*/
	syncItemRecord(item, nextItem) {
		if (item.type !== nextItem.type) throw new Error(`CodeView.syncItemRecord: type mismatch for id "${nextItem.id}"`);
		if (item.version === nextItem.version) return false;
		item.item = nextItem;
		item.version = nextItem.version;
		item.renderedOptionsRevision = -1;
		return true;
	}
	getMaxScrollTopForHeight(scrollHeight) {
		const { paddingBottom, paddingTop } = this.getLayout();
		return Math.max(paddingTop + scrollHeight + paddingBottom - this.getHeight(), 0);
	}
	getMaxScrollTop() {
		return this.getMaxScrollTopForHeight(this.getScrollHeight());
	}
	shouldRebaseScroll() {
		return this.getMaxScrollTop() > SCROLL_REBASE_THRESHOLD;
	}
	getPagedScrollHeight() {
		return this.shouldRebaseScroll() ? Math.min(this.getScrollHeight(), SCROLL_REBASE_CONTAINER_HEIGHT) : this.getScrollHeight();
	}
	getMaxPagedScrollTop() {
		return this.getMaxScrollTopForHeight(this.getPagedScrollHeight());
	}
	clampPagedScrollTop(value) {
		const maxScroll = this.getMaxPagedScrollTop();
		return Math.max(0, Math.min(value, maxScroll));
	}
	/**
	* Clamps a logical scroll position to the min/max allowable scroll range
	* based on the full computed content height.
	*/
	clampScrollTop(value) {
		const maxScroll = this.getMaxScrollTop();
		return Math.max(0, Math.min(value, maxScroll));
	}
	getMaxScrollPageOffset() {
		return Math.max(this.getMaxScrollTop() - this.getMaxPagedScrollTop(), 0);
	}
	clampScrollPageOffset(value) {
		const maxOffset = this.getMaxScrollPageOffset();
		return Math.max(0, Math.min(value, maxOffset));
	}
	resolveScrollPageWindow(scrollTop, preferredPagedScrollTop) {
		let pagedScrollTop = roundToDevicePixel(this.clampPagedScrollTop(preferredPagedScrollTop));
		let scrollPageOffset = this.clampScrollPageOffset(scrollTop - pagedScrollTop);
		pagedScrollTop = roundToDevicePixel(this.clampPagedScrollTop(scrollTop - scrollPageOffset));
		scrollPageOffset = this.clampScrollPageOffset(scrollTop - pagedScrollTop);
		return {
			pagedScrollTop,
			scrollPageOffset
		};
	}
	/**
	* Resolve how a logical scrollTop maps onto the reusable paged scroll window
	* without mutating the current page offset.
	*/
	resolvePagedScrollPosition(logicalScrollTop) {
		if (!this.shouldRebaseScroll()) return {
			pagedScrollTop: this.clampPagedScrollTop(logicalScrollTop),
			scrollPageOffset: 0
		};
		const currentPageOffset = this.clampScrollPageOffset(this.scrollPageOffset);
		const pagedScrollTop = logicalScrollTop - currentPageOffset;
		const pagedMaxScrollTop = this.getMaxPagedScrollTop();
		const maxRebaseOffset = this.getMaxScrollPageOffset();
		const shouldMoveDown = pagedScrollTop > SCROLL_REBASE_THRESHOLD && currentPageOffset < maxRebaseOffset;
		const shouldMoveUp = pagedScrollTop < SCROLL_REBASE_TRIGGER_TOP && currentPageOffset > 0;
		if (pagedScrollTop < 0 || pagedScrollTop > pagedMaxScrollTop || shouldMoveDown || shouldMoveUp) return this.resolveScrollPageWindow(logicalScrollTop, shouldMoveUp ? Math.min(SCROLL_REBASE_TARGET_BOTTOM, pagedMaxScrollTop) : SCROLL_REBASE_TARGET_TOP);
		return {
			pagedScrollTop: roundToDevicePixel(this.clampPagedScrollTop(pagedScrollTop)),
			scrollPageOffset: currentPageOffset
		};
	}
	needsScrollPageUpdate(logicalScrollTop) {
		const roundedScrollTop = roundToDevicePixel(this.clampScrollTop(logicalScrollTop));
		const { scrollPageOffset } = this.resolvePagedScrollPosition(roundedScrollTop);
		return scrollPageOffset !== this.scrollPageOffset;
	}
	getPagedLayoutTop(logicalTop) {
		if (!this.shouldRebaseScroll()) return logicalTop;
		return Math.max(logicalTop - this.scrollPageOffset, 0);
	}
	getStickyHeaderOffset() {
		return this.options.stickyHeaders === true && this.options.disableFileHeader !== true ? this.itemMetricsCache.diffHeaderHeight : 0;
	}
	getScrollTargetRect(target) {
		const item = this.idToItem.get(target.id);
		if (item == null) {
			console.warn(`CodeView.scrollTo: unknown item id "${target.id}"`);
			return;
		}
		if (target.type === "item") return {
			top: item.top,
			height: item.height
		};
		if (target.type === "range") {
			const rangePosition = this.getRangeScrollPosition(item, target);
			if (rangePosition == null) {
				console.warn(`CodeView.scrollTo: unable to resolve range ${formatSelectedLineRange(target.range)} for item "${target.id}"`);
				return;
			}
			return {
				top: item.top + rangePosition.top,
				height: rangePosition.height
			};
		}
		const linePosition = this.getLineScrollPosition(item, target);
		if (linePosition == null) {
			console.warn(`CodeView.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`);
			return;
		}
		return {
			top: item.top + linePosition.top,
			height: linePosition.height
		};
	}
	normalizeScrollTarget(target) {
		if (target.type === "position" || target.align !== "nearest") return target;
		const rect = this.getScrollTargetRect(target);
		if (rect == null) return;
		const offset = target.offset ?? 0;
		const targetTop = this.getLayout().paddingTop + rect.top;
		const targetBottom = targetTop + rect.height;
		const currentTop = this.getScrollTop();
		const visibleTop = currentTop + (target.type === "line" || target.type === "range" ? this.getStickyHeaderOffset() : 0);
		const visibleBottom = currentTop + this.getHeight();
		if (targetTop - offset <= visibleTop && targetBottom + offset >= visibleBottom) return;
		if (targetTop - offset < visibleTop) return {
			...target,
			align: "start"
		};
		if (targetBottom + offset > visibleBottom) return {
			...target,
			align: "end"
		};
	}
	/**
	* Resolve a target's scroll position
	
	* Returns `undefined` when we can't resolve a target for whatever reason
	*/
	resolveScrollTargetTop(target) {
		if (target.type === "position") {
			const clampedPosition = this.clampScrollTop(target.position);
			return clampedPosition !== target.position ? clampedPosition : this.clampScrollTop(target.position - this.getStickyHeaderOffset());
		}
		const item = this.idToItem.get(target.id);
		if (item == null) {
			console.warn(`CodeView.scrollTo: unknown item id "${target.id}"`);
			return;
		}
		if (target.type === "item") return this.clampScrollTop(this.resolveAlignedScrollPosition(item.top, item.height, target.align, target.offset));
		if (target.type === "range") {
			const rangePosition = this.getRangeScrollPosition(item, target);
			if (rangePosition == null) {
				console.warn(`CodeView.scrollTo: unable to resolve range ${formatSelectedLineRange(target.range)} for item "${target.id}"`);
				return;
			}
			return this.clampScrollTop(this.resolveAlignedScrollPosition(item.top + rangePosition.top, rangePosition.height, target.align, target.offset, this.getStickyHeaderOffset()));
		}
		const linePosition = this.getLineScrollPosition(item, target);
		if (linePosition == null) {
			console.warn(`CodeView.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`);
			return;
		}
		return this.clampScrollTop(this.resolveAlignedScrollPosition(item.top + linePosition.top, linePosition.height, target.align, target.offset, this.getStickyHeaderOffset()));
	}
	/**
	* Given an existing scroll target (scroll top and height), figure out the
	* correct scroll position to target based on the desired alignment, offset
	* and stickyOffset if necessary
	*/
	resolveAlignedScrollPosition(targetTop, targetHeight, align, offset = 0, stickyOffset = 0) {
		targetTop += this.getLayout().paddingTop;
		const viewportHeight = this.getHeight();
		if (align === "center" && targetHeight + offset < viewportHeight) return targetTop - (viewportHeight - targetHeight) / 2 + offset;
		if (align === "end") return targetTop - (viewportHeight - targetHeight) + offset;
		return targetTop - stickyOffset - offset;
	}
	getLineScrollPosition(item, target) {
		if (item.type === "diff") return item.instance.getLinePosition(target.lineNumber, target.side);
		return item.instance.getLinePosition(target.lineNumber);
	}
	getRangeScrollPosition(item, target) {
		const { range } = target;
		const startPosition = this.getLineScrollPosition(item, {
			type: "line",
			id: target.id,
			lineNumber: range.start,
			side: range.side
		});
		const endPosition = this.getLineScrollPosition(item, {
			type: "line",
			id: target.id,
			lineNumber: range.end,
			side: range.endSide ?? range.side
		});
		if (startPosition == null || endPosition == null) return;
		const startTop = startPosition.top;
		const startBottom = startTop + startPosition.height;
		const endTop = endPosition.top;
		const endBottom = endTop + endPosition.height;
		const top = Math.min(startTop, endTop);
		return {
			top,
			height: Math.max(startBottom, endBottom) - top
		};
	}
	/**
	* Determine target scroll position for current frame.
	*
	* If there's no pendingScrollTarget then we just return the current scroll
	* position
	*
	* If there's a pendingScrollTarget then we depend on whether there's a
	* smooth scroll animation or not. If not just return the destination, or
	* compute next position given the smooth scroll spring physics
	*/
	computeTargetScrollTopForFrame(scrollTop, frameTimestamp) {
		if (this.pendingScrollTarget == null) return scrollTop;
		const destination = this.resolveScrollTargetTop(this.pendingScrollTarget);
		if (destination == null) return scrollTop;
		const { scrollAnimation } = this;
		if (scrollAnimation == null) return destination;
		return this.computeSpringStep(scrollAnimation, destination, frameTimestamp).position;
	}
	/**
	* Closed-form critical-damped ODE step.
	*
	* Stable at any dt (Euler would blow up once ω·dt ≳ 1), so this survives
	* big RAF gaps (tab-wake, offscreen frames) and resize-driven ticks that
	* fire outside the normal RAF cadence.
	*/
	computeSpringStep(animation, destination, frameTimestamp) {
		const dt = Math.max(0, frameTimestamp - animation.lastTimestamp);
		const { omega } = this.getSmoothScrollSettings();
		const decay = Math.exp(-omega * dt);
		const displacement = animation.position - destination;
		const springCoeff = animation.velocity + omega * displacement;
		return {
			position: destination + (displacement + springCoeff * dt) * decay,
			velocity: (springCoeff * (1 - omega * dt) - omega * displacement) * decay
		};
	}
	/**
	* For any given pendingScrollTarget, updates any in flight smooth scroll
	* animations and returns the target scrollTop to move towards
	*
	* Resolves the animation based on frame time and adopts any necessary scroll
	* anchoring corrections if necessary
	*/
	advanceScrollAnimation(frameTimestamp, anchorDelta) {
		if (this.pendingScrollTarget == null) return;
		const destination = this.resolveScrollTargetTop(this.pendingScrollTarget);
		if (destination == null) {
			this.pendingScrollTarget = void 0;
			this.scrollAnimation = void 0;
			return;
		}
		const animation = this.scrollAnimation;
		if (animation == null) return destination;
		animation.position += anchorDelta;
		const { position, velocity } = this.computeSpringStep(animation, destination, frameTimestamp);
		animation.lastTimestamp = frameTimestamp;
		animation.position = position;
		animation.velocity = velocity;
		const { positionEpsilon, velocityEpsilon } = this.getSmoothScrollSettings();
		if (Math.abs(destination - position) <= positionEpsilon && Math.abs(velocity) <= velocityEpsilon) {
			animation.position = destination;
			animation.velocity = 0;
			this.scrollAnimation = void 0;
			return destination;
		}
		return animation.position;
	}
	computeRenderRangeAndEmit = (timestamp = performance.now()) => {
		if (CodeView.__STOP || this.container == null) return;
		const viewportHeight = this.getHeight();
		const initialScrollTop = this.getScrollTop();
		let scrollTopAfterLayout = initialScrollTop;
		let computeScrollCorrection = this.pendingLayoutAnchor != null;
		let scrollAnchor = this.getScrollAnchor(scrollTopAfterLayout);
		if (this.layoutDirtyIndex != null) {
			this.recomputeLayout(this.layoutDirtyIndex, this.pendingLayoutReset);
			this.layoutDirtyIndex = void 0;
			this.pendingLayoutReset = void 0;
			computeScrollCorrection = true;
		}
		if (computeScrollCorrection && scrollAnchor != null) {
			const anchoredScrollTopAfterLayout = this.resolveAnchoredScrollTop(scrollAnchor);
			if (anchoredScrollTopAfterLayout != null) {
				const layoutAnchorDelta = anchoredScrollTopAfterLayout - scrollTopAfterLayout;
				scrollTopAfterLayout = anchoredScrollTopAfterLayout;
				if (this.scrollAnimation != null) this.scrollAnimation.position += layoutAnchorDelta;
			}
		}
		if (computeScrollCorrection) {
			scrollTopAfterLayout = this.clampScrollTop(scrollTopAfterLayout);
			this.syncContainerHeight();
		}
		const targetScrollTop = this.computeTargetScrollTopForFrame(scrollTopAfterLayout, timestamp);
		const fitPerfectly = !computeScrollCorrection && (this.renderState.scrollTop === -1 || Math.abs(targetScrollTop - this.renderState.scrollTop) > viewportHeight + this.config.overscrollSize * 2);
		if (fitPerfectly) scrollAnchor = void 0;
		this.windowSpecs = createWindowFromScrollPosition({
			scrollTop: targetScrollTop,
			height: viewportHeight,
			scrollHeight: this.getScrollHeight(),
			fitPerfectly,
			fitPerfectlyOverscroll: this.getFitPerfectlyOverscroll(),
			overscrollSize: this.config.overscrollSize
		});
		let syncedScrollTop = initialScrollTop;
		if (this.pendingScrollTarget != null && targetScrollTop !== syncedScrollTop || this.needsScrollPageUpdate(targetScrollTop)) {
			this.applyScrollFix(targetScrollTop, syncedScrollTop, this.windowSpecs);
			syncedScrollTop = targetScrollTop;
		}
		const { top, bottom } = this.windowSpecs;
		const { firstIndex, lastIndex } = this.renderState;
		if (firstIndex >= 0) for (let index = firstIndex; index <= lastIndex; index++) {
			const item = this.items[index];
			if (item == null) throw new Error(`CodeView.computeRenderRangeAndEmit: No item at index: ${index}`);
			if (!(item.top > top - item.height && item.top <= bottom)) this.releaseRenderedItem(item);
		}
		let prevElement;
		const updatedItems = /* @__PURE__ */ new Set();
		const startingIndex = this.findFirstVisibleIndex(top);
		const lastRenderedIndex = this.findLastVisibleIndex(bottom);
		for (let itemIndex = startingIndex; itemIndex <= lastRenderedIndex; itemIndex++) {
			const item = this.items[itemIndex];
			if (item == null) throw new Error(`CodeView.computeRenderRangeAndEmit: missing item`);
			const { instance } = item;
			if (item.element == null) {
				item.element = this.acquireElement();
				syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
				instance.virtualizedSetup();
				if (renderItem(item, item.element)) {
					item.renderedOptionsRevision = this.renderOptionsRevision;
					updatedItems.add(item);
				}
				prevElement = item.element;
			} else {
				syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
				if (renderItem(item, void 0, item.renderedOptionsRevision !== this.renderOptionsRevision)) {
					item.renderedOptionsRevision = this.renderOptionsRevision;
					updatedItems.add(item);
				}
				prevElement = item.element;
			}
		}
		this.renderState.firstIndex = startingIndex <= lastRenderedIndex ? startingIndex : -1;
		this.renderState.lastIndex = lastRenderedIndex;
		this.flushSlotCoordinator();
		this.reconcileRenderedItems(updatedItems);
		this.syncContainerHeight();
		this.updateStickyPositioning();
		const anchoredScrollTopAfterRender = scrollAnchor != null ? this.resolveAnchoredScrollTop(scrollAnchor) : void 0;
		if (scrollAnchor === this.pendingLayoutAnchor) this.pendingLayoutAnchor = void 0;
		const postRenderAnchorDelta = anchoredScrollTopAfterRender != null ? anchoredScrollTopAfterRender - scrollTopAfterLayout : 0;
		let postRenderScrollTop = targetScrollTop;
		let shouldCheckPendingTargetSettled = false;
		if (this.pendingScrollTarget != null) {
			const pendingTargetScrollTop = this.advanceScrollAnimation(timestamp, postRenderAnchorDelta);
			if (pendingTargetScrollTop != null) {
				postRenderScrollTop = pendingTargetScrollTop;
				shouldCheckPendingTargetSettled = true;
			} else postRenderScrollTop = scrollTopAfterLayout;
		} else postRenderScrollTop = anchoredScrollTopAfterRender ?? targetScrollTop;
		if (postRenderScrollTop !== syncedScrollTop) {
			this.applyScrollFix(postRenderScrollTop, syncedScrollTop, this.windowSpecs);
			syncedScrollTop = postRenderScrollTop;
		}
		if (shouldCheckPendingTargetSettled && this.pendingScrollTarget != null && this.isPendingTargetSettled(this.pendingScrollTarget)) {
			this.pendingScrollTarget = void 0;
			this.scrollAnimation = void 0;
		}
		this.renderState.scrollTop = roundToDevicePixel(syncedScrollTop);
		this.flushManagers(updatedItems);
		this.validateStickyContainerHeight();
		this.fixContainerFocus();
		if (fitPerfectly || this.scrollAnimation != null) this.render();
	};
	flushManagers(updatedItems) {
		for (const item of updatedItems) item.instance.flushManagers();
	}
	syncContainerHeight() {
		const pagedScrollHeight = this.getPagedScrollHeight();
		if (this.container == null || this.containerHeight === pagedScrollHeight) return;
		this.container.style.height = `${pagedScrollHeight}px`;
		this.containerHeight = pagedScrollHeight;
	}
	getStickyBounds(windowSpecs) {
		const { firstIndex, lastIndex } = windowSpecs != null ? {
			firstIndex: this.findFirstVisibleIndex(windowSpecs.top),
			lastIndex: this.findLastVisibleIndex(windowSpecs.bottom)
		} : this.renderState;
		if (firstIndex === -1 || lastIndex === -1 || firstIndex > lastIndex) return;
		const firstStickySpecs = this.items[firstIndex]?.instance.getAdvancedStickySpecs(windowSpecs);
		const lastStickySpecs = this.items[lastIndex]?.instance.getAdvancedStickySpecs(windowSpecs);
		if (firstStickySpecs == null || lastStickySpecs == null) return;
		return {
			stickyTop: this.getPagedLayoutTop(Math.max(firstStickySpecs.topOffset, 0)),
			stickyBottom: this.getPagedLayoutTop(lastStickySpecs.topOffset + lastStickySpecs.height)
		};
	}
	applyStickyPositioning({ stickyTop, stickyBottom }) {
		const height = this.getHeight();
		const { itemMetricsCache: itemMetrics } = this;
		const stickyContainerHeight = stickyBottom - stickyTop;
		this.renderState.stickyHeight = stickyContainerHeight;
		this.renderState.stickyTop = stickyTop;
		this.renderState.stickyBottom = stickyBottom;
		this.stickyOffset.style.height = `${stickyTop}px`;
		const randomOffset = (Math.random() * itemMetrics.lineHeight >> 0) * -1;
		const stickyJitter = -Math.max(stickyContainerHeight + randomOffset, 0) + height;
		this.stickyContainer.style.top = `${stickyJitter}px`;
		this.stickyContainer.style.bottom = `${stickyJitter + itemMetrics.diffHeaderHeight}px`;
	}
	syncPagedScrollScaffolding(windowSpecs) {
		this.syncContainerHeight();
		const stickyBounds = this.getStickyBounds(windowSpecs);
		if (stickyBounds == null) return;
		this.applyStickyPositioning(stickyBounds);
	}
	reconcileRenderedItems(updatedItems) {
		const { firstIndex, lastIndex } = this.renderState;
		if (firstIndex === -1) return;
		let currentTop = -1;
		let heightChanged = false;
		for (let index = firstIndex; index < this.items.length; index++) {
			if (!heightChanged && index > lastIndex) break;
			const item = this.items[index];
			if (item == null) throw new Error("CodeView.reconcileRenderedItems: Invalid item");
			if (currentTop === -1) currentTop = item.top;
			else if (item.top !== currentTop) {
				item.top = currentTop;
				item.instance.syncVirtualizedTop();
				heightChanged = true;
			}
			if (updatedItems == null ? index <= lastIndex : updatedItems.has(item)) {
				if (item.instance.reconcileHeights()) {
					heightChanged = true;
					item.height = item.instance.getVirtualizedHeight();
				}
				this.validateRenderedItemHeight(item);
			}
			currentTop += item.instance.getVirtualizedHeight();
			if (index < this.items.length - 1) currentTop += this.getLayout().gap;
		}
		if (heightChanged && currentTop != null) {
			this.scrollDirty = true;
			this.scrollHeight = currentTop;
		}
	}
	updateStickyPositioning() {
		const stickyBounds = this.getStickyBounds();
		if (stickyBounds == null) return;
		const { stickyTop, stickyBottom } = stickyBounds;
		if (stickyBottom - stickyTop === this.renderState.stickyHeight && stickyTop === this.renderState.stickyTop && stickyBottom === this.renderState.stickyBottom) return;
		this.applyStickyPositioning(stickyBounds);
	}
	handleScroll = () => {
		if (CodeView.__STOP) return;
		this.suspendScrollInteractions();
		this.scrollDirty = true;
		this.notifyScroll();
		this.render();
	};
	clearPendingScroll = () => {
		this.pendingScrollTarget = void 0;
		this.pendingLayoutAnchor = void 0;
		this.scrollAnimation = void 0;
	};
	handleResize = (entries) => {
		for (const entry of entries) if (entry.target === this.stickyContainer) {
			if (entry.borderBoxSize[0].blockSize !== this.renderState.stickyHeight) {
				const currentScrollTop = this.getScrollTop();
				const anchor = this.getScrollAnchor(currentScrollTop);
				this.reconcileRenderedItems();
				this.updateStickyPositioning();
				const anchoredScrollTop = anchor != null ? this.resolveAnchoredScrollTop(anchor) : void 0;
				if (anchoredScrollTop != null) {
					const resizeAnchorDelta = anchoredScrollTop - currentScrollTop;
					this.applyScrollFix(anchoredScrollTop, currentScrollTop, this.windowSpecs);
					if (this.scrollAnimation != null) this.scrollAnimation.position += resizeAnchorDelta;
				}
				if (this.pendingScrollTarget != null && this.isPendingTargetSettled(this.pendingScrollTarget)) {
					this.pendingScrollTarget = void 0;
					this.scrollAnimation = void 0;
				}
			}
		} else {
			this.scrollDirty = true;
			this.heightDirty = true;
			this.render();
		}
	};
	/**
	* Figure out scrollTop accounting for sticky header if enabled and
	* necessary
	*/
	getScrollAnchorViewportTop(absoluteItemTop, scrollTop) {
		return absoluteItemTop < scrollTop ? scrollTop + this.getStickyHeaderOffset() : scrollTop;
	}
	/**
	* Attempt to find a scroll anchor based on build in metrics of the existing
	* rendered files/diff.
	*
	* A scroll anchor represents the first fully visible element (in other
	* words, the first file or first line who's top is fully in the viewport).
	*/
	getScrollAnchor(scrollTop) {
		if (this.pendingLayoutAnchor != null) return this.pendingLayoutAnchor;
		const { firstIndex, lastIndex, stickyTop, stickyBottom } = this.renderState;
		if (firstIndex === -1 || lastIndex === -1) return;
		const viewportHeight = this.getHeight();
		if (stickyTop === -1 || stickyBottom === -1) return;
		for (let index = firstIndex; index <= lastIndex; index++) {
			const item = this.items[index];
			if (item == null) continue;
			const absoluteItemTop = this.getLayout().paddingTop + item.top;
			if (absoluteItemTop + item.height <= scrollTop) continue;
			if (absoluteItemTop >= scrollTop + viewportHeight) break;
			if (absoluteItemTop >= scrollTop) return {
				type: "item",
				id: item.item.id,
				viewportOffset: absoluteItemTop - scrollTop
			};
			const localViewportTop = this.getScrollAnchorViewportTop(absoluteItemTop, scrollTop) - absoluteItemTop;
			const lineAnchor = item.instance.getNumericScrollAnchor(localViewportTop);
			if (lineAnchor != null) {
				const absoluteLineTop = absoluteItemTop + lineAnchor.top;
				return {
					type: "line",
					id: item.item.id,
					lineNumber: lineAnchor.lineNumber,
					side: lineAnchor.side,
					viewportOffset: absoluteLineTop - scrollTop
				};
			}
		}
	}
	/**
	* Given a scroll anchor, attempt to resolve a newly updated (and clamped)
	* scroll position to keep the anchored element in place.
	*
	* If we can't resolve a position for whatever reason, we'll return
	* undefined.
	*/
	resolveAnchoredScrollTop(anchor) {
		const item = this.idToItem.get(anchor.id);
		if (item == null) return;
		const { paddingTop } = this.getLayout();
		if (anchor.type === "item") {
			const absoluteItemTop = paddingTop + item.top;
			return this.clampScrollTop(absoluteItemTop - anchor.viewportOffset);
		}
		const linePosition = item.type === "diff" ? item.instance.getLinePosition(anchor.lineNumber, anchor.side) : item.instance.getLinePosition(anchor.lineNumber);
		if (linePosition == null) return;
		const absoluteLineTop = paddingTop + item.top + linePosition.top;
		return this.clampScrollTop(absoluteLineTop - anchor.viewportOffset);
	}
	/**
	* Apply a device-pixel-rounded scroll position if it differs from the last
	* logical scrollTop synchronized into the paged scroll scaffold.
	*/
	applyScrollFix(targetScrollTop, syncedScrollTop, windowSpecs) {
		if (this.root == null) return;
		const roundedTargetScrollTop = roundToDevicePixel(this.clampScrollTop(targetScrollTop));
		const roundedSyncedScrollTop = roundToDevicePixel(syncedScrollTop);
		const { scrollPageOffset: previousPageOffset } = this;
		const syncedPagedScrollTop = roundToDevicePixel(this.clampPagedScrollTop(roundedSyncedScrollTop - previousPageOffset));
		const { pagedScrollTop, scrollPageOffset } = this.resolvePagedScrollPosition(roundedTargetScrollTop);
		const targetPagedScrollTop = pagedScrollTop;
		const rebaseChanged = previousPageOffset !== scrollPageOffset;
		if (roundedTargetScrollTop === this.renderState.scrollTop && roundedTargetScrollTop === roundedSyncedScrollTop && targetPagedScrollTop === syncedPagedScrollTop && !rebaseChanged) return;
		this.suspendScrollInteractions();
		if (targetPagedScrollTop !== syncedPagedScrollTop || rebaseChanged) {
			this.scrollPageOffset = scrollPageOffset;
			this.syncPagedScrollScaffolding(windowSpecs);
		}
		if (targetPagedScrollTop !== syncedPagedScrollTop) this.root.scrollTo({
			top: targetPagedScrollTop,
			behavior: "instant"
		});
		this.renderState.scrollTop = roundedTargetScrollTop;
		this.scrollTop = roundedTargetScrollTop;
		this.scrollDirty = false;
	}
	/**
	* Decide whether a pending programmatic scroll has reached its
	* destination and should be cleared.
	*/
	isPendingTargetSettled(target) {
		const top = this.resolveScrollTargetTop(target);
		if (top == null) return true;
		return roundToDevicePixel(this.getScrollTop()) === roundToDevicePixel(top);
	}
	getScrollTop() {
		if (!this.scrollDirty) return this.scrollTop;
		this.scrollDirty = false;
		const rootScrollTop = this.root?.scrollTop ?? 0;
		this.scrollTop = this.clampScrollTop(rootScrollTop + this.scrollPageOffset);
		return this.scrollTop;
	}
	getHeight() {
		if (!this.heightDirty) return this.height;
		this.heightDirty = false;
		this.height = this.root?.getBoundingClientRect().height ?? 0;
		return this.height;
	}
	getScrollHeight() {
		return this.scrollHeight;
	}
	flushSlotCoordinator() {
		if (this.slotCoordinator == null) return;
		const { onSnapshotChange } = this.slotCoordinator;
		const slotSnapshot = getSlotSnapshot(this.getRenderedItems(), this.slotCoordinator);
		if (areSlotSnapshotsEqual(this.slotSnapshot, slotSnapshot)) return;
		this.slotSnapshot = slotSnapshot;
		onSnapshotChange(slotSnapshot);
	}
	notifyScroll() {
		if (this.scrollListeners.size === 0) return;
		const scrollTop = this.getScrollTop();
		for (const listener of this.scrollListeners) listener(scrollTop, this);
	}
	/**
	* Find the first item whose bottom edge crosses into the viewport window.
	* This lets scroll-time rendering jump directly near the visible range instead
	* of linearly scanning from the start of very large item lists.
	*/
	findFirstVisibleIndex(top) {
		let low = 0;
		let high = this.items.length - 1;
		let result = this.items.length;
		while (low <= high) {
			const mid = low + high >> 1;
			const item = this.items[mid];
			if (item == null) throw new Error("CodeView.findFirstVisibleIndex: invalid item index");
			if (item.top + item.height > top) {
				result = mid;
				high = mid - 1;
			} else low = mid + 1;
		}
		return result;
	}
	/**
	* Find the last item whose top edge is still within the viewport window.
	* Paired with findFirstVisibleIndex, this bounds the render loop to only the
	* slice of items that can actually intersect the current scroll range.
	*/
	findLastVisibleIndex(bottom) {
		let low = 0;
		let high = this.items.length - 1;
		let result = -1;
		while (low <= high) {
			const mid = low + high >> 1;
			const item = this.items[mid];
			if (item == null) throw new Error("CodeView.findLastVisibleIndex: invalid item index");
			if (item.top <= bottom) {
				result = mid;
				low = mid + 1;
			} else high = mid - 1;
		}
		return result;
	}
	/**
	* Recompute measured tops and heights starting from the earliest dirty item.
	* Earlier items keep their existing layout, while everything from startIndex
	* onward is remeasured so downstream positions and total scroll height stay
	* consistent after inserts, removals, or versioned item updates.
	*/
	recomputeLayout(startIndex = 0, reset) {
		if (this.items.length === 0) {
			this.scrollHeight = 0;
			return;
		}
		const layout = this.getLayout();
		let runningTop = 0;
		if (startIndex > 0) {
			const previousItem = this.items[startIndex - 1];
			if (previousItem == null) throw new Error("CodeView.recomputeLayout: invalid dirty index");
			runningTop = previousItem.top + previousItem.height + layout.gap;
		}
		for (let index = startIndex; index < this.items.length; index++) {
			const item = this.items[index];
			if (item == null) throw new Error("CodeView.recomputeLayout: invalid item index");
			item.top = runningTop;
			if (item.type === "diff") item.height = item.instance.prepareCodeViewItem(item.item.fileDiff, runningTop, reset, item.item.annotations ?? []);
			else item.height = item.instance.prepareCodeViewItem(item.item.file, runningTop, reset, item.item.annotations ?? []);
			runningTop += item.height;
			if (index < this.items.length - 1) runningTop += layout.gap;
		}
		if (runningTop !== this.scrollHeight) this.scrollDirty = true;
		this.scrollHeight = runningTop;
	}
	resetRenderState() {
		this.renderState.scrollTop = -1;
		this.renderState.firstIndex = -1;
		this.renderState.lastIndex = -1;
		this.renderState.stickyHeight = 0;
		this.renderState.stickyTop = -1;
		this.renderState.stickyBottom = -1;
	}
	getFitPerfectlyOverscroll() {
		return this.getLayout().gap + this.itemMetricsCache.diffHeaderHeight;
	}
};
function prepareItemInstance(item) {
	item.instance.cleanUp(true);
	if (item.type === "diff") return item.instance.prepareCodeViewItem(item.item.fileDiff, item.top, void 0, item.item.annotations ?? []);
	else return item.instance.prepareCodeViewItem(item.item.file, item.top, void 0, item.item.annotations ?? []);
}
function shouldClearPool(previousOptions, nextOptions) {
	return !areThemesEqual(previousOptions.theme ?? DEFAULT_THEMES, nextOptions.theme ?? DEFAULT_THEMES) || (previousOptions.themeType ?? "system") !== (nextOptions.themeType ?? "system") || previousOptions.unsafeCSS !== nextOptions.unsafeCSS;
}
function hasItemLayoutOptionChanged(previousOptions, nextOptions) {
	return (previousOptions.overflow ?? "scroll") !== (nextOptions.overflow ?? "scroll") || (previousOptions.disableLineNumbers ?? false) !== (nextOptions.disableLineNumbers ?? false) || (previousOptions.disableFileHeader ?? false) !== (nextOptions.disableFileHeader ?? false) || previousOptions.unsafeCSS !== nextOptions.unsafeCSS || (previousOptions.diffStyle ?? "split") !== (nextOptions.diffStyle ?? "split") || (previousOptions.diffIndicators ?? "bars") !== (nextOptions.diffIndicators ?? "bars") || (previousOptions.hunkSeparators ?? "line-info") !== (nextOptions.hunkSeparators ?? "line-info") || (previousOptions.expandUnchanged ?? false) !== (nextOptions.expandUnchanged ?? false) || (previousOptions.collapsedContextThreshold ?? 1) !== (nextOptions.collapsedContextThreshold ?? 1);
}
function hasCodeViewDiffEstimateOptionChanged(previousOptions, nextOptions) {
	return (previousOptions.disableFileHeader ?? false) !== (nextOptions.disableFileHeader ?? false) || (previousOptions.hunkSeparators ?? "line-info") !== (nextOptions.hunkSeparators ?? "line-info") || (previousOptions.expandUnchanged ?? false) !== (nextOptions.expandUnchanged ?? false) || (previousOptions.collapsedContextThreshold ?? 1) !== (nextOptions.collapsedContextThreshold ?? 1);
}
function isPooledShadowChild(child) {
	if (child instanceof SVGElement) return true;
	return isStyleNode(child) && (child.hasAttribute("data-core-css") || child.hasAttribute("data-theme-css") || child.hasAttribute("data-unsafe-css"));
}
function formatSelectedLineRange(range) {
	const start = formatSelectedLinePoint(range.start, range.side);
	const end = formatSelectedLinePoint(range.end, range.endSide ?? range.side);
	return start === end ? start : `${start}-${end}`;
}
function formatSelectedLinePoint(lineNumber, side) {
	if (side == null) return `${lineNumber}`;
	return `${side === "deletions" ? "D" : "A"}${lineNumber}`;
}
function renderItem(item, fileContainer, forceRender = false) {
	if (item.type === "diff") return item.instance.render({
		deferManagers: true,
		fileContainer,
		fileDiff: item.item.fileDiff,
		forceRender,
		lineAnnotations: item.item.annotations ?? []
	});
	else return item.instance.render({
		deferManagers: true,
		fileContainer,
		file: item.item.file,
		forceRender,
		lineAnnotations: item.item.annotations ?? []
	});
}
/**
* Keep the rendered DOM order aligned with the current record order even when
* we reuse existing elements. Reused items may already be mounted elsewhere in
* the sticky container, so this moves them into the correct sibling position
* before rendering updates.
*/
function syncRenderedItemOrder(container, element, prevElement) {
	if (prevElement == null) {
		if (container.firstChild !== element) container.prepend(element);
		return;
	}
	if (prevElement.nextSibling !== element) prevElement.after(element);
}
function hasAnnotations(item) {
	return (item.annotations?.length ?? 0) > 0;
}
function getSlotSnapshot(renderedItems, { hasHeaderRenderers, hasAnnotationRenderer, hasGutterRenderer }) {
	if (renderedItems.length === 0) return;
	if (hasHeaderRenderers || hasGutterRenderer) return renderedItems;
	if (!hasAnnotationRenderer) return;
	const slotSnapshot = [];
	for (const renderedItem of renderedItems) if (hasAnnotations(renderedItem.item)) slotSnapshot.push(renderedItem);
	return slotSnapshot.length > 0 ? slotSnapshot : void 0;
}
function areSlotSnapshotsEqual(previous, next) {
	if (previous == null || next == null) return previous === next;
	if (previous.length !== next.length) return false;
	for (let index = 0; index < previous.length; index++) {
		const previousItem = previous[index];
		const nextItem = next[index];
		if (previousItem == null || nextItem == null || previousItem.id !== nextItem.id || previousItem.type !== nextItem.type || previousItem.element !== nextItem.element || previousItem.version !== nextItem.version) return false;
	}
	return true;
}
//#endregion
export { CodeView };

//# sourceMappingURL=CodeView.js.map