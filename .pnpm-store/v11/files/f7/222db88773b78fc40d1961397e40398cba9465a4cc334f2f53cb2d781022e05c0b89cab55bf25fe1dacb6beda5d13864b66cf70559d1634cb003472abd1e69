"use client";
import { useIsClient } from "../../hooks/useIsClient.mjs";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { acquireLayerZIndex } from "../zIndex/manager.mjs";
import { ToastContext } from "./context.mjs";
import { viewportVariants } from "./style.mjs";
import ToastItem from "./Toast.mjs";
import { memo, useEffect, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Toast } from "@base-ui/react/toast";
//#region src/base-ui/Toast/imperative.tsx
const ALL_POSITIONS = [
	"top",
	"top-left",
	"top-right",
	"bottom",
	"bottom-left",
	"bottom-right"
];
let globalState = {
	duration: 5e3,
	limit: 5,
	position: "bottom-right",
	swipeDirection: ["down", "right"]
};
const toastManagers = {
	"bottom": Toast.createToastManager(),
	"bottom-left": Toast.createToastManager(),
	"bottom-right": Toast.createToastManager(),
	"top": Toast.createToastManager(),
	"top-left": Toast.createToastManager(),
	"top-right": Toast.createToastManager()
};
const activeToastIds = {
	"bottom": /* @__PURE__ */ new Set(),
	"bottom-left": /* @__PURE__ */ new Set(),
	"bottom-right": /* @__PURE__ */ new Set(),
	"top": /* @__PURE__ */ new Set(),
	"top-left": /* @__PURE__ */ new Set(),
	"top-right": /* @__PURE__ */ new Set()
};
const getManager = (position) => toastManagers[position];
const normalizeOptions = (optionsOrMessage, type) => {
	if (typeof optionsOrMessage === "string") return {
		description: optionsOrMessage,
		type
	};
	return {
		...optionsOrMessage,
		type
	};
};
const createToastInstance = (id, position) => ({
	close: () => getManager(position).close(id),
	id,
	update: (options) => {
		getManager(position).update(id, {
			data: options,
			description: options.description,
			title: options.title
		});
	}
});
const addToast = (options) => {
	const position = options.placement ?? globalState.position;
	const manager = getManager(position);
	const onRemove = options.onRemove;
	const id = manager.add({
		data: options,
		description: options.description,
		onClose: options.onClose,
		onRemove: () => {
			activeToastIds[position].delete(id);
			onRemove?.();
		},
		timeout: options.duration ?? globalState.duration,
		title: options.title
	});
	activeToastIds[position].add(id);
	return createToastInstance(id, position);
};
const dismissToast = (id) => {
	if (id) for (const [position, manager] of Object.entries(toastManagers)) {
		activeToastIds[position].delete(id);
		manager.close(id);
	}
	else for (const [position, manager] of Object.entries(toastManagers)) {
		const ids = Array.from(activeToastIds[position]);
		for (const toastId of ids) manager.close(toastId);
		activeToastIds[position].clear();
	}
};
const createSuccessToast = (optionsOrMessage) => {
	return addToast(normalizeOptions(optionsOrMessage, "success"));
};
const createErrorToast = (optionsOrMessage) => {
	return addToast(normalizeOptions(optionsOrMessage, "error"));
};
const createInfoToast = (optionsOrMessage) => {
	return addToast(normalizeOptions(optionsOrMessage, "info"));
};
const createWarningToast = (optionsOrMessage) => {
	return addToast(normalizeOptions(optionsOrMessage, "warning"));
};
const createLoadingToast = (optionsOrMessage) => {
	const options = normalizeOptions(optionsOrMessage, "loading");
	return addToast({
		duration: 0,
		...options
	});
};
async function promiseToast(promise, options) {
	const loadingOptions = typeof options.loading === "string" ? { description: options.loading } : options.loading;
	const loadingToast = addToast({
		closable: false,
		duration: 0,
		type: "loading",
		...loadingOptions
	});
	try {
		const result = await promise;
		loadingToast.close();
		const successOptions = (() => {
			if (typeof options.success === "string") return { description: options.success };
			if (typeof options.success === "function") return { description: options.success(result) };
			return options.success;
		})();
		addToast({
			type: "success",
			...successOptions
		});
		return result;
	} catch (error) {
		loadingToast.close();
		const errorOptions = (() => {
			if (typeof options.error === "string") return { description: options.error };
			if (typeof options.error === "function") return { description: options.error(error) };
			return options.error;
		})();
		addToast({
			type: "error",
			...errorOptions
		});
		throw error;
	}
}
const baseToast = (options) => {
	return addToast({
		type: "default",
		...options
	});
};
const toast = Object.assign(baseToast, {
	dismiss: dismissToast,
	error: createErrorToast,
	info: createInfoToast,
	loading: createLoadingToast,
	promise: promiseToast,
	success: createSuccessToast,
	warning: createWarningToast
});
const ToastList = memo(() => {
	const { toasts } = Toast.useToastManager();
	return toasts.map((t) => /* @__PURE__ */ jsx(ToastItem, { toast: t }, t.id));
});
ToastList.displayName = "ToastList";
const ToastHost = memo(({ root, className, duration = 5e3, limit = 5, position = "bottom-right", swipeDirection = ["down", "right"] }) => {
	const isClient = useIsClient();
	const appElement = useAppElement();
	const [viewportZIndex, setViewportZIndex] = useState(void 0);
	useEffect(() => {
		globalState = {
			duration,
			limit,
			position,
			swipeDirection
		};
	}, [
		duration,
		limit,
		position,
		swipeDirection
	]);
	useEffect(() => {
		setViewportZIndex(acquireLayerZIndex("toast"));
	}, []);
	if (!isClient) return null;
	const container = root ?? appElement ?? document.body;
	return ALL_POSITIONS.map((pos) => /* @__PURE__ */ jsx(ToastContext, {
		value: {
			position: pos,
			swipeDirection
		},
		children: /* @__PURE__ */ jsx(Toast.Provider, {
			limit,
			timeout: duration,
			toastManager: getManager(pos),
			children: /* @__PURE__ */ jsx(Toast.Portal, {
				container,
				children: /* @__PURE__ */ jsx(Toast.Viewport, {
					className: cx(viewportVariants({ position: pos }), className),
					style: { zIndex: viewportZIndex },
					children: /* @__PURE__ */ jsx(ToastList, {})
				})
			})
		})
	}, pos));
});
ToastHost.displayName = "ToastHost";
const useToast = () => toast;
//#endregion
export { ToastHost, toast, useToast };

//# sourceMappingURL=imperative.mjs.map