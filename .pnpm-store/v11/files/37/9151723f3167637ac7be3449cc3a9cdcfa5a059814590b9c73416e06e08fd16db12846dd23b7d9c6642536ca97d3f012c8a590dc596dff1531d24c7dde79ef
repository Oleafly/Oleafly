"use client";
import { useAppElement } from "../ThemeProvider/AppElementContext.mjs";
import { styles } from "../base-ui/DropdownMenu/sharedStyle.mjs";
import { styles as styles$1 } from "./style.mjs";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { Autocomplete } from "@base-ui/react/autocomplete";
//#region src/EditorSlashMenu/atoms.tsx
const mergeStateClassName = (base, className) => {
	if (typeof className === "function") return (state) => cx(base, className(state));
	return cx(base, className);
};
const EditorSlashMenuRoot = Autocomplete.Root;
const EditorSlashMenuList = ({ ref, className, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.List, {
		...rest,
		className: mergeStateClassName(cx(styles$1.list), className),
		ref
	});
};
EditorSlashMenuList.displayName = "EditorSlashMenuList";
const EditorSlashMenuPortal = ({ container, ...rest }) => {
	const appElement = useAppElement();
	return /* @__PURE__ */ jsx(Autocomplete.Portal, {
		container: container ?? appElement ?? void 0,
		...rest
	});
};
EditorSlashMenuPortal.displayName = "EditorSlashMenuPortal";
const EditorSlashMenuPositioner = ({ className, align, positionMethod, side, sideOffset, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.Positioner, {
		...rest,
		align: align ?? "start",
		className: mergeStateClassName(styles.positioner, className),
		positionMethod: positionMethod ?? "fixed",
		side: side ?? "bottom",
		sideOffset: sideOffset ?? 6
	});
};
EditorSlashMenuPositioner.displayName = "EditorSlashMenuPositioner";
const EditorSlashMenuPopup = ({ className, initialFocus = false, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.Popup, {
		...rest,
		className: mergeStateClassName(styles.popup, className),
		initialFocus
	});
};
EditorSlashMenuPopup.displayName = "EditorSlashMenuPopup";
const EditorSlashMenuItem = ({ className, danger, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.Item, {
		...rest,
		className: (state) => cx(styles.item, danger && styles.danger, typeof className === "function" ? className(state) : className)
	});
};
EditorSlashMenuItem.displayName = "EditorSlashMenuItem";
const EditorSlashMenuGroup = Autocomplete.Group;
const EditorSlashMenuGroupLabel = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.GroupLabel, {
		...rest,
		className: (state) => cx(styles.groupLabel, typeof className === "function" ? className(state) : className)
	});
};
EditorSlashMenuGroupLabel.displayName = "EditorSlashMenuGroupLabel";
const EditorSlashMenuEmpty = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.Empty, {
		...rest,
		className: (state) => cx(styles.item, styles.empty, typeof className === "function" ? className(state) : className)
	});
};
EditorSlashMenuEmpty.displayName = "EditorSlashMenuEmpty";
const EditorSlashMenuItemContent = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("div", {
		...rest,
		className: cx(styles.itemContent, className)
	});
};
EditorSlashMenuItemContent.displayName = "EditorSlashMenuItemContent";
const EditorSlashMenuItemIcon = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.icon, className)
	});
};
EditorSlashMenuItemIcon.displayName = "EditorSlashMenuItemIcon";
const EditorSlashMenuItemLabel = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.label, className)
	});
};
EditorSlashMenuItemLabel.displayName = "EditorSlashMenuItemLabel";
const EditorSlashMenuItemExtra = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx("span", {
		...rest,
		className: cx(styles.extra, className)
	});
};
EditorSlashMenuItemExtra.displayName = "EditorSlashMenuItemExtra";
const EditorSlashMenuHiddenInput = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(Autocomplete.Input, {
		...rest,
		className: mergeStateClassName(cx(styles$1.hiddenInput), className)
	});
};
EditorSlashMenuHiddenInput.displayName = "EditorSlashMenuHiddenInput";
//#endregion
export { EditorSlashMenuEmpty, EditorSlashMenuGroup, EditorSlashMenuGroupLabel, EditorSlashMenuHiddenInput, EditorSlashMenuItem, EditorSlashMenuItemContent, EditorSlashMenuItemExtra, EditorSlashMenuItemIcon, EditorSlashMenuItemLabel, EditorSlashMenuList, EditorSlashMenuPopup, EditorSlashMenuPortal, EditorSlashMenuPositioner, EditorSlashMenuRoot };

//# sourceMappingURL=atoms.mjs.map