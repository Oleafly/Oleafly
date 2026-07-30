"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import ListItem from "./ListItem/index.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/List/List.tsx
const List = memo(({ ref, activeKey, classNames, styles, onClick, items, ...rest }) => {
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		gap: 4,
		padding: 4,
		...rest,
		children: items.map((item) => {
			const { key, onClick: itemOnClick, className: itemClassName, style: itemStyle, ...itemRest } = item;
			const { item: customItemClassName, ...restClassName } = classNames || {};
			const { item: customItemStyle, ...restStyles } = styles || {};
			return /* @__PURE__ */ jsx(ListItem, {
				active: item.key === activeKey,
				className: cx(customItemClassName, itemClassName),
				classNames: restClassName,
				ref,
				style: {
					...customItemStyle,
					...itemStyle
				},
				styles: restStyles,
				onClick: (e) => {
					onClick?.({
						item,
						key
					});
					itemOnClick?.(e);
				},
				...itemRest
			}, key);
		})
	});
});
List.displayName = "List";
//#endregion
export { List as default };

//# sourceMappingURL=List.mjs.map