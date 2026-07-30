"use client";
import { styles } from "./style.mjs";
import { mapItems } from "./utils.mjs";
import TocMobile from "./TocMobile.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Anchor } from "antd";
import { cx } from "antd-style";
//#region src/Toc/Toc.tsx
const Toc = memo(({ activeKey, items, getContainer, isMobile, headerHeight = 64, tocWidth = 176 }) => {
	const cssVariables = useMemo(() => ({
		"--toc-header-height": `${headerHeight}px`,
		"--toc-width": `${tocWidth}px`
	}), [headerHeight, tocWidth]);
	if (isMobile) return /* @__PURE__ */ jsx(TocMobile, {
		activeKey,
		getContainer,
		headerHeight,
		items
	});
	return /* @__PURE__ */ jsxs("section", {
		className: cx(styles.container, styles.anchor),
		style: cssVariables,
		children: [/* @__PURE__ */ jsx("h4", { children: "Table of Contents" }), /* @__PURE__ */ jsx(Anchor, {
			getContainer,
			items: mapItems(items),
			targetOffset: headerHeight + 12
		})]
	});
});
Toc.displayName = "Toc";
//#endregion
export { Toc as default };

//# sourceMappingURL=Toc.mjs.map