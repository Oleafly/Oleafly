"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { memo, useMemo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Drawer } from "antd";
import { cssVar } from "antd-style";
import { XIcon } from "lucide-react";
//#region src/Drawer/Drawer.tsx
const Drawer$1 = memo(({ onClose, containerMaxWidth = 1024, classNames, title, placement, styles, children, height, width, extra, closeIconProps, noHeader, sidebarWidth = 280, sidebar, closeIcon, ref, ...rest }) => {
	const headerBorder = useMemo(() => {
		if (height === "100%" || width === "100%" || height === "100vh" || width === "100vw") return {};
		switch (placement) {
			case "top": return { borderBottom: `1px solid ${cssVar.colorBorder}` };
			case "bottom": return { borderTop: `1px solid ${cssVar.colorBorder}` };
			case "left": return { borderRight: `1px solid ${cssVar.colorBorder}` };
			case "right": return { borderLeft: `1px solid ${cssVar.colorBorder}` };
			default: return {};
		}
	}, [
		placement,
		height,
		width
	]);
	const extraNode = /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: classNames?.extra,
		gap: 4,
		justify: "flex-end",
		style: {
			position: "absolute",
			right: 4,
			top: 4,
			...styles?.extra
		},
		children: [extra, closeIcon || /* @__PURE__ */ jsx(ActionIcon, {
			icon: XIcon,
			onClick: onClose,
			...closeIconProps
		})]
	});
	const sidebarContent = /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(FlexBasic_default, {
		className: classNames?.sidebar,
		paddingBlock: 12,
		paddingInline: 16,
		width: sidebarWidth,
		style: {
			background: cssVar.colorBgLayout,
			borderRight: `1px solid ${cssVar.colorBorderSecondary}`,
			height: "100vh",
			overflowX: "hidden",
			overflowY: "auto",
			position: "sticky",
			top: 0,
			...styles?.sidebar
		},
		children: sidebar
	}), /* @__PURE__ */ jsx(FlexBasic_default, {
		className: classNames?.sidebarContent,
		flex: 1,
		paddingBlock: 12,
		paddingInline: 16,
		style: {
			background: cssVar.colorBgContainer,
			overflowX: "hidden",
			overflowY: "auto",
			...styles?.sidebarContent
		},
		children
	})] });
	return /* @__PURE__ */ jsx(Drawer, {
		classNames,
		closable: false,
		extra: noHeader ? void 0 : extraNode,
		height,
		keyboard: true,
		panelRef: ref,
		placement,
		width,
		styles: typeof styles === "function" ? styles : {
			...styles,
			body: {
				background: "transparent",
				paddingBlock: sidebar ? 0 : 12,
				paddingInline: sidebar ? 0 : 16,
				...styles?.body
			},
			header: {
				background: "transparent",
				display: noHeader ? "none" : void 0,
				padding: 4,
				...styles?.header
			},
			section: {
				background: sidebar ? `linear-gradient(to right, ${cssVar.colorBgLayout} 49.9%, ${cssVar.colorBgContainer} 50%)` : cssVar.colorBgContainer,
				...styles?.section
			},
			wrapper: {
				background: cssVar.colorBgContainer,
				...headerBorder,
				...styles?.wrapper
			}
		},
		title: /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: classNames?.title,
			justify: "flex-start",
			paddingBlock: 8,
			paddingInline: 16,
			style: {
				justifySelf: "center",
				maxWidth: containerMaxWidth,
				width: "100%",
				...styles?.title
			},
			children: title
		}),
		onClose,
		...rest,
		children: /* @__PURE__ */ jsxs(FlexBasic_default, {
			className: classNames?.bodyContent,
			horizontal: !!sidebar,
			style: {
				justifySelf: "center",
				maxWidth: containerMaxWidth,
				minHeight: "100%",
				overflow: sidebar ? "visible" : void 0,
				width: "100%",
				...styles?.bodyContent
			},
			children: [noHeader && extraNode, sidebar ? sidebarContent : children]
		})
	});
});
Drawer$1.displayName = "Drawer";
//#endregion
export { Drawer$1 as default };

//# sourceMappingURL=Drawer.mjs.map