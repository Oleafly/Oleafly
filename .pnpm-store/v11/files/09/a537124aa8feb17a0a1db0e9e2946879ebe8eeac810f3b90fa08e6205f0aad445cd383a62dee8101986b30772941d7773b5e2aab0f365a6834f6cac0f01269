"use client";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import { SortableItemContext } from "./SortableItem.mjs";
import { memo, use, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { GripVertical } from "lucide-react";
//#region src/SortableList/components/DragHandle.tsx
const DragHandle = memo(({ style, ...rest }) => {
	const [grab, setGrab] = useState(false);
	const { attributes, listeners, ref } = use(SortableItemContext);
	return /* @__PURE__ */ jsx(ActionIcon, {
		glass: true,
		"data-cypress": "draggable-handle",
		icon: GripVertical,
		size: "small",
		style: {
			cursor: grab ? "grab" : "grabbing",
			...style
		},
		onMouseDown: () => setGrab(true),
		onMouseUp: () => setGrab(false),
		...rest,
		...attributes,
		...listeners,
		ref
	});
});
DragHandle.displayName = "DragHandle";
//#endregion
export { DragHandle as default };

//# sourceMappingURL=DragHandle.mjs.map