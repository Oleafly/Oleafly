"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Icon from "../../Icon/Icon.mjs";
import { styles } from "./style.mjs";
import { useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx, useTheme } from "antd-style";
import { AlertOctagon, AlertTriangle, Info, Lightbulb, MessageSquareWarning } from "lucide-react";
//#region src/mdx/Callout/index.tsx
const Callout = ({ children, type = "info", className, style, ...rest }) => {
	const theme = useTheme();
	const typeConfig = useMemo(() => ({
		error: {
			background: theme.colorErrorFillTertiary,
			color: cssVar.colorError,
			icon: AlertOctagon
		},
		important: {
			background: theme.purpleFillTertiary,
			color: cssVar.purple,
			icon: MessageSquareWarning
		},
		info: {
			background: theme.colorInfoFillTertiary,
			color: cssVar.colorInfo,
			icon: Info
		},
		tip: {
			background: theme.colorSuccessFillTertiary,
			color: cssVar.colorSuccess,
			icon: Lightbulb
		},
		warning: {
			background: theme.colorWarningFillTertiary,
			color: cssVar.colorWarning,
			icon: AlertTriangle
		}
	}), [theme]);
	const { icon, color, background } = typeConfig?.[type] || typeConfig.info;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "flex-start",
		className: cx(styles.container, className),
		style: {
			background,
			boxShadow: `0 0 0 1px ${background} inset`,
			color,
			...style
		},
		...rest,
		children: [/* @__PURE__ */ jsx(Icon, {
			icon,
			size: { size: "1.2em" },
			style: { marginBlock: "0.25em" }
		}), /* @__PURE__ */ jsx("div", {
			className: cx(styles.content, type === "info" && styles.underlineAnchor),
			children: /* @__PURE__ */ jsx("div", { children })
		})]
	});
};
Callout.displayName = "MdxCallout";
//#endregion
export { Callout as default };

//# sourceMappingURL=index.mjs.map