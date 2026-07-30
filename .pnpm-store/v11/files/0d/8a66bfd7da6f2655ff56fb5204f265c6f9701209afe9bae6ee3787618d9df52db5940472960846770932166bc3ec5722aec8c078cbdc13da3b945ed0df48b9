"use client";
import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import Icon from "../../../Icon/Icon.mjs";
import { styles } from "./style.mjs";
import { useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Popover } from "antd";
import { ArrowRightIcon } from "lucide-react";
//#region src/mdx/mdxComponents/Citation/PopoverPanel.tsx
const PopoverPanel = ({ children, usePopover, title, alt, url }) => {
	const [displayTitle, domain, host] = useMemo(() => {
		try {
			const urlObj = new URL(url);
			const hostForUrl = urlObj.host;
			let displayTitle = title;
			if (title === url) displayTitle = "";
			let domain = urlObj.hostname.replace("www.", "");
			if (!displayTitle) domain = url;
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
	return usePopover && url ? /* @__PURE__ */ jsx(Popover, {
		arrow: false,
		trigger: "hover",
		content: /* @__PURE__ */ jsxs(FlexBasic_default, {
			gap: 8,
			children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				className: styles.link,
				gap: 12,
				justify: "space-between",
				onClick: () => {
					window.open(url, "_blank");
				},
				children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
					horizontal: true,
					align: "center",
					gap: 4,
					children: [/* @__PURE__ */ jsx("img", {
						alt: alt || title || url,
						height: 14,
						src: `https://icons.duckduckgo.com/ip3/${host}.ico`,
						style: { borderRadius: 4 },
						width: 14
					}), /* @__PURE__ */ jsx("span", {
						className: styles.url,
						children: domain
					})]
				}), /* @__PURE__ */ jsx(Icon, { icon: ArrowRightIcon })]
			}), displayTitle]
		}),
		children
	}) : children;
};
PopoverPanel.displayName = "MdxPopoverPanel";
//#endregion
export { PopoverPanel as default };

//# sourceMappingURL=PopoverPanel.mjs.map