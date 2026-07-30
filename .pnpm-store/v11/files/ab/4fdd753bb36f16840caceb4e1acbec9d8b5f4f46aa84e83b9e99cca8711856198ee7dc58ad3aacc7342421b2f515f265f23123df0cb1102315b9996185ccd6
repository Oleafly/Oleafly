"use client";
import Center from "../Flex/Center.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Drawer, Menu } from "antd";
import { cx } from "antd-style";
import { MenuIcon, X } from "lucide-react";
//#region src/Burger/Burger.tsx
const Burger = memo(({ items, openKeys, selectedKeys, opened, setOpened, className, headerHeight = 64, onClick, iconProps, size, variant, rootClassName, fullscreen, drawerProps, ...rest }) => {
	const cssVariables = useMemo(() => {
		const vars = { "--burger-header-height": `${headerHeight}px` };
		if (fullscreen) {
			vars["--burger-drawer-top"] = "0";
			vars["--burger-menu-padding-top"] = "0px";
		} else {
			vars["--burger-drawer-top"] = `calc(var(--burger-header-height, ${headerHeight}px) + 1px)`;
			vars["--burger-menu-padding-top"] = `${headerHeight}px`;
		}
		return vars;
	}, [fullscreen, headerHeight]);
	return /* @__PURE__ */ jsxs(Center, {
		className: cx(styles.container, className),
		onClick: () => {
			setOpened(!opened);
		},
		...rest,
		children: [/* @__PURE__ */ jsx(ActionIcon, {
			icon: opened ? X : MenuIcon,
			size,
			variant,
			...iconProps
		}), /* @__PURE__ */ jsxs(Drawer, {
			closeIcon: void 0,
			open: opened,
			placement: "left",
			width: "100vw",
			...drawerProps,
			className: styles.drawer,
			rootClassName: cx(fullscreen ? styles.drawerRootFullscreen : styles.drawerRoot, rootClassName),
			rootStyle: {
				...cssVariables,
				...drawerProps?.rootStyle
			},
			styles: {
				body: { padding: 0 },
				header: { display: "none" }
			},
			children: [/* @__PURE__ */ jsx(Menu, {
				className: styles.menu,
				items,
				mode: "inline",
				openKeys,
				selectedKeys,
				style: cssVariables,
				onClick
			}), /* @__PURE__ */ jsx("div", { className: styles.fillRect })]
		})]
	});
});
Burger.displayName = "Burger";
//#endregion
export { Burger as default };

//# sourceMappingURL=Burger.mjs.map