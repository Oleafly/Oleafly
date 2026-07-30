"use client";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
const PopoverContext = createContext({ close: process.env.NODE_ENV === "production" ? () => void 0 : () => {
	throw new Error("usePopoverContext must be used within a PopoverProvider");
} });
const PopoverProvider = memo(({ children, value }) => {
	return /* @__PURE__ */ jsx(PopoverContext, {
		value,
		children
	});
});
const usePopoverContext = () => {
	return use(PopoverContext);
};
//#endregion
export { PopoverContext, PopoverProvider, usePopoverContext };

//# sourceMappingURL=context.mjs.map