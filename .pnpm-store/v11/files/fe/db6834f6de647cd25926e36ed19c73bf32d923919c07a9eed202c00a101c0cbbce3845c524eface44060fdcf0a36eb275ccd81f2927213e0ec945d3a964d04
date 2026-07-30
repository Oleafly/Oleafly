"use client";
import { styles } from "./style.mjs";
import PopoverPanel from "./PopoverPanel.mjs";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { isEmpty } from "es-toolkit/compat";
//#region src/mdx/mdxComponents/Citation/index.tsx
const Citation = ({ children, href, inSup, id, citationDetail }) => {
	const usePopover = !isEmpty(citationDetail);
	const url = citationDetail?.url || href;
	if (inSup) return /* @__PURE__ */ jsx(PopoverPanel, {
		...citationDetail,
		usePopover,
		children: /* @__PURE__ */ jsx("span", {
			className: styles.container,
			children: /* @__PURE__ */ jsx("a", {
				"aria-describedby": "footnote-label",
				"data-footnote-ref": "true",
				href: url,
				id,
				rel: "noreferrer",
				target: citationDetail?.url ? "_blank" : void 0,
				children
			})
		})
	});
	return /* @__PURE__ */ jsx(PopoverPanel, {
		...citationDetail,
		usePopover,
		children: /* @__PURE__ */ jsx("sup", {
			className: cx(styles.container, styles.supContainer),
			children: url ? /* @__PURE__ */ jsx("a", {
				"aria-describedby": "footnote-label",
				"data-footnote-ref": true,
				href: url,
				rel: "noreferrer",
				target: "_blank",
				children
			}) : /* @__PURE__ */ jsx("span", {
				"aria-describedby": "footnote-label",
				"data-footnote-ref": true,
				children
			})
		})
	});
};
Citation.displayName = "MdxCitation";
//#endregion
export { Citation as default };

//# sourceMappingURL=index.mjs.map