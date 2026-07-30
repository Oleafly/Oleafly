"use client";
import { useAppElement } from "../../ThemeProvider/AppElementContext.mjs";
import { countVirtualItems, getOptionSearchText, isGroupOption, isValueEmpty, normalizeValueFor, splitBySeparators } from "./helpers.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/base-ui/Select/hooks.tsx
function useSelectValue({ defaultValue, extraOptions, isMultiple, onChange, onSelect, options, setExtraOptions, value }) {
	const [uncontrolledValue, setUncontrolledValue] = useState(() => {
		if (defaultValue !== void 0) return defaultValue;
		return isMultiple ? [] : null;
	});
	const normalizeValue = useMemo(() => normalizeValueFor(isMultiple), [isMultiple]);
	const mergedValue = value !== void 0 ? value : uncontrolledValue;
	const normalizedValue = useMemo(() => normalizeValue(mergedValue), [mergedValue, normalizeValue]);
	const valueArray = useMemo(() => {
		if (isMultiple) return normalizedValue;
		return isValueEmpty(normalizedValue) ? [] : [normalizedValue];
	}, [isMultiple, normalizedValue]);
	const { optionMap, resolvedOptions } = useMemo(() => {
		const baseOptions = options ?? [];
		const optionValueMap = /* @__PURE__ */ new Map();
		const addOption = (item) => {
			if (!optionValueMap.has(item.value)) optionValueMap.set(item.value, item);
		};
		baseOptions.forEach((item) => {
			if (isGroupOption(item)) item.options.forEach(addOption);
			else addOption(item);
		});
		const filteredExtraOptions = extraOptions.filter((item) => !optionValueMap.has(item.value));
		filteredExtraOptions.forEach(addOption);
		const mergedOptions = [...baseOptions, ...filteredExtraOptions];
		const missingValueOptions = valueArray.filter((val) => !optionValueMap.has(val)).map((val) => ({
			label: String(val),
			value: val
		}));
		missingValueOptions.forEach(addOption);
		return {
			optionMap: optionValueMap,
			resolvedOptions: missingValueOptions.length ? [...mergedOptions, ...missingValueOptions] : mergedOptions
		};
	}, [
		extraOptions,
		options,
		valueArray
	]);
	const getOption = useCallback((optionValue) => {
		const matched = optionMap.get(optionValue);
		if (matched) return matched;
		if (optionValue && typeof optionValue === "object" && "label" in optionValue) return {
			label: optionValue.label,
			value: optionValue
		};
		return {
			label: String(optionValue),
			value: optionValue
		};
	}, [optionMap]);
	const previousValueRef = useRef(normalizedValue);
	useEffect(() => {
		previousValueRef.current = normalizedValue;
	}, [normalizedValue]);
	const handleValueChange = useCallback((nextValue) => {
		const normalizedNextValue = normalizeValue(nextValue);
		const previousValue = previousValueRef.current;
		if (isMultiple) {
			const prevValues = Array.isArray(previousValue) ? previousValue : [];
			const nextValues = Array.isArray(normalizedNextValue) ? normalizedNextValue : [];
			nextValues.filter((val) => !prevValues.some((prev) => Object.is(prev, val))).forEach((val) => onSelect?.(val, getOption(val)));
			if (value === void 0) setUncontrolledValue(nextValues);
			onChange?.(nextValues, nextValues.map((val) => getOption(val)));
		} else {
			if (!isValueEmpty(normalizedNextValue) && !Object.is(previousValue, normalizedNextValue)) onSelect?.(normalizedNextValue, getOption(normalizedNextValue));
			if (value === void 0) setUncontrolledValue(normalizedNextValue);
			onChange?.(isValueEmpty(normalizedNextValue) ? void 0 : normalizedNextValue, isValueEmpty(normalizedNextValue) ? void 0 : getOption(normalizedNextValue));
		}
		previousValueRef.current = normalizedNextValue;
	}, [
		getOption,
		isMultiple,
		normalizeValue,
		onChange,
		onSelect,
		value
	]);
	return {
		appendTagValues: useCallback((rawValues) => {
			const valuesToAdd = rawValues.map((val) => val.trim()).filter(Boolean);
			if (!valuesToAdd.length) return;
			const nextValues = [...Array.isArray(previousValueRef.current) ? previousValueRef.current : valueArray];
			const newOptionValues = valuesToAdd.filter((val) => !optionMap.has(val));
			if (newOptionValues.length > 0) setExtraOptions((prev) => {
				const existingValues = new Set(prev.map((item) => item.value));
				const merged = [...prev];
				newOptionValues.forEach((val) => {
					if (!existingValues.has(val)) merged.push({
						label: val,
						value: val
					});
				});
				return merged;
			});
			valuesToAdd.forEach((val) => {
				if (!nextValues.some((item) => Object.is(item, val))) nextValues.push(val);
			});
			if (nextValues.length !== valueArray.length) handleValueChange(nextValues);
		}, [
			handleValueChange,
			optionMap,
			setExtraOptions,
			valueArray
		]),
		getOption,
		handleValueChange,
		normalizedValue,
		normalizeValue,
		optionMap,
		resolvedOptions,
		removeLastTagValue: useCallback(() => {
			const currentValues = Array.isArray(previousValueRef.current) ? previousValueRef.current : valueArray;
			if (currentValues.length > 0) handleValueChange(currentValues.slice(0, -1));
		}, [handleValueChange, valueArray]),
		valueArray
	};
}
function useSelectOpen({ defaultOpen, onOpenChange, open }) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(Boolean(defaultOpen));
	useEffect(() => {
		if (open !== void 0) setUncontrolledOpen(open);
	}, [open]);
	const mergedOpen = open ?? uncontrolledOpen;
	return {
		handleOpenChange: useCallback((nextOpen, eventDetails) => {
			onOpenChange?.(nextOpen, eventDetails);
			if (open === void 0) setUncontrolledOpen(nextOpen);
		}, [onOpenChange, open]),
		mergedOpen
	};
}
function useSelectSearch({ appendTagValues, handleOpenChange, mergedOpen, mode, removeLastTagValue, resolvedOptions, showSearch, tokenSeparators }) {
	const [searchValue, setSearchValue] = useState("");
	const shouldShowSearch = Boolean(showSearch || mode === "tags");
	useEffect(() => {
		if (!mergedOpen) setSearchValue("");
	}, [mergedOpen]);
	const handleSearchChange = useCallback((event) => {
		const nextValue = event.target.value;
		if (mode === "tags") {
			const parts = splitBySeparators(nextValue, tokenSeparators);
			if (parts.length > 1) {
				const pending = parts.pop() ?? "";
				appendTagValues(parts.filter(Boolean));
				setSearchValue(pending);
				return;
			}
		}
		setSearchValue(nextValue);
	}, [
		appendTagValues,
		mode,
		tokenSeparators
	]);
	const handleSearchKeyDown = useCallback((event) => {
		event.stopPropagation();
		if (event.key === "Escape") {
			handleOpenChange(false);
			return;
		}
		if (mode !== "tags") return;
		if (event.key === "Backspace" && !searchValue) {
			event.preventDefault();
			removeLastTagValue();
			return;
		}
		const isSeparator = tokenSeparators?.includes(event.key);
		if (event.key === "Enter" || isSeparator) {
			event.preventDefault();
			event.stopPropagation();
			appendTagValues([searchValue]);
			setSearchValue("");
		}
	}, [
		appendTagValues,
		handleOpenChange,
		mode,
		removeLastTagValue,
		searchValue,
		tokenSeparators
	]);
	const stopSearchPropagation = useCallback((event) => {
		event.stopPropagation();
	}, []);
	return {
		filteredOptions: useMemo(() => {
			if (!shouldShowSearch || !searchValue.trim()) return resolvedOptions;
			const query = searchValue.trim().toLowerCase();
			return resolvedOptions.map((item) => {
				if (isGroupOption(item)) {
					const groupItems = item.options.filter((option) => getOptionSearchText(option).toLowerCase().includes(query));
					if (!groupItems.length) return null;
					return {
						...item,
						options: groupItems
					};
				}
				return getOptionSearchText(item).toLowerCase().includes(query) ? item : null;
			}).filter(Boolean);
		}, [
			resolvedOptions,
			searchValue,
			shouldShowSearch
		]),
		handleSearchChange,
		handleSearchKeyDown,
		searchValue,
		shouldShowSearch,
		stopSearchPropagation
	};
}
function useSelectVirtual({ filteredOptions, listItemHeight, size, valueArray, virtual }) {
	const listRef = useRef(null);
	const pointerScrollRef = useRef(false);
	const pointerScrollTimeoutRef = useRef(null);
	const renderVirtualItem = useCallback((props) => {
		const { ref, ...rest } = props;
		return /* @__PURE__ */ jsx("div", {
			...rest,
			ref: (node) => {
				if (node) node.scrollIntoView = (...args) => {
					if (!pointerScrollRef.current) HTMLElement.prototype.scrollIntoView.call(node, ...args);
				};
				if (typeof ref === "function") ref(node);
				else if (ref && "current" in ref) ref.current = node;
			}
		});
	}, []);
	const markPointerScroll = useCallback(() => {
		pointerScrollRef.current = true;
		if (pointerScrollTimeoutRef.current) clearTimeout(pointerScrollTimeoutRef.current);
		pointerScrollTimeoutRef.current = setTimeout(() => {
			pointerScrollRef.current = false;
		}, 120);
	}, []);
	const handleListScroll = useCallback(() => {
		if (!virtual || !pointerScrollRef.current) return;
		const listElement = listRef.current;
		const activeElement = document.activeElement;
		if (listElement && activeElement && listElement.contains(activeElement)) listElement.focus({ preventScroll: true });
	}, [virtual]);
	useEffect(() => {
		return () => {
			if (pointerScrollTimeoutRef.current) clearTimeout(pointerScrollTimeoutRef.current);
		};
	}, []);
	const virtualListStyle = useMemo(() => {
		if (!virtual) return void 0;
		const rowCount = countVirtualItems(filteredOptions);
		return { height: `min(${Math.min(Math.max(rowCount, 1), 6) * (listItemHeight ?? (size === "large" ? 40 : size === "small" ? 28 : 32)) + 8}px, var(--lobe-select-available-height, var(--available-height)))` };
	}, [
		filteredOptions,
		listItemHeight,
		size,
		virtual
	]);
	return {
		handleListScroll,
		keepMountedIndices: useMemo(() => {
			if (!virtual || valueArray.length === 0) return void 0;
			const selectedSet = new Set(valueArray);
			const indices = [];
			let index = 0;
			filteredOptions.forEach((item) => {
				if (isGroupOption(item)) {
					if (item.options.some((option) => selectedSet.has(option.value))) indices.push(index);
					index += 1;
					return;
				}
				if (selectedSet.has(item.value)) indices.push(index);
				index += 1;
			});
			return indices.length ? indices : void 0;
		}, [
			filteredOptions,
			valueArray,
			virtual
		]),
		listRef,
		markPointerScroll,
		renderVirtualItem,
		virtualListStyle
	};
}
function usePortalContainer() {
	const appElement = useAppElement();
	return useMemo(() => {
		if (typeof window === "undefined") return appElement;
		if (!(appElement instanceof HTMLElement)) return void 0;
		return window.getComputedStyle(appElement).display === "contents" ? document.body : appElement;
	}, [appElement]);
}
//#endregion
export { usePortalContainer, useSelectOpen, useSelectSearch, useSelectValue, useSelectVirtual };

//# sourceMappingURL=hooks.mjs.map