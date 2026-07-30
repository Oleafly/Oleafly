"use client";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Icon/components/IconProvider.tsx
const IconContext = createContext({});
const IconProvider = memo(({ children, config = {} }) => {
	return /* @__PURE__ */ jsx(IconContext, {
		value: config,
		children
	});
});
const useIconContext = () => {
	return use(IconContext);
};
//#endregion
export { IconContext, IconProvider, useIconContext };

//# sourceMappingURL=IconProvider.mjs.map