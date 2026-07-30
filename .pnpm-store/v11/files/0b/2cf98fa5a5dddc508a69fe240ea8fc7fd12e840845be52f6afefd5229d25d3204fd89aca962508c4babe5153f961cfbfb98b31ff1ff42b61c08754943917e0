"use client";
import { useEventCallback } from "../hooks/useEventCallback.mjs";
import Modal from "./Modal.mjs";
import { ModalProvider } from "./ModalProvider.mjs";
import { memo, useCallback, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Modal/ModalStackItem.tsx
const noop = () => {};
const ModalStackItem = memo(({ id, props, onClose, onUpdate, onDestroy }) => {
	const { afterClose, afterOpenChange, children, onCancel, open, ...rest } = props;
	const stableAfterClose = useEventCallback(afterClose ?? noop);
	const stableAfterOpenChange = useEventCallback(afterOpenChange ?? noop);
	const stableOnCancel = useEventCallback(onCancel ?? noop);
	const close = useEventCallback(() => onClose(id));
	const setCanDismissByClickOutside = useEventCallback((value) => onUpdate(id, { mask: { closable: value } }));
	const stableContextValue = useMemo(() => ({
		close,
		setCanDismissByClickOutside
	}), [close, setCanDismissByClickOutside]);
	return /* @__PURE__ */ jsx(Modal, {
		...rest,
		open: open ?? true,
		afterClose: useCallback(() => {
			stableAfterClose?.();
			onDestroy(id);
		}, [
			stableAfterClose,
			onDestroy,
			id
		]),
		afterOpenChange: useCallback((nextOpen) => {
			stableAfterOpenChange?.(nextOpen);
			if (!nextOpen) onDestroy(id);
		}, [
			stableAfterOpenChange,
			onDestroy,
			id
		]),
		onCancel: useCallback((e) => {
			stableOnCancel?.(e);
			close();
		}, [stableOnCancel, close]),
		children: /* @__PURE__ */ jsx(ModalProvider, {
			value: stableContextValue,
			children
		})
	});
});
ModalStackItem.displayName = "ModalStackItem";
//#endregion
export { ModalStackItem };

//# sourceMappingURL=ModalStackItem.mjs.map