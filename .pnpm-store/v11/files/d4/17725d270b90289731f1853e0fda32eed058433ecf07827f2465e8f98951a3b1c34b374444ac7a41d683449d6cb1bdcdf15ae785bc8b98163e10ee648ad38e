"use client";
import { itemVariants, listVariants, styles } from "./style.mjs";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
//#region src/base-ui/Segmented/atoms.tsx
const SegmentedRoot = ({ block = false, className, glass = false, shadow = false, variant = "filled", ...rest }) => {
	return /* @__PURE__ */ jsx(ToggleGroup, {
		className: cx(listVariants({
			block,
			glass,
			shadow,
			variant
		}), className),
		...rest
	});
};
SegmentedRoot.displayName = "SegmentedRoot";
const SegmentedItem = ({ block = false, className, size = "middle", ...rest }) => {
	return /* @__PURE__ */ jsx(Toggle, {
		className: cx(itemVariants({
			block,
			size
		}), className),
		...rest
	});
};
SegmentedItem.displayName = "SegmentedItem";
const SegmentedItemIcon = ({ children, className, style }) => /* @__PURE__ */ jsx("span", {
	className: cx(styles.itemIcon, className),
	style,
	children
});
SegmentedItemIcon.displayName = "SegmentedItemIcon";
const SegmentedItemLabel = ({ children, className, style }) => /* @__PURE__ */ jsx("span", {
	className: cx(styles.itemLabel, className),
	style,
	children
});
SegmentedItemLabel.displayName = "SegmentedItemLabel";
const SegmentedIndicator = ({ className, style }) => /* @__PURE__ */ jsx("span", {
	"aria-hidden": true,
	className: cx(styles.indicator, className),
	style
});
SegmentedIndicator.displayName = "SegmentedIndicator";
//#endregion
export { SegmentedIndicator, SegmentedItem, SegmentedItemIcon, SegmentedItemLabel, SegmentedRoot };

//# sourceMappingURL=atoms.mjs.map