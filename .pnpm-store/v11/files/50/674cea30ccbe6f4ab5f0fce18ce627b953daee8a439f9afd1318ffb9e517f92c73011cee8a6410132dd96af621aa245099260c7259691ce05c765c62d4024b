"use client";
import { useIsClient } from "../hooks/useIsClient.mjs";
import { useAppElement } from "../ThemeProvider/AppElementContext.mjs";
import { registerDevSingleton } from "../utils/devSingleton.mjs";
import { ModalStackItem } from "./ModalStackItem.mjs";
import { RawModalStackItem } from "./RawModalStackItem.mjs";
import { memo, useEffect, useSyncExternalStore } from "react";
import { jsx } from "react/jsx-runtime";
import { createPortal } from "react-dom";
//#region src/Modal/imperative.tsx
let modalStack = [];
let modalSeed = 0;
const listeners = /* @__PURE__ */ new Set();
const rawDestroyTimers = /* @__PURE__ */ new Map();
const notify = () => {
	listeners.forEach((listener) => listener());
};
const subscribe = (listener) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};
const EMPTY_STACK = [];
const getSnapshot = () => modalStack;
const getServerSnapshot = () => EMPTY_STACK;
const ModalPortal = ({ children, root }) => {
	const appElement = useAppElement();
	return createPortal(children, root ?? appElement ?? document.body);
};
const updateModal = (id, nextProps) => {
	let changed = false;
	modalStack = modalStack.map((item) => {
		if (item.id !== id) return item;
		if (item.kind !== "modal") return item;
		changed = true;
		return {
			...item,
			props: {
				...item.props,
				...nextProps
			}
		};
	});
	if (changed) notify();
};
const updateRawProps = (id, nextProps) => {
	let changed = false;
	modalStack = modalStack.map((item) => {
		if (item.id !== id) return item;
		if (item.kind !== "raw") return item;
		changed = true;
		return {
			...item,
			props: {
				...item.props,
				...nextProps
			}
		};
	});
	if (changed) notify();
};
const setRawOpen = (id, open) => {
	let changed = false;
	modalStack = modalStack.map((item) => {
		if (item.id !== id) return item;
		if (item.kind !== "raw") return item;
		if (item.open === open) return item;
		changed = true;
		return {
			...item,
			open
		};
	});
	if (open) {
		const timer = rawDestroyTimers.get(id);
		if (timer) {
			clearTimeout(timer);
			rawDestroyTimers.delete(id);
		}
	}
	if (changed) notify();
};
const closeModal = (id) => {
	const target = modalStack.find((item) => item.id === id);
	if (!target) return;
	if (target.kind === "modal") {
		updateModal(id, { open: false });
		return;
	}
	setRawOpen(id, false);
	if (!(target.options?.destroyOnClose ?? true)) return;
	const delay = target.options?.destroyDelay ?? 200;
	const existing = rawDestroyTimers.get(id);
	if (existing) clearTimeout(existing);
	const timer = window.setTimeout(() => {
		rawDestroyTimers.delete(id);
		destroyModal(id);
	}, delay);
	rawDestroyTimers.set(id, timer);
};
const destroyModal = (id) => {
	const timer = rawDestroyTimers.get(id);
	if (timer) {
		clearTimeout(timer);
		rawDestroyTimers.delete(id);
	}
	const nextStack = modalStack.filter((item) => item.id !== id);
	if (nextStack.length === modalStack.length) return;
	modalStack = nextStack;
	notify();
};
const ModalStack = memo(({ stack }) => {
	if (!useIsClient()) return null;
	return stack.map((item) => {
		if (item.kind === "modal") return /* @__PURE__ */ jsx(ModalStackItem, {
			id: item.id,
			props: item.props,
			onClose: closeModal,
			onDestroy: destroyModal,
			onUpdate: updateModal
		}, item.id);
		return /* @__PURE__ */ jsx(RawModalStackItem, {
			component: item.component,
			id: item.id,
			open: item.open,
			options: item.options,
			props: item.props,
			onClose: closeModal,
			onUpdate: updateRawProps
		}, item.id);
	});
});
ModalStack.displayName = "ModalStack";
const ModalHost = ({ root }) => {
	const stack = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	const isClient = useIsClient();
	useEffect(() => {
		if (!isClient) return;
		return registerDevSingleton("ModalHost", root ?? document.body);
	}, [isClient, root]);
	if (!isClient) return null;
	if (stack.length === 0) return null;
	return /* @__PURE__ */ jsx(ModalPortal, {
		root,
		children: /* @__PURE__ */ jsx(ModalStack, { stack })
	});
};
const createModal = (props) => {
	const id = `modal-${Date.now()}-${modalSeed++}`;
	modalStack = [...modalStack, {
		id,
		kind: "modal",
		props: {
			...props,
			open: props.open ?? true
		}
	}];
	notify();
	return {
		close: () => closeModal(id),
		destroy: () => destroyModal(id),
		setCanDismissByClickOutside: (value) => updateModal(id, { mask: { closable: value } }),
		update: (nextProps) => updateModal(id, nextProps)
	};
};
function createRawModal(component, props, options) {
	const id = `modal-${Date.now()}-${modalSeed++}`;
	modalStack = [...modalStack, {
		component,
		id,
		kind: "raw",
		open: true,
		options,
		props
	}];
	notify();
	return {
		close: () => closeModal(id),
		destroy: () => destroyModal(id),
		setCanDismissByClickOutside: (value) => updateRawProps(id, { mask: { closable: value } }),
		update: (nextProps) => updateRawProps(id, nextProps)
	};
}
//#endregion
export { ModalHost, createModal, createRawModal };

//# sourceMappingURL=imperative.mjs.map