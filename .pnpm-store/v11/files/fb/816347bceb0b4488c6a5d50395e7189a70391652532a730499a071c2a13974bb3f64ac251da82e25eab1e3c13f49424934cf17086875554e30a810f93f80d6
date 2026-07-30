"use client";
import { parseTrigger } from "../../utils/parseTrigger.mjs";
import { PopoverGroupHandleContext } from "./groupContext.mjs";
import { PopoverInGroup } from "./PopoverInGroup.mjs";
import { PopoverStandalone } from "./PopoverStandalone.mjs";
import { use } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/base-ui/Popover/Popover.tsx
const Popover = (props) => {
	const group = use(PopoverGroupHandleContext);
	return Boolean(group) && props.open === void 0 && props.defaultOpen === void 0 && !props.standalone ? /* @__PURE__ */ jsx(PopoverInGroup, { ...props }) : /* @__PURE__ */ jsx(PopoverStandalone, { ...props });
};
Popover.displayName = "Popover";
//#endregion
export { Popover as default, parseTrigger };

//# sourceMappingURL=Popover.mjs.map