"use client";
import Center from "../Flex/Center.mjs";
import Icon from "../Icon/Icon.mjs";
import { Tooltip } from "../base-ui/Tooltip/Tooltip.mjs";
import { calcSize } from "./components/utils.mjs";
import { variants } from "./style.mjs";
import { memo, useCallback, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Loader2 } from "lucide-react";
//#region src/ActionIcon/ActionIcon.tsx
const ActionIcon = memo(({ color, fill, className, active, icon, size = "middle", variant = "borderless", style, glass, title, onClick, loading, fillOpacity, fillRule, focusable, shadow, disabled, spin: iconSpinning, tooltipProps, danger, ref, ...rest }) => {
	const { blockSize, borderRadius } = useMemo(() => calcSize(size), [size]);
	const popupTriggerAria = rest;
	const isPopupTrigger = popupTriggerAria["aria-haspopup"] !== void 0 || popupTriggerAria["aria-expanded"] !== void 0;
	const popupTriggerLabel = popupTriggerAria["aria-label"] ?? (isPopupTrigger && typeof title === "string" ? title : void 0);
	const handleClick = useCallback((event) => {
		if (loading || disabled) return;
		onClick?.(event);
	}, [
		loading,
		disabled,
		onClick
	]);
	const node = /* @__PURE__ */ jsx(Center, {
		horizontal: true,
		className: cx(variants({
			active,
			danger,
			disabled,
			glass,
			shadow,
			variant
		}), className),
		flex: "none",
		ref,
		role: "button",
		style: {
			borderRadius,
			height: blockSize,
			width: blockSize,
			...style
		},
		tabIndex: disabled ? -1 : 0,
		onClick: handleClick,
		...rest,
		"aria-label": popupTriggerLabel,
		children: icon && /* @__PURE__ */ jsx(Icon, {
			color,
			fill,
			fillOpacity,
			fillRule,
			focusable,
			icon: loading ? Loader2 : icon,
			size,
			spin: loading ? true : iconSpinning,
			style: { pointerEvents: "none" }
		})
	});
	if (!title) return node;
	return /* @__PURE__ */ jsx(Tooltip, {
		title,
		...tooltipProps,
		styles: typeof tooltipProps?.styles === "function" ? tooltipProps.styles : {
			...tooltipProps?.styles,
			container: {
				pointerEvents: "none",
				...tooltipProps?.styles?.container
			}
		},
		children: node
	});
});
ActionIcon.displayName = "ActionIcon";
//#endregion
export { ActionIcon as default };

//# sourceMappingURL=ActionIcon.mjs.map