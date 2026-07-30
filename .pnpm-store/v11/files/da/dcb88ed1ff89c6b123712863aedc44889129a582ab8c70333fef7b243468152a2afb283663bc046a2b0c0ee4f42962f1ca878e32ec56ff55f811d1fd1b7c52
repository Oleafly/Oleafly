"use client";
import Hotkey from "../../Hotkey/Hotkey.mjs";
import { memo, useMemo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
//#region src/base-ui/Tooltip/TooltipContent.tsx
const TooltipContent = memo(({ title, hotkey, hotkeyProps }) => {
	const resolvedHotkeyProps = useMemo(() => ({
		compact: true,
		...hotkeyProps
	}), [hotkeyProps]);
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [title, hotkey ? /* @__PURE__ */ jsx(Hotkey, {
		keys: hotkey,
		...resolvedHotkeyProps
	}) : null] });
});
TooltipContent.displayName = "TooltipContent";
//#endregion
export { TooltipContent as default };

//# sourceMappingURL=TooltipContent.mjs.map