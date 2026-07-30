"use client";
import { Virtualizer as Virtualizer$1 } from "../components/Virtualizer.js";
import { createContext, useCallback, useContext, useState } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/react/Virtualizer.tsx
const VirtualizerContext = createContext(void 0);
function Virtualizer({ children, config, className, style, contentClassName, contentStyle }) {
	const [instance] = useState(() => {
		return typeof window !== "undefined" ? new Virtualizer$1(config) : void 0;
	});
	const ref = useCallback((node) => {
		if (node != null) instance?.setup(node);
		else instance?.cleanUp();
	}, [instance]);
	return /* @__PURE__ */ jsx(VirtualizerContext.Provider, {
		value: instance,
		children: /* @__PURE__ */ jsx("div", {
			className,
			style,
			ref,
			children: /* @__PURE__ */ jsx("div", {
				className: contentClassName,
				style: contentStyle,
				children
			})
		})
	});
}
function useVirtualizer() {
	return useContext(VirtualizerContext);
}
//#endregion
export { Virtualizer, VirtualizerContext, useVirtualizer };

//# sourceMappingURL=Virtualizer.js.map