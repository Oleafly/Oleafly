"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import Img from "../Img/index.mjs";
import { styles, variants } from "./style.mjs";
import { memo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { X } from "lucide-react";
//#region src/GuideCard/GuideCard.tsx
const GuideCard = memo(({ cover, onClose, shadow, closable = true, afterClose, alt, className, title, desc, width, styles: customStyles, height, coverProps, variant = "filled", closeIconProps, classNames, ref, ...rest }) => {
	const [show, setShow] = useState(true);
	const { isDarkMode } = useThemeMode();
	if (!show) return null;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({
			isDarkMode,
			shadow,
			variant
		}), className),
		ref,
		...rest,
		children: [
			closable && /* @__PURE__ */ jsx(ActionIcon, {
				size: "small",
				...closeIconProps,
				className: cx(styles.close, closeIconProps?.className),
				icon: X,
				onClick: (e) => {
					setShow(false);
					onClose?.(e);
					afterClose?.();
				}
			}),
			cover && /* @__PURE__ */ jsx(Img, {
				alt,
				className: cx(styles.cover, classNames?.cover),
				height,
				src: cover,
				style: customStyles?.cover,
				width,
				...coverProps
			}),
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				className: cx(styles.content, classNames?.content),
				gap: 8,
				style: customStyles?.content,
				children: [title && /* @__PURE__ */ jsx("div", {
					className: styles.title,
					children: title
				}), desc && /* @__PURE__ */ jsx("div", {
					className: styles.desc,
					children: desc
				})]
			})
		]
	});
});
GuideCard.displayName = "GuideCard";
//#endregion
export { GuideCard as default };

//# sourceMappingURL=GuideCard.mjs.map