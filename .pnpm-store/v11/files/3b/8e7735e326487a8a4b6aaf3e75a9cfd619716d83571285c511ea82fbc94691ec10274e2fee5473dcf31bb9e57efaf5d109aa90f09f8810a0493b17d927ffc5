"use client";
import { TooltipGroupHandleContext } from "./groupContext.mjs";
import { TooltipInGroup } from "./TooltipInGroup.mjs";
import { TooltipStandalone } from "./TooltipStandalone.mjs";
import { use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/base-ui/Tooltip/Tooltip.tsx
const Tooltip = (props) => {
	const group = use(TooltipGroupHandleContext);
	return Boolean(group) && props.open === void 0 && props.defaultOpen === void 0 && !props.standalone ? /* @__PURE__ */ jsx(TooltipInGroup, { ...props }) : /* @__PURE__ */ jsx(TooltipStandalone, { ...props });
};
//#endregion
export { Tooltip, Tooltip as default };

//# sourceMappingURL=Tooltip.mjs.map