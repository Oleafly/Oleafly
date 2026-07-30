"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Center from "../../Flex/Center.mjs";
import DraggablePanel from "../../DraggablePanel/index.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
import { LevaPanel, useControls, useCreateStore } from "leva";
//#region src/storybook/StoryBook/index.tsx
const StoryBook = memo(({ ref, levaStore, noPadding, className, children, ...rest }) => {
	const { mobile } = useResponsive();
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "stretch",
		className: cx(styles.editor, className),
		horizontal: !mobile,
		justify: "stretch",
		ref,
		children: [/* @__PURE__ */ jsx(Center, {
			className: cx(noPadding ? styles.left : styles.leftWithPadding),
			flex: 1,
			...rest,
			children
		}), /* @__PURE__ */ jsx(DraggablePanel, {
			className: styles.right,
			minWidth: 280,
			placement: mobile ? "bottom" : "right",
			children: /* @__PURE__ */ jsxs("div", {
				className: styles.leva,
				children: [/* @__PURE__ */ jsx(LevaPanel, {
					fill: true,
					flat: true,
					store: levaStore,
					titleBar: false
				}), " "]
			})
		})]
	});
});
StoryBook.displayName = "StoryBook";
//#endregion
export { StoryBook, StoryBook as default, useControls, useCreateStore };

//# sourceMappingURL=index.mjs.map