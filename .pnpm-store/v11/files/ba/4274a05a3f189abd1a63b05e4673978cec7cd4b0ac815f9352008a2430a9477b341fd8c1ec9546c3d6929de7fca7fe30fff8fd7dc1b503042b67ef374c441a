"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import SortableItem from "./components/SortableItem.mjs";
import DragHandle from "./components/DragHandle.mjs";
import SortableOverlay from "./components/SortableOverlay.mjs";
import { Fragment, memo, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { DndContext, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
//#region src/SortableList/SortableList.tsx
const measuringConfig = { droppable: { strategy: MeasuringStrategy.Always } };
const SortableListParent = memo(({ ref, items, onChange, renderItem, renderOverlay, gap = 8, ...rest }) => {
	const [active, setActive] = useState(null);
	const activeItem = useMemo(() => items.find((item) => item.id === active?.id), [active, items]);
	const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
	const overlayRenderer = renderOverlay ?? renderItem;
	return /* @__PURE__ */ jsxs(DndContext, {
		collisionDetection: closestCenter,
		measuring: measuringConfig,
		modifiers: [restrictToVerticalAxis, restrictToWindowEdges],
		sensors,
		onDragCancel: () => {
			setActive(null);
		},
		onDragEnd: ({ active, over }) => {
			if (over && active.id !== over?.id) onChange(arrayMove(items, items.findIndex(({ id }) => id === active.id), items.findIndex(({ id }) => id === over.id)));
			setActive(null);
		},
		onDragStart: ({ active }) => {
			setActive(active);
		},
		children: [/* @__PURE__ */ jsx(SortableContext, {
			items,
			strategy: verticalListSortingStrategy,
			children: /* @__PURE__ */ jsx(FlexBasic_default, {
				as: "ul",
				className: styles.container,
				gap,
				ref,
				...rest,
				children: items.map((item) => /* @__PURE__ */ jsx(Fragment, { children: renderItem(item) }, item.id))
			})
		}), /* @__PURE__ */ jsx(SortableOverlay, { children: activeItem ? overlayRenderer(activeItem) : null })]
	});
});
SortableListParent.displayName = "SortableList";
const SortableList = SortableListParent;
SortableList.Item = SortableItem;
SortableList.DragHandle = DragHandle;
//#endregion
export { SortableList as default };

//# sourceMappingURL=SortableList.mjs.map