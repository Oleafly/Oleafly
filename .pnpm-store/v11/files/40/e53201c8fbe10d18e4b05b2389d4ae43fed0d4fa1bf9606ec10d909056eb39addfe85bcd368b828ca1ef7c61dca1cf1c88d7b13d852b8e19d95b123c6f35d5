"use client";
import A from "../../../A/index.mjs";
import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import Block from "../../../Block/Block.mjs";
import Text from "../../../Text/Text.mjs";
import Img from "../../../Img/index.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/Markdown/components/SearchResultCards/SearchResultCard.tsx
const SearchResultCard = memo(({ ref, url, title, alt, ...rest }) => {
	const [displayTitle, domain, host] = useMemo(() => {
		try {
			const urlObj = new URL(url);
			const domain = urlObj.hostname.replace("www.", "");
			const hostForUrl = urlObj.host;
			let displayTitle = title;
			if (title === url) displayTitle = hostForUrl + urlObj.pathname;
			return [
				displayTitle,
				domain,
				hostForUrl
			];
		} catch {
			return [
				title,
				url,
				url
			];
		}
	}, [url, title]);
	return /* @__PURE__ */ jsx(A, {
		href: url,
		ref,
		rel: "noreferrer",
		target: "_blank",
		...rest,
		children: /* @__PURE__ */ jsxs(Block, {
			clickable: true,
			className: styles.container,
			gap: 2,
			justify: "space-between",
			paddingBlock: 6,
			paddingInline: 8,
			variant: "outlined",
			children: [/* @__PURE__ */ jsx(Text, {
				ellipsis: { rows: 2 },
				children: displayTitle
			}), /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				gap: 4,
				children: [/* @__PURE__ */ jsx(Img, {
					alt: alt || title || url,
					height: 14,
					src: `https://icons.duckduckgo.com/ip3/${host}.ico`,
					width: 14
				}), /* @__PURE__ */ jsx(Text, {
					ellipsis: true,
					className: styles.url,
					type: "secondary",
					children: domain
				})]
			})]
		}, url)
	});
});
SearchResultCard.displayName = "SearchResultCard";
//#endregion
export { SearchResultCard as default };

//# sourceMappingURL=SearchResultCard.mjs.map