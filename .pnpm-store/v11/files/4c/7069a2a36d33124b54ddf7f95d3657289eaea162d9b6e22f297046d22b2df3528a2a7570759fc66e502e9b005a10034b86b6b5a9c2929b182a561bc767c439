"use client";
import SpotlightCard from "../SpotlightCard/SpotlightCard.mjs";
import Item from "./FeatureItem.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/awesome/Features/Features.tsx
const Features = memo(({ items, className, itemClassName, itemStyle, maxWidth = 960, style, ...rest }) => {
	if (!items?.length) return;
	return /* @__PURE__ */ jsx(SpotlightCard, {
		className,
		items,
		style: {
			maxWidth,
			...style
		},
		renderItem: (item) => /* @__PURE__ */ jsx(Item, {
			className: itemClassName,
			style: itemStyle,
			...item
		}, item.title),
		...rest
	});
});
Features.displayName = "Features";
//#endregion
export { Features as default };

//# sourceMappingURL=Features.mjs.map