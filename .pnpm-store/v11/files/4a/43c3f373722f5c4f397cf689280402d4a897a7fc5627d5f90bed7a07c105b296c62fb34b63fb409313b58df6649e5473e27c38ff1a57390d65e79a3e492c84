import { Fragment, jsx, jsxs } from "react/jsx-runtime";
//#region src/react/utils/templateRender.tsx
function templateRender(children, __html) {
	if (typeof window === "undefined" && __html != null) return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx("template", {
		shadowrootmode: "open",
		dangerouslySetInnerHTML: { __html }
	}), children] });
	return /* @__PURE__ */ jsx(Fragment, { children });
}
//#endregion
export { templateRender };

//# sourceMappingURL=templateRender.js.map