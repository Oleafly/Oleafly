"use client";
import Footnotes from "../../Markdown/components/Footnotes.mjs";
import { jsx } from "react/jsx-runtime";
//#region src/mdx/mdxComponents/Section.tsx
const Section = ({ children, showFootnotes, ...rest }) => {
	if (rest["data-footnotes"]) {
		if (!showFootnotes) return null;
		return /* @__PURE__ */ jsx(Footnotes, {
			...rest,
			children
		});
	}
	return /* @__PURE__ */ jsx("section", {
		...rest,
		children
	});
};
Section.displayName = "MdxSection";
//#endregion
export { Section as default };

//# sourceMappingURL=Section.mjs.map