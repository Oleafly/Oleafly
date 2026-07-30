"use client";
import A from "../../A/index.mjs";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Center from "../../Flex/Center.mjs";
import Icon from "../../Icon/Icon.mjs";
import Text from "../../Text/Text.mjs";
import Img from "../../Img/index.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/awesome/Features/FeatureItem.tsx
const Image = memo(({ image, className, title, style }) => {
	return image.startsWith("http") ? /* @__PURE__ */ jsx(Img, {
		alt: title,
		className,
		src: image,
		style
	}) : /* @__PURE__ */ jsx(Center, {
		className,
		style,
		children: image
	});
});
const Item = memo(({ style, className, row, column, description, image, title, link, icon, imageStyle, openExternal, ...rest }) => {
	const rowNumber = row || 7;
	const hasLink = Boolean(link);
	const cssVariables = useMemo(() => ({
		"--features-row-num": String(rowNumber),
		"--features-title-hover-size": hasLink ? "14px" : "20px"
	}), [rowNumber, hasLink]);
	return /* @__PURE__ */ jsx("div", {
		className: cx(hasLink ? styles.containerHasLink : styles.container, className),
		style: {
			...cssVariables,
			gridColumn: `span ${column || 1}`,
			gridRow: `span ${rowNumber}`,
			...style
		},
		...rest,
		children: /* @__PURE__ */ jsxs("div", {
			className: styles.cell,
			children: [
				image || icon && /* @__PURE__ */ jsxs(Center, {
					className: styles.imgContainer,
					style: imageStyle,
					children: [icon && /* @__PURE__ */ jsx(Icon, {
						className: styles.img,
						icon
					}), image && /* @__PURE__ */ jsx(Image, {
						className: styles.img,
						image,
						title
					})]
				}),
				title && /* @__PURE__ */ jsx(FlexBasic_default, {
					horizontal: true,
					align: "center",
					as: "h3",
					className: styles.title,
					gap: 8,
					children: title
				}),
				description && /* @__PURE__ */ jsx(Text, {
					className: styles.desc,
					ellipsis: { rows: 4 },
					children: description
				}),
				link && /* @__PURE__ */ jsx("div", {
					className: styles.link,
					children: /* @__PURE__ */ jsx(A, {
						href: link,
						rel: "noreferrer",
						target: openExternal ? "_blank" : void 0,
						children: "Read More"
					})
				})
			]
		})
	});
});
Item.displayName = "FeatureItem";
//#endregion
export { Item as default };

//# sourceMappingURL=FeatureItem.mjs.map