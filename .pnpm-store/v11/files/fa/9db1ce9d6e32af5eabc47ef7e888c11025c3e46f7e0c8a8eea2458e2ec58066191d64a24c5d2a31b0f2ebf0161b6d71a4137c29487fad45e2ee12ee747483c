"use client";
import { SegmentedIndicator, SegmentedItem, SegmentedItemIcon, SegmentedItemLabel, SegmentedRoot } from "./atoms.mjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
//#region src/base-ui/Segmented/Segmented.tsx
const normalizeOption = (option) => typeof option === "string" ? {
	label: option,
	value: option
} : option;
const Segmented = ({ block = false, className, classNames, defaultValue, disabled = false, glass = false, id, name, onChange, options, ref, shadow = false, size = "middle", style, styles: customStyles, value, variant = "filled", vertical = false }) => {
	const [innerValue, setInnerValue] = useMergeState(defaultValue, {
		defaultValue,
		onChange: (next) => {
			if (next != null) onChange?.(next);
		},
		value
	});
	const listRef = useRef(null);
	const mergedRef = useCallback((node) => {
		listRef.current = node;
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
	}, [ref]);
	const normalizedOptions = useMemo(() => (options ?? []).map((o) => normalizeOption(o)), [options]);
	const updateIndicator = useCallback(() => {
		const list = listRef.current;
		if (!list) return;
		const active = list.querySelector("[data-segmented-item][data-pressed]");
		if (!active) {
			list.style.setProperty("--active-item-width", "0px");
			list.style.setProperty("--active-item-height", "0px");
			return;
		}
		list.style.setProperty("--active-item-left", `${active.offsetLeft}px`);
		list.style.setProperty("--active-item-top", `${active.offsetTop}px`);
		list.style.setProperty("--active-item-width", `${active.offsetWidth}px`);
		list.style.setProperty("--active-item-height", `${active.offsetHeight}px`);
	}, []);
	useLayoutEffect(() => {
		updateIndicator();
	}, [
		innerValue,
		normalizedOptions,
		vertical,
		size,
		block,
		updateIndicator
	]);
	useEffect(() => {
		const list = listRef.current;
		if (!list || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => updateIndicator());
		ro.observe(list);
		return () => ro.disconnect();
	}, [updateIndicator]);
	const groupValue = useMemo(() => innerValue != null ? [innerValue] : [], [innerValue]);
	const rootStyle = {
		...style,
		...customStyles?.root
	};
	return /* @__PURE__ */ jsxs(SegmentedRoot, {
		block,
		className: cx(classNames?.root, className),
		disabled,
		glass,
		id,
		orientation: vertical ? "vertical" : "horizontal",
		ref: mergedRef,
		shadow,
		style: rootStyle,
		value: groupValue,
		variant,
		onValueChange: (next) => {
			const picked = next[0];
			if (picked != null) setInnerValue(picked);
		},
		children: [/* @__PURE__ */ jsx(SegmentedIndicator, {
			className: classNames?.indicator,
			style: customStyles?.indicator
		}), normalizedOptions.map((opt) => /* @__PURE__ */ jsxs(SegmentedItem, {
			"aria-label": typeof opt.label === "string" ? opt.label : void 0,
			block,
			className: cx(classNames?.item, opt.className),
			"data-segmented-item": "",
			disabled: disabled || opt.disabled,
			name,
			size,
			style: customStyles?.item,
			title: opt.title,
			value: opt.value,
			children: [opt.icon != null && /* @__PURE__ */ jsx(SegmentedItemIcon, {
				className: classNames?.itemIcon,
				style: customStyles?.itemIcon,
				children: opt.icon
			}), opt.label != null && /* @__PURE__ */ jsx(SegmentedItemLabel, {
				className: classNames?.itemLabel,
				style: customStyles?.itemLabel,
				children: opt.label
			})]
		}, opt.value))]
	});
};
Segmented.displayName = "Segmented";
//#endregion
export { Segmented as default };

//# sourceMappingURL=Segmented.mjs.map