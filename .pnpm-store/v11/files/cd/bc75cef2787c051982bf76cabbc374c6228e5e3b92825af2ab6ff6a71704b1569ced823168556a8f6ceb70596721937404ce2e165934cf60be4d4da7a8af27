//#region src/base-ui/ContextMenu/store.ts
const emptyState = {
	anchor: null,
	iconSpaceMode: "global",
	items: [],
	open: false,
	triggerId: null
};
let contextMenuState = emptyState;
const listeners = /* @__PURE__ */ new Set();
const lastPointer = {
	ready: false,
	triggerId: null,
	x: 0,
	y: 0
};
const notify = () => {
	listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const getSnapshot = () => contextMenuState;
const getServerSnapshot = () => emptyState;
const updateLastPointer = (event) => {
	lastPointer.x = event.clientX;
	lastPointer.y = event.clientY;
	lastPointer.ready = true;
	if (event.target instanceof Element) {
		const trigger = event.target.closest("[data-contextmenu-trigger]");
		lastPointer.triggerId = trigger?.dataset.contextmenuTrigger ?? null;
	} else lastPointer.triggerId = null;
};
const createVirtualElement = (point) => ({
	contextElement: typeof document === "undefined" ? void 0 : document.body,
	getBoundingClientRect: () => ({
		bottom: point.y,
		height: 0,
		left: point.x,
		right: point.x,
		toJSON: () => void 0,
		top: point.y,
		width: 0,
		x: point.x,
		y: point.y
	})
});
const setContextMenuState = (next) => {
	contextMenuState = {
		...contextMenuState,
		...next
	};
	notify();
};
const showContextMenu = (items, options) => {
	if (typeof window === "undefined") return;
	const fallbackPoint = {
		x: window.innerWidth / 2,
		y: window.innerHeight / 2
	};
	const point = lastPointer.ready ? {
		x: lastPointer.x,
		y: lastPointer.y
	} : fallbackPoint;
	setContextMenuState({
		anchor: createVirtualElement(point),
		footer: options?.footer,
		header: options?.header,
		iconAlign: options?.iconAlign,
		iconSpaceMode: options?.iconSpaceMode ?? "global",
		items,
		open: true,
		triggerId: lastPointer.triggerId ?? null
	});
};
/**
* Update menu items while keeping current anchor/position.
* Useful for interactive menu items (e.g. checkbox) to avoid re-positioning.
*/
const updateContextMenuItems = (items) => {
	if (typeof window === "undefined") return;
	setContextMenuState({ items });
};
const closeContextMenu = () => {
	setContextMenuState({
		anchor: null,
		footer: void 0,
		header: void 0,
		iconSpaceMode: "global",
		items: [],
		open: false,
		triggerId: null
	});
};
//#endregion
export { closeContextMenu, getServerSnapshot, getSnapshot, setContextMenuState, showContextMenu, subscribe, updateContextMenuItems, updateLastPointer };

//# sourceMappingURL=store.mjs.map