"use client";
import Icon from "../Icon/Icon.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { styles } from "./style.mjs";
import { memo, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Button, ConfigProvider, Drawer, Modal } from "antd";
import { cssVar, cx, useResponsive } from "antd-style";
import { Maximize2, Minimize2, X } from "lucide-react";
//#region src/Modal/Modal.tsx
/**
* @deprecated Use `Modal` from `@lobehub/ui/base-ui` instead.
*/
const Modal$1 = memo(({ panelRef, allowFullscreen, children, title = " ", className, classNames, width = 700, onCancel, open, destroyOnHidden, paddings, height = "75dvh", enableResponsive = true, footer, styles: customStyles, okText, onOk, cancelText, okButtonProps, cancelButtonProps, confirmLoading, ...rest }) => {
	const [fullscreen, setFullscreen] = useState(false);
	const { mobile } = useResponsive();
	const hideFooter = footer === false || footer === null;
	if (enableResponsive && mobile) return /* @__PURE__ */ jsx(ConfigProvider, {
		theme: { token: { colorBgElevated: cssVar.colorBgContainer } },
		children: /* @__PURE__ */ jsx(Drawer, {
			className: cx(styles.drawerContent, className),
			closeIcon: /* @__PURE__ */ jsx(ActionIcon, { icon: X }),
			destroyOnHidden,
			height: fullscreen ? "calc(100% - env(safe-area-inset-top))" : height,
			open,
			panelRef,
			placement: "bottom",
			title,
			classNames: typeof classNames === "function" ? classNames : {
				...classNames,
				wrapper: cx(styles.wrap, classNames?.wrapper)
			},
			extra: allowFullscreen && /* @__PURE__ */ jsx(ActionIcon, {
				icon: fullscreen ? Minimize2 : Maximize2,
				onClick: () => setFullscreen(!fullscreen)
			}),
			footer: hideFooter ? null : footer || /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(Button, {
				color: "default",
				variant: "filled",
				onClick: onCancel,
				...cancelButtonProps,
				children: cancelText || "Cancel"
			}), /* @__PURE__ */ jsx(Button, {
				loading: confirmLoading,
				type: "primary",
				onClick: onOk,
				...okButtonProps,
				style: {
					marginInlineStart: 8,
					...okButtonProps?.style
				},
				children: okText || "OK"
			})] }),
			styles: typeof customStyles === "function" ? customStyles : {
				...customStyles,
				body: {
					paddingBlock: `16px ${footer ? 0 : "16px"}`,
					paddingInline: paddings?.desktop ?? 16,
					...customStyles?.body
				}
			},
			onClose: onCancel,
			...rest,
			children
		})
	});
	return /* @__PURE__ */ jsx(ConfigProvider, {
		theme: { token: { colorBgElevated: cssVar.colorBgContainer } },
		children: /* @__PURE__ */ jsx(Modal, {
			closable: true,
			cancelText,
			className: cx(styles.content, className),
			closeIcon: /* @__PURE__ */ jsx(Icon, {
				icon: X,
				size: 20
			}),
			confirmLoading,
			destroyOnHidden,
			footer: hideFooter ? null : footer,
			mask: { closable: true },
			okButtonProps,
			okText,
			open,
			panelRef,
			title,
			width,
			cancelButtonProps: {
				color: "default",
				variant: "filled",
				...cancelButtonProps
			},
			classNames: typeof classNames === "function" ? classNames : {
				...classNames,
				wrapper: cx(styles.wrap, classNames?.wrapper)
			},
			styles: typeof customStyles === "function" ? customStyles : {
				...customStyles,
				body: {
					maxHeight: height,
					overflow: "hidden auto",
					paddingBlock: `0 ${footer === null ? "16px" : 0}`,
					paddingInline: paddings?.desktop ?? 16,
					...customStyles?.body
				}
			},
			onCancel,
			onOk,
			...rest,
			children
		})
	});
});
Modal$1.displayName = "Modal";
//#endregion
export { Modal$1 as default };

//# sourceMappingURL=Modal.mjs.map