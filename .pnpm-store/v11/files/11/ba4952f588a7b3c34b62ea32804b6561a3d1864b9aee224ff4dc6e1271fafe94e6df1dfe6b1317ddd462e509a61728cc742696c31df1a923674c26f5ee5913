import { queueRender } from "../managers/UniversalRenderingManager.js";
import { createWindowFromScrollPosition } from "../utils/createWindowFromScrollPosition.js";
import { areVirtualWindowSpecsEqual } from "../utils/areVirtualWindowSpecsEqual.js";
//#region src/components/Virtualizer.ts
const DEFAULT_OVERSCROLL_SIZE = 1e3;
const INTERSECTION_OBSERVER_MARGIN = DEFAULT_OVERSCROLL_SIZE * 4;
const INTERSECTION_OBSERVER_THRESHOLD = [
	0,
	1e-6,
	.99999,
	1
];
const DEFAULT_VIRTUALIZER_CONFIG = {
	overscrollSize: DEFAULT_OVERSCROLL_SIZE,
	intersectionObserverMargin: INTERSECTION_OBSERVER_MARGIN,
	resizeDebugging: false
};
let lastSize = 0;
let instance = -1;
var Virtualizer = class Virtualizer {
	static __STOP = false;
	static __lastScrollPosition = 0;
	__id = `virtualizer-${++instance}`;
	config;
	type = "simple";
	intersectionObserver;
	scrollTop = 0;
	height = 0;
	scrollHeight = 0;
	windowSpecs = {
		top: 0,
		bottom: 0
	};
	root;
	contentContainer;
	resizeObserver;
	observers = /* @__PURE__ */ new Map();
	visibleInstances = /* @__PURE__ */ new Map();
	visibleInstancesDirty = false;
	instancesChanged = /* @__PURE__ */ new Set();
	scrollDirty = true;
	heightDirty = true;
	scrollHeightDirty = true;
	renderedObservers = 0;
	connectQueue = /* @__PURE__ */ new Map();
	constructor(config) {
		this.config = {
			...DEFAULT_VIRTUALIZER_CONFIG,
			...config
		};
	}
	setup(root, contentContainer) {
		if (this.root != null) return;
		this.root = root;
		this.resizeObserver = new ResizeObserver(this.handleContainerResize);
		this.intersectionObserver = new IntersectionObserver(this.handleIntersectionChange, {
			root: this.root,
			threshold: INTERSECTION_OBSERVER_THRESHOLD,
			rootMargin: `${this.config.intersectionObserverMargin}px 0px ${this.config.intersectionObserverMargin}px 0px`
		});
		if (root instanceof Document) this.setupWindow();
		else this.setupElement(contentContainer);
		window.__INSTANCE = this;
		window.__TOGGLE = () => {
			if (Virtualizer.__STOP) {
				Virtualizer.__STOP = false;
				(this.getScrollContainerElement() ?? window).scrollTo({ top: Virtualizer.__lastScrollPosition });
				queueRender(this.computeRenderRangeAndEmit);
			} else {
				Virtualizer.__lastScrollPosition = this.getScrollTop();
				Virtualizer.__STOP = true;
			}
		};
		for (const [container, instance] of this.connectQueue.entries()) this.connect(container, instance);
		this.connectQueue.clear();
		this.markDOMDirty();
		queueRender(this.computeRenderRangeAndEmit);
	}
	instanceChanged(instance, domDirty) {
		this.instancesChanged.add(instance);
		if (domDirty) this.markDOMDirty();
		queueRender(this.computeRenderRangeAndEmit);
	}
	getWindowSpecs() {
		if (this.windowSpecs.top === 0 && this.windowSpecs.bottom === 0) this.windowSpecs = createWindowFromScrollPosition({
			scrollTop: this.getScrollTop(),
			height: this.getHeight(),
			scrollHeight: this.getScrollHeight(),
			overscrollSize: this.config.overscrollSize
		});
		return this.windowSpecs;
	}
	isInstanceVisible(elementTop, elementHeight) {
		const scrollTop = this.getScrollTop();
		const height = this.getHeight();
		const margin = this.config.intersectionObserverMargin;
		const top = scrollTop - margin;
		const bottom = scrollTop + height + margin;
		return !(elementTop < top - elementHeight || elementTop > bottom);
	}
	handleContainerResize = (entries) => {
		if (this.root == null) return;
		let shouldQueueUpdate = false;
		for (const entry of entries) {
			const blockSize = entry.borderBoxSize[0].blockSize;
			if (this.root instanceof Document) {
				if (blockSize !== this.scrollHeight) {
					this.scrollHeightDirty = true;
					shouldQueueUpdate = true;
					if (this.config.resizeDebugging) {
						console.log("Virtualizer: content size change", this.__id, {
							sizeChange: blockSize - lastSize,
							newSize: blockSize
						});
						lastSize = blockSize;
					}
				}
			} else if (entry.target === this.root) {
				if (blockSize !== this.height) {
					this.heightDirty = true;
					shouldQueueUpdate = true;
				}
			} else if (entry.target === this.contentContainer) {
				this.scrollHeightDirty = true;
				shouldQueueUpdate = true;
				if (this.config.resizeDebugging) {
					console.log("Virtualizer: scroller size change", this.__id, {
						sizeChange: blockSize - lastSize,
						newSize: blockSize
					});
					lastSize = blockSize;
				}
			}
		}
		if (shouldQueueUpdate) queueRender(this.computeRenderRangeAndEmit);
	};
	setupWindow() {
		if (this.root == null || !(this.root instanceof Document)) throw new Error("Virtualizer.setupWindow: Invalid setup method");
		window.addEventListener("scroll", this.handleWindowScroll, { passive: true });
		window.addEventListener("resize", this.handleWindowResize, { passive: true });
		this.resizeObserver?.observe(this.root.documentElement);
	}
	setupElement(contentContainer) {
		if (this.root == null || this.root instanceof Document) throw new Error("Virtualizer.setupElement: Invalid setup method");
		this.root.addEventListener("scroll", this.handleElementScroll, { passive: true });
		this.resizeObserver?.observe(this.root);
		contentContainer ??= this.root.firstElementChild ?? void 0;
		if (contentContainer instanceof HTMLElement) {
			this.contentContainer = contentContainer;
			this.resizeObserver?.observe(contentContainer);
		}
	}
	cleanUp() {
		this.resizeObserver?.disconnect();
		this.resizeObserver = void 0;
		this.intersectionObserver?.disconnect();
		this.intersectionObserver = void 0;
		this.root?.removeEventListener("scroll", this.handleElementScroll);
		window.removeEventListener("scroll", this.handleWindowScroll);
		window.removeEventListener("resize", this.handleWindowResize);
		this.root = void 0;
		this.contentContainer = void 0;
		this.observers.clear();
		this.visibleInstances.clear();
		this.instancesChanged.clear();
		this.connectQueue.clear();
		this.visibleInstancesDirty = false;
		this.windowSpecs = {
			top: 0,
			bottom: 0
		};
		this.scrollTop = 0;
		this.height = 0;
		this.scrollHeight = 0;
	}
	getOffsetInScrollContainer(element) {
		return this.getScrollTop() + getRelativeBoundingTop(element, this.getScrollContainerElement());
	}
	connect(container, instance) {
		if (this.observers.has(container)) throw new Error("Virtualizer.connect: instance is already connected...");
		if (this.intersectionObserver == null) this.connectQueue.set(container, instance);
		else {
			this.intersectionObserver.observe(container);
			this.observers.set(container, instance);
			this.instancesChanged.add(instance);
			this.markDOMDirty();
			queueRender(this.computeRenderRangeAndEmit);
		}
		return () => this.disconnect(container);
	}
	disconnect(container) {
		const instance = this.observers.get(container);
		this.connectQueue.delete(container);
		if (instance == null) return;
		this.intersectionObserver?.unobserve(container);
		this.observers.delete(container);
		if (this.visibleInstances.delete(container)) this.visibleInstancesDirty = true;
		this.markDOMDirty();
		queueRender(this.computeRenderRangeAndEmit);
	}
	handleWindowResize = () => {
		if (Virtualizer.__STOP || window.innerHeight === this.height) return;
		this.heightDirty = true;
		queueRender(this.computeRenderRangeAndEmit);
	};
	handleWindowScroll = () => {
		if (Virtualizer.__STOP || this.root == null || !(this.root instanceof Document)) return;
		this.scrollDirty = true;
		queueRender(this.computeRenderRangeAndEmit);
	};
	handleElementScroll = () => {
		if (Virtualizer.__STOP || this.root == null || this.root instanceof Document) return;
		this.scrollDirty = true;
		queueRender(this.computeRenderRangeAndEmit);
	};
	computeRenderRangeAndEmit = () => {
		if (Virtualizer.__STOP) return;
		const wrapperDirty = this.heightDirty || this.scrollHeightDirty;
		if (!this.scrollDirty && !this.scrollHeightDirty && !this.heightDirty && this.renderedObservers === this.observers.size && !this.visibleInstancesDirty && this.instancesChanged.size === 0) return;
		let instancesHaveChanged = this.instancesChanged.size > 0;
		if (this.instancesChanged.size === 0) {
			const windowSpecs = createWindowFromScrollPosition({
				scrollTop: this.getScrollTop(),
				height: this.getHeight(),
				scrollHeight: this.getScrollHeight(),
				overscrollSize: this.config.overscrollSize
			});
			if (!wrapperDirty && areVirtualWindowSpecsEqual(this.windowSpecs, windowSpecs) && this.renderedObservers === this.observers.size && !this.visibleInstancesDirty) return;
			this.windowSpecs = windowSpecs;
		}
		this.visibleInstancesDirty = false;
		this.renderedObservers = this.observers.size;
		const anchor = this.getScrollAnchor(this.height);
		const updatedInstances = /* @__PURE__ */ new Set();
		for (const instance of wrapperDirty ? this.observers.values() : this.visibleInstances.values()) if (instance.onRender(wrapperDirty)) updatedInstances.add(instance);
		for (const instance of this.instancesChanged) {
			if (updatedInstances.has(instance)) continue;
			if (instance.onRender(wrapperDirty)) updatedInstances.add(instance);
		}
		this.scrollFix(anchor);
		for (const instance of updatedInstances) instance.reconcileHeights();
		instancesHaveChanged ||= this.instancesChanged.size > 0;
		if (instancesHaveChanged) this.markDOMDirty();
		if (instancesHaveChanged || wrapperDirty) queueRender(this.computeRenderRangeAndEmit);
		updatedInstances.clear();
		this.instancesChanged.clear();
	};
	scrollFix(anchor) {
		if (anchor == null) return;
		const scrollContainer = this.getScrollContainerElement();
		const { lineIndex, lineOffset, fileElement, fileOffset, fileTypeOffset } = anchor;
		if (lineIndex != null && lineOffset != null) {
			const element = fileElement.shadowRoot?.querySelector(`[data-line][data-line-index="${lineIndex}"]`);
			if (element instanceof HTMLElement) {
				const top = getRelativeBoundingTop(element, scrollContainer);
				if (top !== lineOffset) {
					const scrollOffset = top - lineOffset;
					this.applyScrollFix(scrollOffset);
				}
				return;
			}
		}
		const top = getRelativeBoundingTop(fileElement, scrollContainer);
		if (fileTypeOffset === "top") {
			if (top !== fileOffset) this.applyScrollFix(top - fileOffset);
		} else {
			const bottom = top + fileElement.getBoundingClientRect().height;
			if (bottom !== fileOffset) this.applyScrollFix(bottom - fileOffset);
		}
	}
	applyScrollFix(scrollOffset) {
		if (this.root == null || this.root instanceof Document) window.scrollTo({
			top: window.scrollY + scrollOffset,
			behavior: "instant"
		});
		else this.root.scrollTo({
			top: this.root.scrollTop + scrollOffset,
			behavior: "instant"
		});
		this.markDOMDirty();
	}
	getScrollAnchor(viewportHeight) {
		const scrollContainer = this.getScrollContainerElement();
		let bestAnchor;
		for (const [fileElement] of this.visibleInstances.entries()) {
			const fileTop = getRelativeBoundingTop(fileElement, scrollContainer);
			const fileBottom = fileTop + fileElement.offsetHeight;
			let fileOffset;
			let fileTypeOffset;
			if (fileBottom <= 0) {
				fileOffset = fileBottom;
				fileTypeOffset = "bottom";
			} else {
				fileOffset = fileTop;
				fileTypeOffset = "top";
			}
			let bestLineIndex;
			let bestLineOffset;
			if (fileBottom > 0 && fileTop < viewportHeight) for (const line of fileElement.shadowRoot?.querySelectorAll("[data-line][data-line-index]") ?? []) {
				if (!(line instanceof HTMLElement)) continue;
				const lineIndex = line.dataset.lineIndex;
				if (lineIndex == null) continue;
				const lineOffset = getRelativeBoundingTop(line, scrollContainer);
				if (lineOffset < 0) continue;
				bestLineIndex = lineIndex;
				bestLineOffset = lineOffset;
				break;
			}
			if (bestAnchor?.lineOffset != null && bestLineOffset == null) continue;
			let shouldReplace = false;
			if (bestAnchor == null) shouldReplace = true;
			else if (bestLineOffset != null && (bestAnchor.lineOffset == null || bestLineOffset < bestAnchor.lineOffset)) shouldReplace = true;
			else if (bestLineOffset == null && bestAnchor.lineOffset == null) {
				if (fileOffset >= 0 && (bestAnchor.fileOffset < 0 || fileOffset < bestAnchor.fileOffset)) shouldReplace = true;
				else if (fileOffset < 0 && bestAnchor.fileOffset < 0 && fileOffset > bestAnchor.fileOffset) shouldReplace = true;
			}
			if (shouldReplace) bestAnchor = {
				fileElement,
				fileTypeOffset,
				fileOffset,
				lineIndex: bestLineIndex,
				lineOffset: bestLineOffset
			};
		}
		return bestAnchor;
	}
	handleIntersectionChange = (entries) => {
		this.scrollDirty = true;
		for (const { target, isIntersecting } of entries) {
			if (!(target instanceof HTMLElement)) throw new Error("Virtualizer.handleIntersectionChange: target not an HTMLElement");
			const instance = this.observers.get(target);
			if (instance == null) continue;
			if (isIntersecting && !this.visibleInstances.has(target)) {
				instance.setVisibility(true);
				this.visibleInstances.set(target, instance);
				this.visibleInstancesDirty = true;
			} else if (!isIntersecting && this.visibleInstances.has(target)) {
				instance.setVisibility(false);
				this.visibleInstances.delete(target);
				this.visibleInstancesDirty = true;
			}
		}
		if (this.visibleInstancesDirty) queueRender(this.computeRenderRangeAndEmit);
	};
	getScrollTop() {
		if (!this.scrollDirty) return this.scrollTop;
		this.scrollDirty = false;
		let scrollTop = (() => {
			if (this.root == null) return 0;
			if (this.root instanceof Document) return window.scrollY;
			return this.root.scrollTop;
		})();
		scrollTop = Math.max(0, Math.min(scrollTop, this.getScrollHeight() - this.getHeight()));
		this.scrollTop = scrollTop;
		return scrollTop;
	}
	getScrollHeight() {
		if (!this.scrollHeightDirty) return this.scrollHeight;
		this.scrollHeightDirty = false;
		this.scrollHeight = (() => {
			if (this.root == null) return 0;
			if (this.root instanceof Document) return this.root.documentElement.scrollHeight;
			return this.root.scrollHeight;
		})();
		return this.scrollHeight;
	}
	getHeight() {
		if (!this.heightDirty) return this.height;
		this.heightDirty = false;
		this.height = (() => {
			if (this.root == null) return 0;
			if (this.root instanceof Document) return globalThis.innerHeight;
			return this.root.getBoundingClientRect().height;
		})();
		return this.height;
	}
	markDOMDirty() {
		this.scrollDirty = true;
		this.scrollHeightDirty = true;
		this.heightDirty = true;
	}
	getScrollContainerElement() {
		return this.root == null || this.root instanceof Document ? void 0 : this.root;
	}
};
function getRelativeBoundingTop(element, scrollContainer) {
	const rect = element.getBoundingClientRect();
	const scrollContainerTop = scrollContainer?.getBoundingClientRect().top ?? 0;
	return rect.top - scrollContainerTop;
}
//#endregion
export { Virtualizer };

//# sourceMappingURL=Virtualizer.js.map