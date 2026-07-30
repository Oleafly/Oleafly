"use client";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { DragOverlay, defaultDropAnimationSideEffects } from "@dnd-kit/core";
//#region src/SortableList/components/SortableOverlay.tsx
const dropAnimationConfig = { sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }) };
const SortableOverlay = memo(({ children }) => {
	return /* @__PURE__ */ jsx(DragOverlay, {
		dropAnimation: dropAnimationConfig,
		children
	});
});
SortableOverlay.displayName = "SortableOverlay";
//#endregion
export { SortableOverlay as default };

//# sourceMappingURL=SortableOverlay.mjs.map