"use client";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { styles } from "./style.mjs";
import { mapItems } from "./utils.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { Anchor, Collapse, ConfigProvider } from "antd";
import useMergeState from "use-merge-value";
import { PanelTopClose, PanelTopOpen } from "lucide-react";
//#region src/Toc/TocMobile.tsx
const TocMobile = memo(({ items, activeKey, onChange, getContainer, headerHeight = 64, tocWidth = 176 }) => {
	const [activeLink, setActiveLink] = useMergeState("", {
		onChange,
		value: activeKey
	});
	const activeAnchor = items.find((item) => item.id === activeLink);
	const tocItems = useMemo(() => mapItems(items), [items]);
	return /* @__PURE__ */ jsx(ConfigProvider, {
		theme: { token: {
			fontSize: 12,
			sizeStep: 3
		} },
		children: /* @__PURE__ */ jsx("section", {
			className: styles.mobileCtn,
			children: /* @__PURE__ */ jsx(Collapse, {
				ghost: true,
				className: styles.expand,
				expandIconPlacement: "end",
				expandIcon: ({ isActive }) => /* @__PURE__ */ jsx(ActionIcon, {
					icon: isActive ? PanelTopClose : PanelTopOpen,
					size: "small"
				}),
				children: /* @__PURE__ */ jsx(Collapse.Panel, {
					forceRender: true,
					header: activeAnchor ? activeAnchor.title : "TOC",
					children: /* @__PURE__ */ jsx(ConfigProvider, {
						theme: { token: {
							fontSize: 14,
							sizeStep: 4
						} },
						children: /* @__PURE__ */ jsx(Anchor, {
							getContainer,
							items: tocItems,
							targetOffset: headerHeight + 48,
							onChange: (currentLink) => {
								setActiveLink(currentLink.replace("#", ""));
							}
						})
					})
				}, "toc")
			})
		})
	});
});
TocMobile.displayName = "TocMobile";
//#endregion
export { TocMobile as default };

//# sourceMappingURL=TocMobile.mjs.map