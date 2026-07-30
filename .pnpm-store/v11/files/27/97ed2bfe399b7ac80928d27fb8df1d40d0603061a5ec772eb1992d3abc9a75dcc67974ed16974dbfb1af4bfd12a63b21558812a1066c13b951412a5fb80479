import { isValidElement, useMemo } from "react";
//#region src/hooks/useNativeButton.ts
/**
* Map of component displayNames to their nativeButton values.
* Components that render native <button> elements should be true,
* components that render non-button elements should be false.
*/
const NATIVE_BUTTON_MAP = {
	A: false,
	ActionIcon: false,
	ActionIconGroup: false,
	Alert: false,
	Avatar: false,
	AvatarGroup: false,
	BaseButton: true,
	Block: false,
	BottomGradientButton: true,
	Burger: false,
	Button: true,
	Center: false,
	Checkbox: false,
	CheckboxGroup: false,
	Collapse: false,
	ColorSwatches: false,
	CopyButton: false,
	DownloadButton: false,
	EditableText: false,
	Empty: false,
	FileTypeIcon: false,
	Flexbox: false,
	FluentEmoji: false,
	GradientButton: true,
	Highlighter: false,
	Hotkey: false,
	Icon: false,
	Image: false,
	Img: false,
	Input: false,
	InputNumber: false,
	InputPassword: false,
	List: false,
	ListItem: false,
	Select: false,
	Switch: false,
	Markdown: false,
	MaterialFileTypeIcon: false,
	Segmented: false,
	Skeleton: false,
	SkeletonAvatar: false,
	SkeletonBlock: false,
	SkeletonButton: false,
	SkeletonParagraph: false,
	SkeletonTags: false,
	SkeletonTitle: false,
	Snippet: false,
	Tag: false,
	Text: false,
	TextArea: false,
	ThemeSwitch: false,
	Video: false
};
/**
* Get the displayName of a React component from an element.
* Handles function components, forwardRef, memo, etc.
*/
function getComponentDisplayName(element) {
	const type = element.type;
	if (typeof type === "string") return void 0;
	if (typeof type === "function") return type.displayName || type.name;
	if (typeof type === "object" && type !== null) return type.displayName || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name;
}
/**
* Hook to resolve nativeButton prop for Base UI trigger components.
*
* When using `render`, Base UI expects the rendered element to be a native <button> by default.
* If we can infer it's not, we opt out to avoid warnings (users can still override via `nativeButton`).
*/
function useNativeButton({ children, nativeButton, triggerNativeButton }) {
	const isNativeButtonTriggerElement = useMemo(() => {
		if (!isValidElement(children)) return false;
		return typeof children.type === "string" && children.type === "button";
	}, [children]);
	return {
		isNativeButtonTriggerElement,
		resolvedNativeButton: useMemo(() => {
			if (nativeButton !== void 0) return nativeButton;
			if (triggerNativeButton !== void 0) return triggerNativeButton;
			if (isNativeButtonTriggerElement) return true;
			if (!isValidElement(children)) return void 0;
			if (typeof children.type === "string") return false;
			const displayName = getComponentDisplayName(children);
			if (displayName && displayName in NATIVE_BUTTON_MAP) return NATIVE_BUTTON_MAP[displayName];
			return false;
		}, [
			children,
			isNativeButtonTriggerElement,
			nativeButton,
			triggerNativeButton
		])
	};
}
//#endregion
export { useNativeButton };

//# sourceMappingURL=useNativeButton.mjs.map