"use client";
import Icon from "../Icon/Icon.mjs";
import Hotkey from "../Hotkey/Hotkey.mjs";
import Input from "../Input/Input.mjs";
import Spotlight from "../awesome/Spotlight/Spotlight.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
import { LucideLoader2, Search } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";
//#region src/SearchBar/SearchBar.tsx
const SearchBar = memo(({ defaultValue = "", spotlight, className, value, onInputChange, placeholder, enableShortKey, shortKey = "mod+k", onSearch, loading, style, onChange, onBlur, onPressEnter, onFocus, styles: { input: inputStyle, shortKey: shortKeyStyle } = {}, classNames: { input: inputClassName, shortKey: shortKeyClassName } = {}, ...rest }) => {
	const [inputValue, setInputValue] = useMergeState(defaultValue, {
		defaultValue,
		onChange: onInputChange,
		value
	});
	const [showTag, setShowTag] = useState(true);
	const inputReference = useRef(null);
	const hotkey = useMemo(() => shortKey.includes("+") ? shortKey : `mod+${shortKey}`, [shortKey]);
	useHotkeys(hotkey, () => {
		if (!enableShortKey) return;
		inputReference.current?.focus();
	}, {
		enableOnFormTags: true,
		enabled: !!enableShortKey && !!shortKey,
		preventDefault: true
	});
	return /* @__PURE__ */ jsxs("div", {
		className: cx(styles.search, className),
		style,
		children: [
			spotlight && /* @__PURE__ */ jsx(Spotlight, {}),
			/* @__PURE__ */ jsx(Input, {
				allowClear: true,
				className: inputClassName,
				placeholder: placeholder ?? "Type keywords...",
				ref: inputReference,
				style: inputStyle,
				value: inputValue,
				prefix: /* @__PURE__ */ jsx(Icon, {
					className: styles.icon,
					icon: loading ? LucideLoader2 : Search,
					size: "small",
					spin: loading,
					style: { marginRight: 4 }
				}),
				onBlur: (e) => {
					onBlur?.(e);
					setInputValue(e.target.value);
					setShowTag(true);
				},
				onChange: (e) => {
					setInputValue(e.target.value);
					onChange?.(e);
				},
				onFocus: (e) => {
					onFocus?.(e);
					setShowTag(false);
				},
				onPressEnter: (e) => {
					onPressEnter?.(e);
					onSearch?.(inputValue);
				},
				...rest
			}),
			enableShortKey && showTag && !inputValue && /* @__PURE__ */ jsx(Hotkey, {
				compact: true,
				className: cx(styles.tag, shortKeyClassName),
				keys: hotkey,
				style: shortKeyStyle
			})
		]
	});
});
SearchBar.displayName = "SearchBar";
//#endregion
export { SearchBar as default };

//# sourceMappingURL=SearchBar.mjs.map