"use client";
import { useIconContext } from "./components/IconProvider.mjs";
import { calcSize } from "./components/utils.mjs";
import { variants } from "./style.mjs";
import { isValidElement, memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Icon/Icon.tsx
const Icon = memo(({ icon, size: iconSize, color, fill = "transparent", className, focusable, spin, fillRule, fillOpacity, ref, ...rest }) => {
	const { color: colorConfig, fill: fillConfig, fillOpacity: fillOpacityConfig, fillRule: fillRuleConfig, focusable: focusableConfig, className: classNameConfig, size: sizeConfig, ...restConfig } = useIconContext();
	const { size, strokeWidth } = useMemo(() => calcSize(iconSize || sizeConfig), [iconSize, sizeConfig]);
	const SvgIcon = icon;
	return /* @__PURE__ */ jsx("span", {
		className: cx(variants({ spin }), classNameConfig, className),
		role: "img",
		...restConfig,
		...rest,
		children: icon && (isValidElement(icon) ? icon : /* @__PURE__ */ jsx(SvgIcon, {
			color: color || colorConfig,
			fill: fill || fillConfig,
			fillOpacity: fillOpacity || fillOpacityConfig,
			fillRule: fillRule || fillRuleConfig,
			focusable: focusable || focusableConfig,
			height: size,
			ref,
			size,
			strokeWidth,
			width: size
		}))
	});
});
Icon.displayName = "Icon";
//#endregion
export { Icon as default };

//# sourceMappingURL=Icon.mjs.map