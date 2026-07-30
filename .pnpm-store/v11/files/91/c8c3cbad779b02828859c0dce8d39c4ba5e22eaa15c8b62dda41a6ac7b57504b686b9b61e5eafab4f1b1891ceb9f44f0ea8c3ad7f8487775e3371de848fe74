"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
import { PanelLeft, Pin, PinOff } from "lucide-react";
//#region src/DraggablePanel/components/DraggablePanelHeader.tsx
const DraggablePanelHeader = memo((props) => {
	const { pin, setPin, className, setExpand, title, position = "left", ...rest } = props;
	const [isPinned, setIsPinned] = useMergeState(false, {
		onChange: setPin,
		value: pin
	});
	const panelIcon = /* @__PURE__ */ jsx(ActionIcon, {
		icon: PanelLeft,
		size: "small",
		onClick: () => setExpand?.(false)
	});
	const pinIcon = /* @__PURE__ */ jsx(ActionIcon, {
		active: pin,
		icon: pin ? Pin : PinOff,
		size: "small",
		onClick: () => setIsPinned(!isPinned)
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: cx(styles.header, className),
		flex: "none",
		gap: 8,
		justify: "space-between",
		...rest,
		children: [
			position === "left" ? panelIcon : pinIcon,
			title,
			position === "left" ? pinIcon : panelIcon
		]
	});
});
DraggablePanelHeader.displayName = "DraggablePanelHeader";
//#endregion
export { DraggablePanelHeader as default };

//# sourceMappingURL=DraggablePanelHeader.mjs.map