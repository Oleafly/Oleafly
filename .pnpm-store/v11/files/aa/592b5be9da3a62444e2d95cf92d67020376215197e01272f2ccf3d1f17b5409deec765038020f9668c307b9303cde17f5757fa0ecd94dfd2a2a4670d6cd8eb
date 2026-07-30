"use client";
import { useEventCallback } from "../hooks/useEventCallback.mjs";
import { ModalProvider } from "./ModalProvider.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Modal/RawModalStackItem.tsx
const RawModalStackItem = memo(({ component: Component, id, onClose, onUpdate, open, options, props }) => {
	const stableOnClose = useEventCallback(onClose);
	const close = useEventCallback(() => stableOnClose(id));
	const setCanDismissByClickOutside = useEventCallback((value) => {
		onUpdate(id, { mask: { closable: value } });
	});
	const contextValue = useMemo(() => ({
		close,
		setCanDismissByClickOutside
	}), [close, setCanDismissByClickOutside]);
	const openKey = options?.openKey ?? "open";
	const onCloseKey = options?.onCloseKey ?? "onClose";
	return /* @__PURE__ */ jsx(ModalProvider, {
		value: contextValue,
		children: /* @__PURE__ */ jsx(Component, {
			...props,
			[onCloseKey]: close,
			[openKey]: open
		})
	});
});
RawModalStackItem.displayName = "RawModalStackItem";
//#endregion
export { RawModalStackItem };

//# sourceMappingURL=RawModalStackItem.mjs.map