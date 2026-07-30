"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { NORMATIVE_MODIFIER, checkIsAppleDevice, splitKeysByPlus } from "../Hotkey/utils.mjs";
import Hotkey from "../Hotkey/Hotkey.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { useTranslation } from "../i18n/useTranslation.mjs";
import hotkey_default from "../i18n/resources/en/hotkey.mjs";
import { styles, variants } from "./style.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import useMergeState from "use-merge-value";
import { isEqual } from "es-toolkit/compat";
import { Undo2Icon, XIcon } from "lucide-react";
import { useHotkeys, useRecordHotkeys } from "react-hotkeys-hook";
//#region src/HotkeyInput/HotkeyInput.tsx
const HotkeyInput = memo(({ value = "", defaultValue = "", resetValue = "", onChange, onClear, onConflict, placeholder, disabled, shadow, allowClear, allowReset = true, style, className, hotkeyConflicts = [], variant, texts, isApple, onBlur, onReset, onFocus }) => {
	const [isFocused, setIsFocused] = useState(false);
	const [hasConflict, setHasConflict] = useState(false);
	const [hasInvalidCombination, setHasInvalidCombination] = useState(false);
	const inputRef = useRef(null);
	const { isDarkMode } = useThemeMode();
	const { t } = useTranslation(hotkey_default);
	const isAppleDevice = useMemo(() => checkIsAppleDevice(isApple), [isApple]);
	const [hotkeyValue, setHotkeyValue] = useMergeState(defaultValue, {
		defaultValue,
		onChange,
		value
	});
	const [recordedKeys, { start, stop, isRecording, resetKeys }] = useRecordHotkeys();
	useHotkeys("*", () => {
		inputRef.current?.blur();
	}, {
		enableOnContentEditable: true,
		enableOnFormTags: true,
		enabled: isRecording && !disabled,
		keydown: false,
		keyup: true,
		preventDefault: true
	});
	const { isValid, keys } = useCallback((keysSet) => {
		const modifiers = [];
		const normalKeys = [];
		for (const key of keysSet) {
			const normalizedKey = key.toLowerCase();
			if (NORMATIVE_MODIFIER.includes(normalizedKey)) {
				if (!isAppleDevice && normalizedKey === "ctrl" || isAppleDevice && normalizedKey === "meta") {
					if (!modifiers.includes("mod")) modifiers.push("mod");
				} else if (!modifiers.includes(normalizedKey)) modifiers.push(normalizedKey);
			} else normalKeys.push(key);
		}
		if (modifiers.length === 0 && normalKeys.length > 0) return {
			isValid: false,
			keys: []
		};
		const shortcuts = [modifiers, normalKeys.length > 0 ? [normalKeys.at(-1)] : []];
		return {
			isValid: shortcuts.every((k) => k.length > 0),
			keys: shortcuts.flat()
		};
	}, [])(recordedKeys);
	const keysString = keys.join("+");
	const checkHotkeyConflict = useCallback((newHotkey) => {
		return hotkeyConflicts.filter((conflictKey) => conflictKey !== resetValue).some((conflictKey) => {
			return isEqual(splitKeysByPlus(newHotkey), splitKeysByPlus(conflictKey));
		});
	}, [hotkeyConflicts]);
	useEffect(() => {
		if (recordedKeys.size > 0 && !isRecording) {
			if (!isValid) {
				setHasInvalidCombination(true);
				setHasConflict(false);
				return;
			}
			setHasInvalidCombination(false);
			const newKeysString = keysString;
			if (checkHotkeyConflict(newKeysString)) {
				setHasConflict(true);
				onConflict?.(newKeysString);
			} else {
				setHasConflict(false);
				setHotkeyValue?.(newKeysString);
			}
		}
	}, [
		recordedKeys,
		isRecording,
		isValid,
		keysString,
		checkHotkeyConflict,
		setHotkeyValue,
		onConflict
	]);
	const handleFocus = (e) => {
		if (disabled) return;
		setIsFocused(true);
		setHasConflict(false);
		setHasInvalidCombination(false);
		start();
		onFocus?.(e);
	};
	const handleBlur = (e) => {
		setIsFocused(false);
		stop();
		onBlur?.(e);
	};
	const handleClear = (e) => {
		e.preventDefault();
		e.stopPropagation();
		setHotkeyValue?.("");
		resetKeys();
		setHasConflict(false);
		setHasInvalidCombination(false);
		setIsFocused(false);
		stop();
		onClear?.(hotkeyValue);
	};
	const handleReset = (e) => {
		e.preventDefault();
		e.stopPropagation();
		setHotkeyValue?.(resetValue);
		resetKeys();
		setHasConflict(false);
		setHasInvalidCombination(false);
		setIsFocused(false);
		stop();
		onReset?.(hotkeyValue, resetValue);
	};
	const handleClick = (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (disabled || isFocused) return;
		inputRef.current?.focus();
	};
	const placeholderText = placeholder ?? t("hotkey.placeholder");
	const resetTitle = texts?.reset ?? t("hotkey.reset");
	const clearTitle = texts?.clear ?? t("hotkey.clear");
	const conflictText = texts?.conflicts ?? t("hotkey.conflict");
	const invalidText = texts?.invalidCombination ?? t("hotkey.invalidCombination");
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className,
		gap: 8,
		style: {
			position: "relative",
			...style
		},
		children: [
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				justify: "space-between",
				className: cx(variants({
					disabled,
					error: hasConflict || hasInvalidCombination,
					focused: isFocused,
					shadow,
					variant: variant || (isDarkMode ? "filled" : "outlined")
				})),
				onClick: handleClick,
				children: [
					/* @__PURE__ */ jsx("div", {
						style: { pointerEvents: "none" },
						children: isRecording ? /* @__PURE__ */ jsx("span", {
							className: styles.placeholder,
							children: keys.length > 0 ? /* @__PURE__ */ jsx(Hotkey, { keys: keysString }) : placeholderText
						}) : hotkeyValue ? /* @__PURE__ */ jsx(Hotkey, { keys: hotkeyValue }) : /* @__PURE__ */ jsx("span", {
							className: styles.placeholder,
							children: placeholderText
						})
					}),
					/* @__PURE__ */ jsx("input", {
						readOnly: true,
						className: styles.hiddenInput,
						disabled,
						ref: inputRef,
						style: { pointerEvents: "none" },
						onBlur: handleBlur,
						onFocus: handleFocus
					}),
					!isFocused && hotkeyValue && !disabled && (allowReset || allowClear) && /* @__PURE__ */ jsxs(FlexBasic_default, {
						horizontal: true,
						gap: 4,
						children: [allowReset && hotkeyValue !== resetValue && /* @__PURE__ */ jsx(ActionIcon, {
							icon: Undo2Icon,
							size: "small",
							title: resetTitle,
							variant: "filled",
							onClick: handleReset
						}), allowClear && /* @__PURE__ */ jsx(ActionIcon, {
							icon: XIcon,
							size: "small",
							title: clearTitle,
							variant: "filled",
							onClick: handleClear
						})]
					})
				]
			}),
			hasConflict && /* @__PURE__ */ jsx("div", {
				className: styles.errorText,
				children: conflictText
			}),
			hasInvalidCombination && /* @__PURE__ */ jsx("div", {
				className: styles.errorText,
				children: invalidText
			})
		]
	});
});
HotkeyInput.displayName = "HotkeyInput";
//#endregion
export { HotkeyInput as default };

//# sourceMappingURL=HotkeyInput.mjs.map