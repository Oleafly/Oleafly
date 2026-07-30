"use client";
import A from "../../A/index.mjs";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Block from "../../Block/Block.mjs";
import Text from "../../Text/Text.mjs";
import SearchResultCards from "./SearchResultCards/index.mjs";
import { createElement, memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/Markdown/components/Footnotes.tsx
const DefaultFootnotes = memo(({ dataSource }) => {
	const items = useMemo(() => dataSource.find((child) => child?.type === "ol")?.props?.children?.map((item) => {
		if (typeof item === "string" || item?.type !== "li") return false;
		const data = item?.props?.children?.find((note) => note?.props?.children)?.props?.children;
		if (!data || !Array.isArray(data)) return false;
		return {
			children: data[0],
			props: data[1]?.props || {}
		};
	}).filter(Boolean), [dataSource]);
	if (!Array.isArray(items)) return null;
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "flex-start",
		as: "section",
		className: "footnotes",
		"data-footnotes": "true",
		gap: "0.5em",
		justify: "flex-start",
		wrap: "wrap",
		children: items.map(({ children, props }, index) => {
			const { node, href, ...rest } = props;
			return /* @__PURE__ */ createElement(href ? A : "div", {
				...href ? {
					href,
					...rest
				} : rest,
				key: index
			}, /* @__PURE__ */ jsxs(Block, {
				horizontal: true,
				align: "stretch",
				style: {
					overflow: "hidden",
					position: "relative"
				},
				variant: "outlined",
				children: [/* @__PURE__ */ jsx(Block, {
					paddingInline: "0.66em",
					style: { borderRadius: 0 },
					variant: "filled",
					children: /* @__PURE__ */ jsx(Text, {
						code: true,
						as: "span",
						type: "secondary",
						children: index + 1
					})
				}), /* @__PURE__ */ jsx(Text, {
					as: "span",
					style: { paddingInline: "0.66em" },
					type: "secondary",
					children
				})]
			}));
		})
	});
});
const Footnotes = memo(({ children, ...rest }) => {
	const links = useMemo(() => {
		try {
			return JSON.parse(rest["data-footnote-links"] || "[]");
		} catch (error) {
			console.error("Failed to parse footnote links:", error);
			return [];
		}
	}, [rest["data-footnote-links"]]);
	const isError = links.length === 0;
	if (!children) return;
	if (isError) {
		if (!Array.isArray(children)) return children;
		return /* @__PURE__ */ jsx(DefaultFootnotes, { dataSource: children });
	}
	return /* @__PURE__ */ jsx("section", {
		className: "footnotes",
		"data-footnotes": "true",
		children: /* @__PURE__ */ jsx(SearchResultCards, { dataSource: links })
	});
});
Footnotes.displayName = "Footnotes";
//#endregion
export { Footnotes as default };

//# sourceMappingURL=Footnotes.mjs.map