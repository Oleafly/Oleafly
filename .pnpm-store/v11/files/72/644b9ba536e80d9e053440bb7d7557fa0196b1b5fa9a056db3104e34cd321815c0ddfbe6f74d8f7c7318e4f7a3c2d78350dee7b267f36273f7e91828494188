//#region src/managers/ResizeManager.ts
var ResizeManager = class ResizeManager {
	static resizeObserver;
	static managersByElement = /* @__PURE__ */ new Map();
	static getResizeObserver() {
		const resizeObserver = ResizeManager.resizeObserver ?? new ResizeObserver(ResizeManager.handleSharedResizeEntries);
		ResizeManager.resizeObserver = resizeObserver;
		return resizeObserver;
	}
	static handleSharedResizeEntries(entries) {
		const entriesByManager = /* @__PURE__ */ new Map();
		for (const entry of entries) {
			const manager = ResizeManager.managersByElement.get(entry.target);
			if (manager == null) continue;
			const managerEntries = entriesByManager.get(manager);
			if (managerEntries == null) entriesByManager.set(manager, [entry]);
			else managerEntries.push(entry);
		}
		for (const [manager, managerEntries] of entriesByManager) manager.handleResizeEntries(managerEntries);
	}
	observedNodes = /* @__PURE__ */ new Map();
	setup(pre, disableAnnotations) {
		const annotationUpdates = /* @__PURE__ */ new Set();
		let columnCount = 0;
		const observedNodes = new Map(this.observedNodes);
		this.observedNodes.clear();
		for (const element of pre.children) {
			if (columnCount === 2) break;
			const codeElement = (() => {
				if (element instanceof HTMLElement && element.tagName === "CODE") return element;
			})();
			if (codeElement == null) continue;
			columnCount++;
			let item = observedNodes.get(codeElement);
			if (item != null && item.type !== "code") throw new Error("ResizeManager.setup: somehow a code node is being used for an annotation, should be impossible");
			let numberElement = codeElement.firstElementChild;
			if (!(numberElement instanceof HTMLElement)) numberElement = null;
			if (item != null) {
				this.observedNodes.set(codeElement, item);
				observedNodes.delete(codeElement);
				if (item.numberElement !== numberElement) {
					if (item.numberElement != null) {
						this.unobserve(item.numberElement);
						observedNodes.delete(item.numberElement);
					}
					if (numberElement != null) {
						this.observe(numberElement);
						observedNodes.delete(numberElement);
						this.observedNodes.set(numberElement, item);
					}
					item.numberElement = numberElement;
					item.numberWidth = 0;
				} else if (item.numberElement != null) {
					observedNodes.delete(item.numberElement);
					this.observedNodes.set(item.numberElement, item);
				} else item.numberWidth = 0;
			} else {
				item = {
					type: "code",
					codeElement,
					numberElement,
					codeWidth: "auto",
					numberWidth: 0
				};
				this.observedNodes.set(codeElement, item);
				this.observe(codeElement);
				if (numberElement != null) {
					this.observedNodes.set(numberElement, item);
					this.observe(numberElement);
				}
			}
		}
		if (columnCount > 1 && !disableAnnotations) {
			const annotationElements = pre.querySelectorAll("[data-line-annotation*=\",\"]");
			const elementMap = /* @__PURE__ */ new Map();
			for (const element of annotationElements) {
				if (!(element instanceof HTMLElement)) continue;
				const lineAnnotation = element.getAttribute("data-line-annotation") ?? "";
				if (!/^-?\d+,-?\d+$/.test(lineAnnotation)) {
					console.error("DiffFileRenderer.setupResizeObserver: Invalid element or annotation", {
						lineAnnotation,
						element
					});
					continue;
				}
				let pairs = elementMap.get(lineAnnotation);
				if (pairs == null) {
					pairs = [];
					elementMap.set(lineAnnotation, pairs);
				}
				pairs.push(element);
			}
			for (const [key, pair] of elementMap) {
				if (pair.length !== 2) {
					console.error("DiffFileRenderer.setupResizeObserver: Bad Pair", key, pair);
					continue;
				}
				const [container1, container2] = pair;
				const child1 = container1.firstElementChild;
				const child2 = container2.firstElementChild;
				if (!(container1 instanceof HTMLElement) || !(container2 instanceof HTMLElement) || !(child1 instanceof HTMLElement) || !(child2 instanceof HTMLElement)) continue;
				let item = observedNodes.get(child1);
				if (item != null) {
					this.observedNodes.set(child1, item);
					this.observedNodes.set(child2, item);
					observedNodes.delete(child1);
					observedNodes.delete(child2);
					continue;
				}
				const child1Height = child1.getBoundingClientRect().height;
				const child2Height = child2.getBoundingClientRect().height;
				item = {
					type: "annotations",
					column1: {
						container: container1,
						child: child1,
						childHeight: child1Height
					},
					column2: {
						container: container2,
						child: child2,
						childHeight: child2Height
					},
					currentHeight: "auto"
				};
				annotationUpdates.add({
					child1,
					child2,
					item,
					newHeight: Math.max(child1Height, child2Height)
				});
			}
			for (const pendingUpdate of annotationUpdates) {
				this.applyNewHeight(pendingUpdate.item, pendingUpdate.newHeight);
				this.observedNodes.set(pendingUpdate.child1, pendingUpdate.item);
				this.observedNodes.set(pendingUpdate.child2, pendingUpdate.item);
				this.observe(pendingUpdate.child1);
				this.observe(pendingUpdate.child2);
			}
			annotationUpdates.clear();
		}
		for (const [element, item] of observedNodes) {
			this.unobserve(element);
			if (item.type === "code") cleanupStaleCodeItem(item);
			else cleanupStaleAnnotationItem(item);
		}
		observedNodes.clear();
	}
	cleanUp() {
		for (const element of this.observedNodes.keys()) this.unobserve(element);
		this.observedNodes.clear();
	}
	observe(element) {
		const { managersByElement } = ResizeManager;
		const owner = managersByElement.get(element);
		if (owner === this) return;
		else if (owner != null && owner !== this) throw new Error("ResizeManager.observe: element is already owned by another ResizeManager");
		managersByElement.set(element, this);
		ResizeManager.getResizeObserver().observe(element);
	}
	unobserve(element) {
		const { managersByElement, resizeObserver } = ResizeManager;
		const owner = managersByElement.get(element);
		if (owner == null) return;
		else if (owner !== this) throw new Error("ResizeManager.unobserve: element is owned by another ResizeManager");
		managersByElement.delete(element);
		resizeObserver?.unobserve(element);
		if (resizeObserver != null && managersByElement.size === 0) {
			resizeObserver.disconnect();
			ResizeManager.resizeObserver = void 0;
		}
	}
	handleResizeEntries(entries) {
		const codeUpdates = /* @__PURE__ */ new Map();
		const annotationUpdates = /* @__PURE__ */ new Set();
		for (const entry of entries) {
			const { target, borderBoxSize, contentBoxSize } = entry;
			if (!(target instanceof HTMLElement)) {
				console.error("ResizeManager.handleResizeEntries: Invalid element for ResizeObserver", entry);
				continue;
			}
			const item = this.observedNodes.get(target);
			if (item == null) {
				console.error("ResizeManager.handleResizeEntries: Not a valid observed node", entry);
				continue;
			}
			if (item.type === "annotations") {
				const column = (() => {
					if (target === item.column1.child) return item.column1;
					if (target === item.column2.child) return item.column2;
				})();
				if (column == null) {
					console.error(`ResizeManager.handleResizeEntries: Couldn't find a column for`, {
						item,
						target
					});
					continue;
				}
				column.childHeight = borderBoxSize[0].blockSize;
				annotationUpdates.add(item);
			} else if (item.type === "code") {
				const update = codeUpdates.get(item) ?? {};
				const inlineSize = contentBoxSize[0].inlineSize;
				if (target === item.codeElement) update.codeInlineSize = inlineSize;
				else if (target === item.numberElement) update.numberInlineSize = inlineSize;
				codeUpdates.set(item, update);
			}
		}
		this.applyAnnotationUpdates(annotationUpdates);
		annotationUpdates.clear();
		this.applyColumnUpdates(codeUpdates);
		codeUpdates.clear();
	}
	applyAnnotationUpdates(annotationUpdates) {
		for (const item of annotationUpdates) this.applyNewHeight(item, Math.max(item.column1.childHeight, item.column2.childHeight));
	}
	applyColumnUpdates = (queuedUpdates) => {
		for (const [item, update] of queuedUpdates) {
			const nextCodeWidth = update.codeInlineSize != null ? resolveCodeWidth(update.codeInlineSize) : item.codeWidth;
			const nextNumberWidth = update.numberInlineSize != null ? resolveNumberWidth(update.numberInlineSize) : item.numberWidth;
			const codeWidthChanged = nextCodeWidth !== item.codeWidth;
			const numberWidthChanged = nextNumberWidth !== item.numberWidth;
			if (!codeWidthChanged && !numberWidthChanged) continue;
			item.codeWidth = nextCodeWidth;
			item.numberWidth = nextNumberWidth;
			if (codeWidthChanged) item.codeElement.style.setProperty("--diffs-column-width", `${typeof nextCodeWidth === "number" ? `${nextCodeWidth}px` : "auto"}`);
			if (numberWidthChanged) item.codeElement.style.setProperty("--diffs-column-number-width", `${nextNumberWidth === 0 ? "auto" : `${nextNumberWidth}px`}`);
			if (codeWidthChanged || numberWidthChanged && nextCodeWidth !== "auto") {
				const targetWidth = typeof nextCodeWidth === "number" ? Math.max(nextCodeWidth - nextNumberWidth, 0) : 0;
				item.codeElement.style.setProperty("--diffs-column-content-width", `${targetWidth > 0 ? `${targetWidth}px` : "auto"}`);
			}
		}
	};
	applyNewHeight(item, newHeight) {
		if (newHeight !== item.currentHeight) {
			item.currentHeight = Math.max(newHeight, 0);
			item.column1.container.style.setProperty("--diffs-annotation-min-height", `${item.currentHeight}px`);
			item.column2.container.style.setProperty("--diffs-annotation-min-height", `${item.currentHeight}px`);
		}
	}
};
function resolveCodeWidth(inlineSize) {
	const width = Math.max(Math.floor(inlineSize), 0);
	return width === 0 ? "auto" : width;
}
function resolveNumberWidth(inlineSize) {
	return Math.max(Math.ceil(inlineSize), 0);
}
function cleanupStaleCodeItem(item) {
	if (item.codeElement.isConnected) {
		item.codeElement.style.removeProperty("--diffs-column-content-width");
		item.codeElement.style.removeProperty("--diffs-column-number-width");
		item.codeElement.style.removeProperty("--diffs-column-width");
	}
}
function cleanupStaleAnnotationItem(item) {
	if (item.column1.container.isConnected) item.column1.container.style.removeProperty("--diffs-annotation-min-height");
	if (item.column2.container.isConnected) item.column2.container.style.removeProperty("--diffs-annotation-min-height");
}
//#endregion
export { ResizeManager };

//# sourceMappingURL=ResizeManager.js.map