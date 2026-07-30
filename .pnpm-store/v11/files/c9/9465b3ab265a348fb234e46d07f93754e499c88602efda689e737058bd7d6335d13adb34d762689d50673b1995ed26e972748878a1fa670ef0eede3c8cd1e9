"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Center from "../Flex/Center.mjs";
import { KeyMapEnum } from "./const.mjs";
import Icon from "../Icon/Icon.mjs";
import LeftClickIcon from "../icons/lucideExtra/LeftClickIcon.mjs";
import LeftDoubleClickIcon from "../icons/lucideExtra/LeftDoubleClickIcon.mjs";
import RightClickIcon from "../icons/lucideExtra/RightClickIcon.mjs";
import RightDoubleClickIcon from "../icons/lucideExtra/RightDoubleClickIcon.mjs";
import { variants } from "./style.mjs";
import { checkIsAppleDevice, splitKeysByPlus, startCase } from "./utils.mjs";
import { memo, useEffect, useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { ArrowBigUpIcon, ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowRightToLineIcon, ArrowUpIcon, ChevronUpIcon, Command, CornerDownLeftIcon, Delete, Grid2X2Icon, MouseIcon, Option, SpaceIcon } from "lucide-react";
//#region src/Hotkey/Hotkey.tsx
const mappingKey = (isAppleDevice) => ({
	[KeyMapEnum.Alt]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, {
		icon: Option,
		size: { size: "0.95em" }
	}) : "Alt",
	[KeyMapEnum.Backspace]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, { icon: Delete }) : "Backspace",
	[KeyMapEnum.CommandOrControl]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, {
		icon: Command,
		size: { size: "0.95em" }
	}) : "Ctrl",
	[KeyMapEnum.Ctrl]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, { icon: ChevronUpIcon }) : "Ctrl",
	[KeyMapEnum.Control]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, { icon: ChevronUpIcon }) : "Ctrl",
	[KeyMapEnum.Down]: /* @__PURE__ */ jsx(Icon, { icon: ArrowDownIcon }),
	[KeyMapEnum.Enter]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, { icon: CornerDownLeftIcon }) : "Enter",
	[KeyMapEnum.LeftClick]: /* @__PURE__ */ jsx(Icon, {
		icon: LeftClickIcon,
		size: {
			size: "1.2em",
			strokeWidth: 1.75
		}
	}),
	[KeyMapEnum.Left]: /* @__PURE__ */ jsx(Icon, { icon: ArrowLeftIcon }),
	[KeyMapEnum.Meta]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, {
		icon: Command,
		size: { size: "0.95em" }
	}) : /* @__PURE__ */ jsx(Icon, { icon: Grid2X2Icon }),
	[KeyMapEnum.MiddleClick]: /* @__PURE__ */ jsx(Icon, {
		icon: MouseIcon,
		size: {
			size: "1.2em",
			strokeWidth: 1.75
		}
	}),
	[KeyMapEnum.Mod]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, {
		icon: Command,
		size: { size: "0.95em" }
	}) : "Ctrl",
	[KeyMapEnum.RightClick]: /* @__PURE__ */ jsx(Icon, {
		icon: RightClickIcon,
		size: {
			size: "1.2em",
			strokeWidth: 1.75
		}
	}),
	[KeyMapEnum.RightDoubleClick]: /* @__PURE__ */ jsx(Icon, {
		icon: RightDoubleClickIcon,
		size: {
			size: "1.2em",
			strokeWidth: 1.75
		}
	}),
	[KeyMapEnum.LeftDoubleClick]: /* @__PURE__ */ jsx(Icon, {
		icon: LeftDoubleClickIcon,
		size: {
			size: "1.2em",
			strokeWidth: 1.75
		}
	}),
	[KeyMapEnum.Right]: /* @__PURE__ */ jsx(Icon, { icon: ArrowRightIcon }),
	[KeyMapEnum.Shift]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, {
		icon: ArrowBigUpIcon,
		size: {
			size: "1.15em",
			strokeWidth: 1.75
		}
	}) : "Shift",
	[KeyMapEnum.Space]: /* @__PURE__ */ jsx(Icon, { icon: SpaceIcon }),
	[KeyMapEnum.Tab]: isAppleDevice ? /* @__PURE__ */ jsx(Icon, { icon: ArrowRightToLineIcon }) : "Tab",
	[KeyMapEnum.Up]: /* @__PURE__ */ jsx(Icon, { icon: ArrowUpIcon }),
	[KeyMapEnum.Comma]: ",",
	[KeyMapEnum.Period]: ".",
	[KeyMapEnum.Slash]: "?",
	[KeyMapEnum.Semicolon]: ";",
	[KeyMapEnum.Quote]: "'",
	[KeyMapEnum.Backquote]: "`",
	[KeyMapEnum.Backslash]: "\\",
	[KeyMapEnum.BracketLeft]: "[",
	[KeyMapEnum.BracketRight]: "]",
	[KeyMapEnum.Minus]: "-",
	[KeyMapEnum.Equal]: "+"
});
const Hotkey = memo(({ variant = "filled", classNames, styles: customStyles, keys, inverseTheme, isApple, compact, className, style, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const isBorderless = variant === "borderless";
	const [keysGroup, setKeysGroup] = useState(() => splitKeysByPlus(keys));
	const isAppleDevice = useMemo(() => checkIsAppleDevice(isApple), [isApple]);
	useEffect(() => {
		const newValue = splitKeysByPlus(keys);
		setKeysGroup(newValue);
	}, [keys]);
	const mapping = useMemo(() => mappingKey(isAppleDevice), [isAppleDevice]);
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className,
		gap: isBorderless ? 6 : 2,
		style,
		...rest,
		children: compact || isBorderless ? /* @__PURE__ */ jsx(Center, {
			horizontal: true,
			as: "kbd",
			gap: 6,
			style: customStyles?.kbdStyle,
			className: cx(variants({
				inverseTheme,
				isDarkMode,
				variant
			}), classNames?.kbdClassName),
			children: keysGroup.map((key, index) => /* @__PURE__ */ jsx("div", { children: mapping[key] ?? startCase(key) }, index))
		}) : keysGroup.map((key, index) => /* @__PURE__ */ jsx(Center, {
			as: "kbd",
			style: customStyles?.kbdStyle,
			className: cx(variants({
				inverseTheme,
				isDarkMode,
				variant
			}), classNames?.kbdClassName),
			children: mapping[key] ?? startCase(key)
		}, index))
	});
});
Hotkey.displayName = "Hotkey";
//#endregion
export { Hotkey as default };

//# sourceMappingURL=Hotkey.mjs.map