"use client";
import A from "../../A/index.mjs";
import { safeParseJSON } from "../../utils/safeParseJSON.mjs";
import Citation from "./Citation/index.mjs";
import { jsx } from "react/jsx-runtime";
//#region src/mdx/mdxComponents/Link.tsx
const Link = ({ href, target, citations, ...rest }) => {
	if (rest["data-footnote-ref"]) return /* @__PURE__ */ jsx(Citation, {
		inSup: true,
		citationDetail: safeParseJSON(rest["data-link"]),
		href,
		id: rest.id,
		children: rest.children
	});
	const match = href?.match(/citation-(\d+)/);
	if (match) {
		const index = Number.parseInt(match[1]) - 1;
		const detail = citations?.[index];
		return /* @__PURE__ */ jsx(Citation, {
			citationDetail: detail,
			id: match[1],
			children: match[1]
		});
	}
	const isNewWindow = href?.startsWith("http");
	return /* @__PURE__ */ jsx(A, {
		href,
		target: target || isNewWindow ? "_blank" : void 0,
		...rest
	});
};
Link.displayName = "MdxLink";
//#endregion
export { Link as default };

//# sourceMappingURL=Link.mjs.map