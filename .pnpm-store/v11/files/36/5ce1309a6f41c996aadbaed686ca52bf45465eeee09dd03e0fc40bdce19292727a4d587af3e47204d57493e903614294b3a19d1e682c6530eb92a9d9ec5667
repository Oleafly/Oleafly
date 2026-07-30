"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Icon from "../Icon/Icon.mjs";
import Img from "../Img/index.mjs";
import { styles } from "./styles.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/ImageSelect/ImageSelect.tsx
const ImageSelect = memo(({ ref, className, style, value, defaultValue, onChange, options, width = 144, height = 86, styles: customStyles, classNames, unoptimized, ...rest }) => {
	const [currentValue, setCurrentValue] = useMergeState(defaultValue, {
		defaultValue,
		onChange,
		value
	});
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		className,
		gap: 16,
		ref,
		style,
		...rest,
		children: options?.map((item) => {
			const isActive = item.value === currentValue;
			return /* @__PURE__ */ jsxs(FlexBasic_default, {
				align: "center",
				className: cx(styles.container, isActive && styles.active),
				gap: 4,
				onClick: () => setCurrentValue(item.value),
				children: [/* @__PURE__ */ jsx(Img, {
					alt: item.alt || item.value,
					className: cx(styles.img, isActive && styles.imgActive, classNames?.img),
					height,
					src: item.img,
					unoptimized,
					width,
					style: {
						...customStyles?.img,
						height,
						width
					}
				}), /* @__PURE__ */ jsxs(FlexBasic_default, {
					horizontal: true,
					align: "center",
					gap: 4,
					children: [item.icon && /* @__PURE__ */ jsx(Icon, { icon: item.icon }), item.label]
				})]
			}, item.value);
		})
	});
});
ImageSelect.displayName = "ImageSelect";
//#endregion
export { ImageSelect as default };

//# sourceMappingURL=ImageSelect.mjs.map