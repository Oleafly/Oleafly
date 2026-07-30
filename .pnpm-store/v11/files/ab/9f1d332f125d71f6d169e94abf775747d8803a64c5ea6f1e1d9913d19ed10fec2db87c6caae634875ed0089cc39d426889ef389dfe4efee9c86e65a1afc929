"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { variants } from "../style.mjs";
import { createContext, memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
//#region src/SortableList/components/SortableItem.tsx
const SortableItemContext = createContext({
	attributes: {},
	listeners: void 0,
	ref() {}
});
const SortableItem = memo(({ variant = "borderless", className, children, id, style, ...rest }) => {
	const { attributes, isDragging, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id });
	const context = useMemo(() => ({
		attributes,
		listeners,
		ref: setActivatorNodeRef
	}), [
		attributes,
		listeners,
		setActivatorNodeRef
	]);
	return /* @__PURE__ */ jsx(SortableItemContext, {
		value: context,
		children: /* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			as: "li",
			className: cx(variants({ variant }), className),
			gap: 4,
			ref: setNodeRef,
			style: {
				opacity: isDragging ? .4 : void 0,
				transform: CSS.Translate.toString(transform),
				transition,
				...style
			},
			...rest,
			children
		})
	});
});
SortableItem.displayName = "SortableItem";
//#endregion
export { SortableItemContext, SortableItem as default };

//# sourceMappingURL=SortableItem.mjs.map