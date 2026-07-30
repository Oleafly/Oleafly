"use client";
import { useStableValue } from "../../hooks/useStableValue.mjs";
import { createContext, memo, use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Markdown/components/MarkdownProvider.tsx
const MarkdownContext = createContext({});
const MarkdownProvider = memo(({ children, ...config }) => {
	const stableConfig = useStableValue(config);
	return /* @__PURE__ */ jsx(MarkdownContext, {
		value: stableConfig,
		children
	});
});
const useMarkdownContext = () => {
	return use(MarkdownContext);
};
//#endregion
export { MarkdownContext, MarkdownProvider, useMarkdownContext };

//# sourceMappingURL=MarkdownProvider.mjs.map