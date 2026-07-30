"use client";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Modal/ModalProvider.tsx
const ModalContext = createContext({
	close: () => void 0,
	setCanDismissByClickOutside: () => void 0
});
const ModalProvider = memo(({ children, value }) => {
	return /* @__PURE__ */ jsx(ModalContext, {
		value,
		children
	});
});
const useModalContext = () => {
	return use(ModalContext);
};
//#endregion
export { ModalContext, ModalProvider, useModalContext };

//# sourceMappingURL=ModalProvider.mjs.map