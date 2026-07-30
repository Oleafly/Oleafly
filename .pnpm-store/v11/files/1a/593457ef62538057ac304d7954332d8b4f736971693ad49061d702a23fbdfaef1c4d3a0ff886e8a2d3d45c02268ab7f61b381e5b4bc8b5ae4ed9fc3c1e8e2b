"use client";
import Accordion from "../Accordion/Accordion.mjs";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Icon from "../Icon/Icon.mjs";
import AccordionItem from "../Accordion/AccordionItem.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { extraHeaderVariants, extraVariants, rootVariants } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Alert } from "antd";
import { cssVar, cx, useTheme } from "antd-style";
import { camelCase } from "es-toolkit/compat";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
//#region src/Alert/Alert.tsx
const typeIcons = {
	error: XCircle,
	info: Info,
	secondary: AlertTriangle,
	success: CheckCircle,
	warning: AlertTriangle
};
const colors = (theme, type = "info", ...keys) => {
	if (type === "secondary") return theme[camelCase(["color", ...keys].join("-"))];
	return theme[camelCase([
		"color",
		type,
		...keys
	].join("-"))];
};
const Alert$1 = memo(({ closable = false, description, showIcon = true, type = "info", glass, icon, colorfulText = true, iconProps, style, extra, classNames, styles: customStyles, text, extraDefaultExpand = false, extraIsolate, banner, variant = "filled", ref, ...rest }) => {
	const theme = useTheme();
	const hasTitle = !!description;
	const alert = /* @__PURE__ */ jsx(Alert, {
		banner,
		description,
		ref,
		showIcon,
		type: type === "secondary" ? "info" : type,
		className: cx(rootVariants({
			closable: !!closable,
			colorfulText,
			glass,
			hasExtra: Boolean(!extraIsolate && !!extra),
			hasTitle,
			showIcon: !!showIcon,
			variant
		}), classNames?.alert),
		closable: typeof closable === "boolean" ? closable : {
			closeIcon: /* @__PURE__ */ jsx(ActionIcon, {
				color: colors(theme, type),
				icon: X,
				size: "small"
			}),
			...closable
		},
		icon: /* @__PURE__ */ jsx(Icon, {
			color: type === "secondary" ? cssVar.colorTextSecondary : void 0,
			icon: icon || typeIcons[type],
			size: description ? 24 : 18,
			...iconProps
		}),
		style: {
			background: colors(theme, type, "fillTertiary"),
			borderColor: colors(theme, type, "fillSecondary"),
			color: colorfulText ? colors(theme, type) : void 0,
			...style,
			...customStyles?.alert
		},
		...rest
	});
	if (!extra) return alert;
	if (extraIsolate) return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: classNames?.container,
		gap: 8,
		children: [alert, extra]
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: classNames?.container,
		style: customStyles?.container,
		children: [alert, /* @__PURE__ */ jsx(FlexBasic_default, {
			className: extraVariants({
				banner,
				variant
			}),
			style: {
				background: colors(theme, type, "fillTertiary"),
				borderColor: colors(theme, type, "fillSecondary"),
				color: colors(theme, type),
				fontSize: description ? 14 : 12
			},
			children: /* @__PURE__ */ jsx(Accordion, {
				defaultExpandedKeys: extraDefaultExpand ? ["extra"] : [],
				children: /* @__PURE__ */ jsx(AccordionItem, {
					itemKey: "extra",
					title: text?.detail || "Show Details",
					classNames: {
						content: classNames?.extraContent,
						header: extraHeaderVariants({
							hasTitle,
							variant
						})
					},
					styles: {
						content: {
							fontSize: 12,
							...customStyles?.extraContent
						},
						header: { borderColor: colors(theme, type, "fillSecondary") },
						indicator: { color: colors(theme, type) },
						title: {
							color: colors(theme, type),
							fontSize: 12
						}
					},
					children: extra
				})
			})
		})]
	});
});
Alert$1.displayName = "Alert";
//#endregion
export { Alert$1 as default };

//# sourceMappingURL=Alert.mjs.map