"use client";
import DraggablePanel from "../DraggablePanel/index.mjs";
import { styles } from "./style.mjs";
import { LayoutFooter } from "./components/LayoutFooter.mjs";
import { LayoutHeader } from "./components/LayoutHeader.mjs";
import { LayoutMain } from "./components/LayoutMain.mjs";
import { LayoutSidebar } from "./components/LayoutSidebar.mjs";
import { LayoutSidebarInner } from "./components/LayoutSidebarInner.mjs";
import { LayoutToc } from "./components/LayoutToc.mjs";
import { memo, useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { useResponsive } from "antd-style";
//#region src/Layout/Layout.tsx
const Layout = memo(({ helmet, headerHeight = 64, header, footer, sidebar, asideWidth, toc, children, tocWidth }) => {
	const cssVariables = useMemo(() => ({ "--layout-header-height": `${headerHeight}px` }), [headerHeight]);
	const { mobile, laptop } = useResponsive();
	const [expand, setExpand] = useState(true);
	useEffect(() => {
		setExpand(Boolean(laptop));
	}, [laptop]);
	return /* @__PURE__ */ jsxs("div", {
		style: cssVariables,
		children: [
			helmet,
			header && /* @__PURE__ */ jsxs(LayoutHeader, {
				headerHeight,
				children: [header, mobile && toc && /* @__PURE__ */ jsx(LayoutToc, { children: toc })]
			}),
			/* @__PURE__ */ jsxs(LayoutMain, { children: [
				!mobile && !sidebar && /* @__PURE__ */ jsx("nav", { style: { width: tocWidth } }),
				!mobile && sidebar && /* @__PURE__ */ jsx(LayoutSidebar, {
					headerHeight,
					children: /* @__PURE__ */ jsx(DraggablePanel, {
						expand,
						maxWidth: asideWidth,
						placement: "left",
						onExpandChange: setExpand,
						children: /* @__PURE__ */ jsx(LayoutSidebarInner, {
							headerHeight,
							children: sidebar
						})
					})
				}),
				/* @__PURE__ */ jsx("section", {
					className: styles.content,
					children
				}),
				!mobile && toc && /* @__PURE__ */ jsx(LayoutToc, {
					tocWidth,
					children: toc
				})
			] }),
			footer && /* @__PURE__ */ jsx(LayoutFooter, { children: footer })
		]
	});
});
//#endregion
export { Layout as default };

//# sourceMappingURL=Layout.mjs.map