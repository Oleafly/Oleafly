"use client";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/MotionProvider/index.tsx
const MotionComponent = createContext(null);
const MotionProvider = memo(({ children, motion }) => {
	return /* @__PURE__ */ jsx(MotionComponent, {
		value: motion,
		children
	});
});
const useMotionComponent = () => {
	const context = use(MotionComponent);
	if (!context) throw new Error("Please wrap your app with <ConfigProvider> (or <MotionProvider>) and pass the motion component");
	return context;
};
//#endregion
export { MotionComponent, MotionProvider, useMotionComponent };

//# sourceMappingURL=index.mjs.map