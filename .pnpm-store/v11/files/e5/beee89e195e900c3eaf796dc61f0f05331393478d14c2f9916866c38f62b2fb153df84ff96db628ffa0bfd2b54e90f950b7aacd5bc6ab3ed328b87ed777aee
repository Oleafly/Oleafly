"use client";
import Icon from "../../Icon/Icon.mjs";
import { styles } from "../DropdownMenu/sharedStyle.mjs";
import { styles as styles$1 } from "./style.mjs";
import { isValueEmpty } from "./helpers.mjs";
import { isValidElement } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronDown, Loader2, X } from "lucide-react";
import { Select } from "@base-ui/react/select";
import { Virtualizer } from "virtua";
//#region src/base-ui/Select/parts.tsx
function resolveIconNode(node) {
	if (node === void 0 || node === null) return null;
	if (isValidElement(node) || typeof node === "string" || typeof node === "number") return node;
	return /* @__PURE__ */ jsx(Icon, {
		icon: node,
		size: "small"
	});
}
function resolveSuffixIcon(suffixIcon, suffixIconProps, loading) {
	if (loading) return /* @__PURE__ */ jsx(Icon, {
		spin: true,
		icon: Loader2,
		size: "small"
	});
	if (suffixIcon === null) return null;
	if (isValidElement(suffixIcon) || typeof suffixIcon === "string" || typeof suffixIcon === "number") return suffixIcon;
	return /* @__PURE__ */ jsx(Icon, {
		icon: suffixIcon || ChevronDown,
		size: "small",
		...suffixIconProps,
		style: {
			pointerEvents: "none",
			...suffixIconProps?.style
		}
	});
}
function createTriggerValueRenderer({ getOption, isMultiple, isTags, labelRender, normalizeValue, onRemoveValue, placeholder }) {
	return function renderValue(currentValue) {
		const resolved = normalizeValue(currentValue);
		const placeholderNode = placeholder === void 0 ? null : /* @__PURE__ */ jsx("span", {
			className: styles$1.valueText,
			children: placeholder
		});
		if (isMultiple) {
			const values = Array.isArray(resolved) ? resolved : [];
			if (values.length === 0) return placeholderNode;
			return /* @__PURE__ */ jsx("span", {
				className: styles$1.tags,
				children: values.map((val, index) => {
					const option = getOption(val);
					const content = labelRender ? labelRender(option) : option.label ?? String(val);
					return /* @__PURE__ */ jsxs("span", {
						className: styles$1.tag,
						"data-role": "lobe-select-tag",
						children: [content, isTags && /* @__PURE__ */ jsx("span", {
							"aria-label": `Remove ${String(val)}`,
							className: styles$1.tagClose,
							"data-role": "lobe-select-tag-remove",
							role: "button",
							tabIndex: 0,
							onClick: (event) => {
								event.preventDefault();
								event.stopPropagation();
								onRemoveValue(index);
							},
							onPointerDown: (event) => {
								event.preventDefault();
								event.stopPropagation();
							},
							children: /* @__PURE__ */ jsx(X, { size: 12 })
						})]
					}, `${String(val)}-${index}`);
				})
			});
		}
		if (isValueEmpty(resolved)) return placeholderNode;
		const option = getOption(resolved);
		const content = labelRender ? labelRender(option) : option.label ?? String(resolved);
		return /* @__PURE__ */ jsx("span", {
			className: styles$1.valueText,
			children: content
		});
	};
}
function SelectListSection({ classNames, hasSearch, isEmpty, listContent, listItemHeight, virtual, virtualState }) {
	const listClassName = cx(styles$1.list, hasSearch && styles$1.listWithSearch, classNames?.list);
	if (!virtual || isEmpty) return /* @__PURE__ */ jsx(Select.List, {
		className: listClassName,
		"data-virtual": virtual || void 0,
		children: listContent
	});
	const { handleListScroll, keepMountedIndices, listRef, markPointerScroll, virtualListStyle } = virtualState;
	return /* @__PURE__ */ jsx(Select.List, {
		"data-virtual": true,
		className: listClassName,
		ref: listRef,
		style: virtualListStyle,
		tabIndex: -1,
		onPointerDown: markPointerScroll,
		onScroll: handleListScroll,
		onTouchMove: markPointerScroll,
		onWheel: markPointerScroll,
		children: /* @__PURE__ */ jsx(Virtualizer, {
			itemSize: listItemHeight,
			keepMounted: keepMountedIndices,
			children: listContent
		})
	});
}
function EmptyContent({ classNames }) {
	return /* @__PURE__ */ jsx("div", {
		className: cx(styles.item, styles.empty, styles$1.empty, classNames?.empty),
		children: "No data"
	});
}
function SelectSearchInput({ autoFocus, classNames, disabled, inline, onChange, onKeyDown, placeholder, readOnly, stopPropagation, value }) {
	return /* @__PURE__ */ jsx("div", {
		className: cx(inline ? styles$1.tagsSearch : styles$1.search, classNames?.search),
		children: /* @__PURE__ */ jsx("input", {
			autoFocus,
			className: styles$1.searchInput,
			disabled,
			placeholder: typeof placeholder === "string" ? placeholder : void 0,
			readOnly,
			value,
			onChange,
			onKeyDownCapture: onKeyDown,
			onKeyUp: stopPropagation,
			onKeyUpCapture: stopPropagation
		})
	});
}
function SelectTriggerSuffix({ classNames, onClear, showClear, suffixIconNode }) {
	return /* @__PURE__ */ jsxs("span", {
		className: cx(styles$1.suffix, classNames?.suffix),
		children: [showClear && /* @__PURE__ */ jsx("span", {
			className: cx(styles$1.clear, classNames?.clear),
			"data-role": "lobe-select-clear",
			onClick: onClear,
			children: /* @__PURE__ */ jsx(Icon, {
				icon: X,
				size: "small"
			})
		}), suffixIconNode !== null && suffixIconNode !== void 0 && /* @__PURE__ */ jsx(Select.Icon, {
			className: cx(styles$1.icon, classNames?.icon),
			children: suffixIconNode
		})]
	});
}
//#endregion
export { EmptyContent, SelectListSection, SelectSearchInput, SelectTriggerSuffix, createTriggerValueRenderer, resolveIconNode, resolveSuffixIcon };

//# sourceMappingURL=parts.mjs.map