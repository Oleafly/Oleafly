"use client";
import { styles } from "../DropdownMenu/sharedStyle.mjs";
import { styles as styles$1, triggerVariants } from "./style.mjs";
import { SelectPositioner } from "./atoms.mjs";
import { isValueEmpty } from "./helpers.mjs";
import { usePortalContainer, useSelectOpen, useSelectSearch, useSelectValue, useSelectVirtual } from "./hooks.mjs";
import { EmptyContent, SelectListSection, SelectSearchInput, SelectTriggerSuffix, createTriggerValueRenderer, resolveIconNode, resolveSuffixIcon } from "./parts.mjs";
import { renderOptions } from "./renderOptions.mjs";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
import { Select } from "@base-ui/react/select";
//#region src/base-ui/Select/Select.tsx
const Select$1 = memo(({ allowClear, autoFocus, className, classNames, defaultOpen, defaultValue, disabled, id, labelRender, listHeight = 512, listItemHeight, loading, mode, name, onChange, onOpenChange, onSelect, open, optionRender, options, placeholder, popupClassName, popupMatchSelectWidth, prefix, readOnly, required, behaviorVariant = "default", selectedIndicatorVariant = "check", shadow, showSearch, size = "middle", style, suffixIcon, suffixIconProps, tokenSeparators, value, variant, virtual }) => {
	const { isDarkMode } = useThemeMode();
	const resolvedVariant = variant ?? (isDarkMode ? "filled" : "outlined");
	const isTags = mode === "tags";
	const isMultiple = mode === "multiple" || mode === "tags";
	const isItemAligned = behaviorVariant === "item-aligned";
	const [extraOptions, setExtraOptions] = useState([]);
	useEffect(() => {
		if (mode !== "tags" && extraOptions.length > 0) setExtraOptions([]);
	}, [mode, extraOptions.length]);
	const { appendTagValues, getOption, handleValueChange, normalizedValue, normalizeValue, removeLastTagValue, resolvedOptions, valueArray } = useSelectValue({
		defaultValue,
		extraOptions,
		isMultiple,
		onChange,
		onSelect,
		options,
		setExtraOptions,
		value
	});
	const { handleOpenChange, mergedOpen } = useSelectOpen({
		defaultOpen,
		onOpenChange,
		open
	});
	const handleRootValueChange = useCallback((nextValue) => {
		if (!(isTags && !mergedOpen)) handleValueChange(nextValue);
	}, [
		handleValueChange,
		isTags,
		mergedOpen
	]);
	const handleRemoveTag = useCallback((index) => handleValueChange(valueArray.filter((_, itemIndex) => itemIndex !== index)), [handleValueChange, valueArray]);
	const { filteredOptions, handleSearchChange, handleSearchKeyDown, searchValue, shouldShowSearch, stopSearchPropagation } = useSelectSearch({
		appendTagValues,
		handleOpenChange,
		mergedOpen,
		mode,
		removeLastTagValue,
		resolvedOptions,
		showSearch,
		tokenSeparators
	});
	const virtualState = useSelectVirtual({
		filteredOptions,
		listItemHeight,
		size,
		valueArray,
		virtual
	});
	const portalContainer = usePortalContainer();
	const renderValue = useMemo(() => createTriggerValueRenderer({
		getOption,
		isMultiple,
		isTags,
		labelRender,
		normalizeValue,
		onRemoveValue: handleRemoveTag,
		placeholder: isTags ? void 0 : placeholder
	}), [
		getOption,
		handleRemoveTag,
		isMultiple,
		isTags,
		labelRender,
		normalizeValue,
		placeholder
	]);
	const hasValue = isMultiple ? valueArray.length > 0 : !isValueEmpty(normalizedValue);
	const showClear = Boolean(allowClear && hasValue && !disabled && !readOnly);
	const handleClear = useCallback((event) => {
		event.preventDefault();
		event.stopPropagation();
		handleValueChange(isMultiple ? [] : null);
	}, [handleValueChange, isMultiple]);
	const prefixNode = useMemo(() => resolveIconNode(prefix), [prefix]);
	const suffixIconNode = useMemo(() => resolveSuffixIcon(suffixIcon, suffixIconProps, loading), [
		loading,
		suffixIcon,
		suffixIconProps
	]);
	const popupStyle = useMemo(() => {
		const maxHeight = isItemAligned ? "80vh" : `${listHeight}px`;
		const baseStyle = {
			maxHeight,
			maxWidth: "var(--available-width)",
			minWidth: "var(--anchor-width)",
			["--lobe-select-popup-max-height"]: maxHeight
		};
		if (popupMatchSelectWidth === void 0 || popupMatchSelectWidth === true) return baseStyle;
		if (typeof popupMatchSelectWidth === "number") return {
			...baseStyle,
			minWidth: popupMatchSelectWidth,
			width: popupMatchSelectWidth
		};
		return {
			...baseStyle,
			minWidth: "max-content"
		};
	}, [
		isItemAligned,
		listHeight,
		popupMatchSelectWidth
	]);
	const triggerClassName = cx(triggerVariants({
		shadow,
		size,
		variant: resolvedVariant
	}), className, classNames?.root, classNames?.trigger);
	const isBoldIndicator = selectedIndicatorVariant === "bold";
	const itemTextClassName = cx(optionRender ? styles.itemContent : styles.label, styles$1.itemText, classNames?.itemText);
	const isEmpty = filteredOptions.length === 0;
	const listContent = isEmpty ? /* @__PURE__ */ jsx(EmptyContent, { classNames }) : renderOptions({
		classNames,
		isBoldIndicator,
		items: filteredOptions,
		itemTextClassName,
		listItemHeight,
		optionRender,
		renderVirtualItem: virtualState.renderVirtualItem,
		virtual
	});
	return /* @__PURE__ */ jsxs(Select.Root, {
		disabled,
		id,
		modal: isItemAligned,
		multiple: isMultiple,
		name,
		open: mergedOpen,
		readOnly,
		required,
		value: normalizedValue,
		onOpenChange: handleOpenChange,
		onValueChange: handleRootValueChange,
		children: [/* @__PURE__ */ jsxs(Select.Trigger, {
			autoFocus: !isTags && autoFocus,
			className: triggerClassName,
			disabled,
			nativeButton: !isTags,
			render: isTags ? /* @__PURE__ */ jsx("div", {}) : void 0,
			style,
			children: [
				prefixNode !== null && prefixNode !== void 0 && /* @__PURE__ */ jsx("span", {
					className: cx(styles$1.prefix, classNames?.prefix),
					children: prefixNode
				}),
				/* @__PURE__ */ jsx(Select.Value, {
					className: cx(styles$1.value, isTags && styles$1.tagsValue, classNames?.value),
					children: renderValue
				}),
				isTags && /* @__PURE__ */ jsx(SelectSearchInput, {
					inline: true,
					autoFocus,
					classNames,
					disabled,
					placeholder: valueArray.length === 0 ? placeholder : void 0,
					readOnly,
					stopPropagation: stopSearchPropagation,
					value: searchValue,
					onChange: handleSearchChange,
					onKeyDown: handleSearchKeyDown
				}),
				/* @__PURE__ */ jsx(SelectTriggerSuffix, {
					classNames,
					showClear,
					suffixIconNode,
					onClear: handleClear
				})
			]
		}), /* @__PURE__ */ jsx(Select.Portal, {
			container: portalContainer,
			children: /* @__PURE__ */ jsx(SelectPositioner, {
				align: "start",
				alignItemWithTrigger: isItemAligned,
				className: styles$1.positioner,
				side: "bottom",
				sideOffset: 6,
				children: /* @__PURE__ */ jsxs(Select.Popup, {
					style: popupStyle,
					className: cx(styles.popup, styles$1.popup, popupClassName, classNames?.popup, classNames?.dropdown),
					children: [shouldShowSearch && !isTags && /* @__PURE__ */ jsx(SelectSearchInput, {
						classNames,
						placeholder,
						stopPropagation: stopSearchPropagation,
						value: searchValue,
						onChange: handleSearchChange,
						onKeyDown: handleSearchKeyDown
					}), /* @__PURE__ */ jsx(SelectListSection, {
						classNames,
						hasSearch: shouldShowSearch && !isTags,
						isEmpty,
						listContent,
						listItemHeight,
						virtual,
						virtualState
					})]
				})
			})
		})]
	});
});
Select$1.displayName = "Select";
//#endregion
export { Select$1 as default };

//# sourceMappingURL=Select.mjs.map