"use client";
import ScrollShadow from "../../../ScrollShadow/ScrollShadow.mjs";
import SearchResultCard from "./SearchResultCard.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Markdown/components/SearchResultCards/index.tsx
const SearchResultCards = memo(({ ref, dataSource, style, ...rest }) => {
	return /* @__PURE__ */ jsx(ScrollShadow, {
		hideScrollBar: true,
		horizontal: true,
		gap: 12,
		orientation: "horizontal",
		ref,
		size: 10,
		style: {
			minHeight: 80,
			overflowX: "scroll",
			paddingInlineEnd: 24,
			width: "100%",
			...style
		},
		...rest,
		children: dataSource.map((link) => typeof link === "string" ? /* @__PURE__ */ jsx(SearchResultCard, { url: link }, link) : /* @__PURE__ */ jsx(SearchResultCard, { ...link }, link.url))
	});
});
SearchResultCards.displayName = "SearchResultCards";
//#endregion
export { SearchResultCards as default };

//# sourceMappingURL=index.mjs.map