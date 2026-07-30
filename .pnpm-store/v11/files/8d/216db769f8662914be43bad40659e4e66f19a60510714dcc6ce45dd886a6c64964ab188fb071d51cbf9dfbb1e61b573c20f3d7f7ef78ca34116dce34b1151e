"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { FALLBACK_DARK, FALLBACK_LIGHT, styles, variants } from "./style.mjs";
import usePreview from "./components/usePreview.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Image, Skeleton } from "antd";
import { cssVar, cx, useThemeMode } from "antd-style";
//#region src/Image/Image.tsx
const Image$1 = memo(({ ref, style, preview, isLoading, maxHeight = "100%", maxWidth = "100%", minHeight, minWidth, actions, className, alwaysShowActions, variant = "filled", objectFit = "cover", classNames, styles: customStyles, onClick, width, height, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const actionsClassName = alwaysShowActions ? styles.actionsVisible : styles.actionsHidden;
	const mergePreview = usePreview(preview);
	if (isLoading) return /* @__PURE__ */ jsx("div", {
		onClick,
		children: /* @__PURE__ */ jsx(Skeleton.Avatar, {
			active: true,
			style: {
				borderRadius: cssVar.borderRadius,
				height,
				maxHeight,
				maxWidth,
				minHeight,
				minWidth,
				width
			}
		})
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({ variant }), className),
		ref,
		style,
		children: [actions && /* @__PURE__ */ jsx("div", {
			className: cx(actionsClassName, alwaysShowActions ? "" : "actions-hidden"),
			children: actions
		}), /* @__PURE__ */ jsx(Image, {
			className: cx(styles.image, classNames?.image),
			fallback: isDarkMode ? FALLBACK_DARK : FALLBACK_LIGHT,
			height,
			loading: "lazy",
			preview: preview === false ? false : mergePreview,
			width,
			classNames: { root: cx(styles.wrapper, classNames?.wrapper) },
			style: {
				maxHeight,
				maxWidth,
				minHeight,
				minWidth,
				objectFit: objectFit || "cover",
				...customStyles?.image
			},
			styles: { root: customStyles?.wrapper },
			onClick,
			...rest
		})]
	});
});
Image$1.displayName = "Image";
//#endregion
export { Image$1 as default };

//# sourceMappingURL=Image.mjs.map