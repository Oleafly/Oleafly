"use client";
import { areOptionsEqual } from "../utils/areOptionsEqual.js";
import { CodeView as CodeView$1 } from "../components/CodeView.js";
import { areManagedSnapshotsEqual } from "../utils/areManagedSnapshotsEqual.js";
import { renderDiffChildren } from "./utils/renderDiffChildren.js";
import { renderFileChildren } from "./utils/renderFileChildren.js";
import { useStableCallback } from "./utils/useStableCallback.js";
import { WorkerPoolContext } from "./WorkerPoolContext.js";
import { forwardRef, memo, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal, flushSync } from "react-dom";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/react/CodeView.tsx
const useIsometricEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
function createDefaultCache(controlled) {
	return {
		instance: void 0,
		items: void 0,
		controlled,
		managedOptions: void 0,
		disableFlushSync: false,
		slotCoordinator: void 0
	};
}
function CodeViewInner(props, ref) {
	const { className, containerRef, disableWorkerPool = false, initialItems, items: controlledItems, onScroll, onSelectedLinesChange, options, renderAnnotation, renderCustomHeader, renderGutterUtility, renderHeaderMetadata, renderHeaderPrefix, selectedLines, style } = props;
	const controlled = controlledItems !== void 0;
	const poolManager = useContext(WorkerPoolContext);
	const cachedDataRef = useRef(createDefaultCache(controlled));
	const hasCustomHeader = renderCustomHeader != null;
	const hasAnnotationRenderer = renderAnnotation != null;
	const hasGutterRenderer = renderGutterUtility != null;
	const hasHeaderRenderers = hasCustomHeader || renderHeaderPrefix != null || renderHeaderMetadata != null;
	const hasRenderers = hasHeaderRenderers || hasAnnotationRenderer || hasGutterRenderer;
	const emitSelectedLinesChange = useStableCallback((selection) => {
		onSelectedLinesChange?.(selection);
	});
	const controlledSelection = selectedLines !== void 0;
	const managedOptions = useMemo(() => createManagedCodeViewOptions({
		options,
		hasCustomHeader,
		hasGutterRenderer,
		onSelectedLinesChange: onSelectedLinesChange != null ? emitSelectedLinesChange : void 0,
		controlledSelection
	}), [
		options,
		hasCustomHeader,
		hasGutterRenderer,
		onSelectedLinesChange,
		emitSelectedLinesChange,
		controlledSelection
	]);
	const [slotContentStore] = useState(() => createSlotContentStore());
	const [, forceUpdate] = useState({});
	const nodeRef = useStableCallback((node) => {
		if (cachedDataRef.current.instance != null && (node == null || node !== cachedDataRef.current.instance.getContainerElement())) {
			cachedDataRef.current.instance.cleanUp();
			slotContentStore.publish(void 0);
			cachedDataRef.current = createDefaultCache(controlled);
		}
		if (node != null && node !== cachedDataRef.current.instance?.getContainerElement()) {
			cachedDataRef.current.instance = new CodeView$1(managedOptions, !disableWorkerPool ? poolManager : void 0, true);
			cachedDataRef.current.instance.setup(node);
		}
		if (typeof containerRef === "function") containerRef(node);
		else if (containerRef != null) containerRef.current = node;
	});
	const onSnapshotChange = useStableCallback((snapshot) => {
		if (cachedDataRef.current.disableFlushSync) slotContentStore.publish(snapshot);
		else flushSync(() => {
			slotContentStore.publish(snapshot);
		});
	});
	const slotCoordinator = useMemo(() => {
		if (!hasHeaderRenderers && !hasAnnotationRenderer && !hasGutterRenderer) return;
		else return {
			hasHeaderRenderers,
			hasAnnotationRenderer,
			hasGutterRenderer,
			onSnapshotChange
		};
	}, [
		onSnapshotChange,
		hasAnnotationRenderer,
		hasGutterRenderer,
		hasHeaderRenderers
	]);
	useIsometricEffect(() => {
		return onScroll != null ? cachedDataRef.current.instance?.subscribeToScroll(onScroll) : void 0;
	});
	useIsometricEffect(() => {
		const { instance, controlled: prevControlled, items: prevItems, managedOptions: prevManagedOptions, slotCoordinator: prevSlotCoordinator } = cachedDataRef.current;
		if (instance == null) return;
		try {
			cachedDataRef.current.disableFlushSync = true;
			let shouldRender = false;
			if (!areOptionsEqual(managedOptions, prevManagedOptions)) {
				cachedDataRef.current.managedOptions = managedOptions;
				instance.setOptions(managedOptions);
				shouldRender = true;
			}
			if (prevControlled !== controlled) {
				console.error("CodeView: cannot switch between controlled and uncontrolled modes. Remount with a new key instead.");
				return;
			}
			if (controlled) {
				if (controlledItems !== prevItems) if (areItemListsEqual(prevItems, controlledItems)) cachedDataRef.current.items = controlledItems;
				else if (isAppendOnlyItemUpdate(prevItems, controlledItems)) {
					cachedDataRef.current.items = controlledItems;
					instance.addItems(controlledItems.slice(prevItems.length));
				} else {
					cachedDataRef.current.items = controlledItems;
					instance.setItems(controlledItems);
					shouldRender = true;
				}
			} else if (prevItems == null) {
				const seedItems = initialItems ?? [];
				cachedDataRef.current.items = seedItems;
				if (seedItems.length > 0) {
					instance.setItems(seedItems);
					shouldRender = true;
				}
			}
			if (selectedLines !== void 0) instance.setSelectedLines(selectedLines, { notify: false });
			const slotPublish = instance.setSlotCoordinator(slotCoordinator);
			let forceInlinePublish = false;
			if (slotCoordinator !== prevSlotCoordinator) {
				if (slotCoordinator == null || prevSlotCoordinator == null) forceInlinePublish = true;
				cachedDataRef.current.slotCoordinator = slotCoordinator;
			}
			if (shouldRender || slotPublish) instance.render(true);
			if (slotPublish && slotCoordinator == null) slotContentStore.publish(void 0);
			if (forceInlinePublish) forceUpdate({});
		} finally {
			cachedDataRef.current.disableFlushSync = false;
		}
	});
	useImperativeHandle(ref, () => ({
		addItems(items) {
			const { controlled, instance } = cachedDataRef.current;
			assertUncontrolledCodeViewAction(controlled, "addItems");
			if (instance == null) console.error("CodeView.addItems: no valid instance to append items with", items);
			else instance.addItems(items);
		},
		getItem(id) {
			const { instance } = cachedDataRef.current;
			if (instance == null) {
				console.error("CodeView.getItem: no valid instance exists", id);
				return;
			} else return instance.getItem(id);
		},
		updateItem(item) {
			const { controlled, instance } = cachedDataRef.current;
			assertUncontrolledCodeViewAction(controlled, "updateItem");
			if (instance == null) {
				console.error("CodeView.updateItem: no valid instance to update item with", item);
				return false;
			}
			return instance.updateItem(item);
		},
		updateItemId(oldId, newId) {
			const { controlled, instance } = cachedDataRef.current;
			assertUncontrolledCodeViewAction(controlled, "updateItemId");
			if (instance == null) {
				console.error("CodeView.updateItemId: no valid instance to update item id with", oldId, newId);
				return false;
			}
			return instance.updateItemId(oldId, newId);
		},
		scrollTo(target) {
			const { instance } = cachedDataRef.current;
			if (instance == null) console.error("CodeView.scrollTo: no valid instance to scroll with", target);
			else instance.scrollTo(target);
		},
		setSelectedLines(selection) {
			const { instance } = cachedDataRef.current;
			if (instance == null) console.error("CodeView.setSelectedLines: no valid instance to update selection with", selection);
			else {
				instance.setSelectedLines(selection, { notify: false });
				emitSelectedLinesChange(selection);
			}
		},
		getSelectedLines() {
			const { instance } = cachedDataRef.current;
			if (instance == null) {
				console.error("CodeView.getSelectedLines: no valid instance exists");
				return null;
			} else return instance.getSelectedLines();
		},
		clearSelectedLines() {
			const { instance } = cachedDataRef.current;
			if (instance == null) console.error("CodeView.clearSelectedLines: no valid instance to update selection with");
			else {
				instance.clearSelectedLines({ notify: false });
				emitSelectedLinesChange(null);
			}
		},
		getInstance() {
			return cachedDataRef.current.instance;
		}
	}), [emitSelectedLinesChange]);
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("div", {
		ref: nodeRef,
		className,
		style
	}), hasRenderers && /* @__PURE__ */ jsx(SlotPortals, {
		managedContentStore: slotContentStore,
		renderCustomHeader,
		renderHeaderPrefix,
		renderHeaderMetadata,
		renderAnnotation,
		renderGutterUtility
	})] });
}
const CodeView = forwardRef(CodeViewInner);
function isAppendOnlyItemUpdate(previousItems, nextItems) {
	if (previousItems == null || nextItems.length <= previousItems.length) return false;
	if (previousItems.length === 0) return true;
	for (let index = 0; index < previousItems.length; index++) if (nextItems[index] !== previousItems[index]) return false;
	return true;
}
function areItemListsEqual(previousItems, nextItems) {
	if (previousItems == null || previousItems.length !== nextItems.length) return false;
	for (let index = 0; index < previousItems.length; index++) if (previousItems[index] !== nextItems[index]) return false;
	return true;
}
function assertUncontrolledCodeViewAction(controlled, action) {
	if (!controlled) return;
	throw new Error(`CodeView.${action} cannot be used when CodeView is controlled. Use initialItems for imperative item updates.`);
}
function createSlotContentStore() {
	let snapshot;
	const listeners = /* @__PURE__ */ new Set();
	return {
		getSnapshot() {
			return snapshot;
		},
		publish(nextSnapshot) {
			if (areManagedSnapshotsEqual(snapshot, nextSnapshot)) return;
			snapshot = nextSnapshot;
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
	};
}
function createManagedCodeViewOptions({ options, hasCustomHeader, hasGutterRenderer, onSelectedLinesChange, controlledSelection }) {
	if (!hasCustomHeader && !hasGutterRenderer && onSelectedLinesChange == null && !controlledSelection) return options;
	options = {
		...options,
		controlledSelection,
		onSelectedLinesChange
	};
	if (hasCustomHeader) options.renderCustomHeader = noopRender;
	if (hasGutterRenderer) options.renderGutterUtility = noopRender;
	return options;
}
const SlotPortals = memo(function SlotPortals({ managedContentStore, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderAnnotation, renderGutterUtility }) {
	const subscribe = useStableCallback((listener) => managedContentStore.subscribe(listener));
	const getSnapshot = useStableCallback(() => managedContentStore.getSnapshot());
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)?.map((renderedItem) => {
		return createPortal(renderCodeViewItemChildren({
			renderedItem,
			renderCustomHeader,
			renderHeaderPrefix,
			renderHeaderMetadata,
			renderAnnotation,
			renderGutterUtility
		}), renderedItem.element, renderedItem.id);
	});
});
function renderCodeViewItemChildren({ renderedItem, renderCustomHeader, renderHeaderPrefix, renderHeaderMetadata, renderAnnotation, renderGutterUtility }) {
	if (renderedItem.type === "diff") {
		const { item, instance } = renderedItem;
		return renderDiffChildren({
			fileDiff: item.fileDiff,
			renderCustomHeader: renderCustomHeader != null ? () => renderCustomHeader(item) : void 0,
			renderHeaderPrefix: renderHeaderPrefix != null ? () => renderHeaderPrefix(item) : void 0,
			renderHeaderMetadata: renderHeaderMetadata != null ? () => renderHeaderMetadata(item) : void 0,
			renderAnnotation: renderAnnotation != null ? (annotation) => renderAnnotation(annotation, item) : void 0,
			lineAnnotations: item.annotations,
			renderGutterUtility: renderGutterUtility != null ? (getHoveredLine) => renderGutterUtility(getHoveredLine, item) : void 0,
			getHoveredLine: instance.getHoveredLine
		});
	} else {
		const { item, instance } = renderedItem;
		return renderFileChildren({
			file: item.file,
			renderCustomHeader: renderCustomHeader != null ? () => renderCustomHeader(item) : void 0,
			renderHeaderPrefix: renderHeaderPrefix != null ? () => renderHeaderPrefix(item) : void 0,
			renderHeaderMetadata: renderHeaderMetadata != null ? () => renderHeaderMetadata(item) : void 0,
			renderAnnotation: renderAnnotation != null ? (annotation) => renderAnnotation(annotation, item) : void 0,
			lineAnnotations: item.annotations,
			renderGutterUtility: renderGutterUtility != null ? (getHoveredLine) => renderGutterUtility(getHoveredLine, item) : void 0,
			getHoveredLine: instance.getHoveredLine
		});
	}
}
function noopRender() {}
//#endregion
export { CodeView };

//# sourceMappingURL=CodeView.js.map