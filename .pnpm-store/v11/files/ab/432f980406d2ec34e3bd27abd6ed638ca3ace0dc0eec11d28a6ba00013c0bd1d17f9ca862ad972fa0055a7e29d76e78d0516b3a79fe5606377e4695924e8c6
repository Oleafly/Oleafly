"use client";
import Icon from "../../Icon/Icon.mjs";
import { styles } from "../DropdownMenu/sharedStyle.mjs";
import { styles as styles$1 } from "./style.mjs";
import { getOptionSearchText, isGroupOption } from "./helpers.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Check } from "lucide-react";
import { Select } from "@base-ui/react/select";
//#region src/base-ui/Select/renderOptions.tsx
function renderItem(option, index, params) {
	const { classNames, isBoldIndicator, itemTextClassName, listItemHeight, optionRender, renderVirtualItem, virtual } = params;
	return /* @__PURE__ */ jsxs(Select.Item, {
		disabled: option.disabled,
		label: getOptionSearchText(option),
		render: virtual ? renderVirtualItem : void 0,
		value: option.value,
		className: cx(styles.item, styles$1.item, isBoldIndicator && styles$1.itemBoldSelected, classNames?.item, classNames?.option, option.className),
		style: {
			minHeight: listItemHeight,
			...option.style
		},
		children: [/* @__PURE__ */ jsx(Select.ItemText, {
			className: itemTextClassName,
			children: optionRender ? optionRender(option, { index }) : option.label
		}), !isBoldIndicator && /* @__PURE__ */ jsx(Select.ItemIndicator, {
			className: cx(styles$1.itemIndicator, classNames?.itemIndicator),
			children: /* @__PURE__ */ jsx(Icon, {
				icon: Check,
				size: "small"
			})
		})]
	}, `${String(option.value)}-${index}`);
}
function renderOptions(params) {
	const { classNames, items } = params;
	let optionIndex = 0;
	return items.map((item, index) => {
		if (isGroupOption(item)) return /* @__PURE__ */ jsxs(Select.Group, {
			className: cx(styles$1.group, classNames?.group),
			children: [/* @__PURE__ */ jsx(Select.GroupLabel, {
				className: cx(styles.groupLabel, styles$1.groupLabel, classNames?.groupLabel),
				children: item.label
			}), item.options.map((option) => renderItem(option, optionIndex++, params))]
		}, `group-${index}`);
		return renderItem(item, optionIndex++, params);
	});
}
//#endregion
export { renderOptions };

//# sourceMappingURL=renderOptions.mjs.map