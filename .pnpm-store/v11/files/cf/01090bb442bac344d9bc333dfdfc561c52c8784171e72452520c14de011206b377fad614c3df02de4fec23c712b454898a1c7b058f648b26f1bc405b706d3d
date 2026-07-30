"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Block from "../Block/Block.mjs";
import Icon from "../Icon/Icon.mjs";
import Text from "../Text/Text.mjs";
import FluentEmoji from "../FluentEmoji/FluentEmoji.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { Empty } from "antd";
import { cssVar, useThemeMode } from "antd-style";
//#region src/Empty/Empty.tsx
const Empty$1 = ({ title, description, icon, image, emoji, imageSize = 48, iconColor, action, children, imageProps, align, actionProps, type = "default", titleProps, descriptionProps, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const isPage = type === "page";
	const alignValue = align || (isPage ? "flex-start" : "center");
	const isCenter = alignValue === "center";
	const fallbackImage = Empty.PRESENTED_IMAGE_SIMPLE;
	const cover = image || emoji || icon ? image ? image : /* @__PURE__ */ jsxs(Block, {
		align: "center",
		flex: "none",
		height: imageSize,
		justify: "center",
		variant: "outlined",
		width: imageSize,
		...imageProps,
		style: {
			marginBottom: 4,
			...imageProps?.style
		},
		children: [icon && /* @__PURE__ */ jsx(Icon, {
			icon,
			size: imageSize * .66,
			color: iconColor || (isDarkMode ? cssVar.colorTextQuaternary : cssVar.colorTextSecondary)
		}), emoji && /* @__PURE__ */ jsx(FluentEmoji, {
			emoji,
			size: imageSize * .75,
			type: "anim"
		})]
	}) : fallbackImage;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: alignValue,
		gap: 8,
		padding: 16,
		...rest,
		children: [
			cover,
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				align: alignValue,
				gap: isPage ? 4 : 1,
				children: [title && /* @__PURE__ */ jsx(Text, {
					align: isCenter ? "center" : void 0,
					fontSize: isPage ? 24 : 16,
					weight: "bold",
					...titleProps,
					children: title
				}), description && /* @__PURE__ */ jsx(Text, {
					align: isCenter ? "center" : void 0,
					color: isPage ? cssVar.colorTextSecondary : cssVar.colorTextDescription,
					fontSize: isPage ? 16 : 14,
					...descriptionProps,
					children: description
				})]
			}),
			children,
			action && /* @__PURE__ */ jsx(FlexBasic_default, {
				gap: 4,
				...actionProps,
				children: action
			})
		]
	});
};
Empty$1.displayName = "Empty";
//#endregion
export { Empty$1 as default };

//# sourceMappingURL=Empty.mjs.map