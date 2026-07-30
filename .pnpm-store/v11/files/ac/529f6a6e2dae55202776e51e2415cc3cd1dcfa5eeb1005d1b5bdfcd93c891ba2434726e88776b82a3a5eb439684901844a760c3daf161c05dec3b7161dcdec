"use client";
import { AccordionConfigContext, AccordionItemStateProvider } from "./context.mjs";
import { styles } from "./style.mjs";
import { Children, Fragment, isValidElement, memo, useCallback, useMemo, useRef } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { Divider } from "antd";
import { cx } from "antd-style";
import { LayoutGroup } from "motion/react";
import useMergeState from "use-merge-value";
//#region src/Accordion/Accordion.tsx
const Accordion = memo(({ children, className: userClassName, style: userStyle, accordion = false, defaultExpandedKeys, expandedKeys: expandedKeysProp, onExpandedChange, variant = "borderless", gap, showDivider = false, disableAnimation = false, hideIndicator = false, indicatorPlacement = "start", keepContentMounted = true, classNames, styles: customStyles, motionProps, ref, ...rest }) => {
	const validChildren = Children.toArray(children).filter(isValidElement);
	const allItemKeys = validChildren.map((child, index) => child.props.itemKey || index);
	const [expandedKeys, setExpandedKeys] = useMergeState(defaultExpandedKeys ?? allItemKeys, {
		onChange: onExpandedChange,
		value: expandedKeysProp
	});
	const expandedKeysRef = useRef(expandedKeys);
	expandedKeysRef.current = expandedKeys;
	const setExpandedKeysRef = useRef(setExpandedKeys);
	setExpandedKeysRef.current = setExpandedKeys;
	const isOpenKey = useCallback((key) => expandedKeysRef.current.includes(key), []);
	const toggleExpand = useCallback((key) => {
		const prev = expandedKeysRef.current;
		let newKeys;
		if (accordion) newKeys = prev.includes(key) ? [] : [key];
		else newKeys = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
		setExpandedKeysRef.current(newKeys);
	}, [accordion]);
	const toggleExpandKeys = useCallback((keys, preferredKey) => {
		const prev = expandedKeysRef.current;
		const isOpen = keys.some((key) => prev.includes(key));
		let newKeys;
		if (accordion) newKeys = isOpen ? [] : [preferredKey];
		else newKeys = isOpen ? prev.filter((key) => !keys.includes(key)) : [...prev, preferredKey];
		setExpandedKeysRef.current(newKeys);
	}, [accordion]);
	const configValue = useMemo(() => ({
		disableAnimation,
		hideIndicator,
		indicatorPlacement,
		keepContentMounted,
		motionProps,
		showDivider,
		variant
	}), [
		disableAnimation,
		hideIndicator,
		indicatorPlacement,
		keepContentMounted,
		motionProps,
		showDivider,
		variant
	]);
	const hasExplicitExpandedKeys = expandedKeysProp !== void 0 || defaultExpandedKeys !== void 0;
	const content = /* @__PURE__ */ jsx(Fragment$1, { children: validChildren.map((child, index) => {
		const hasChildItemKey = child.props.itemKey !== void 0;
		const childKey = hasChildItemKey ? child.props.itemKey : index;
		const itemIsOpen = expandedKeys.includes(childKey);
		return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(AccordionItemStateProvider, {
			expandedKeys: hasChildItemKey ? void 0 : expandedKeys,
			isOpen: itemIsOpen,
			isOpenKey,
			itemKey: childKey,
			preferProviderKeyForNestedItems: !hasExplicitExpandedKeys,
			onToggleKey: toggleExpand,
			onToggleKeys: toggleExpandKeys,
			children: child
		}), showDivider && index < validChildren.length - 1 && /* @__PURE__ */ jsx(Divider, { className: styles.divider })] }, childKey);
	}) });
	return /* @__PURE__ */ jsx(AccordionConfigContext, {
		value: configValue,
		children: /* @__PURE__ */ jsx("div", {
			className: cx(styles.base, classNames?.base, userClassName),
			ref,
			style: {
				gap,
				...customStyles?.base,
				...userStyle
			},
			...rest,
			children: disableAnimation ? content : /* @__PURE__ */ jsx(LayoutGroup, { children: content })
		})
	});
});
Accordion.displayName = "Accordion";
//#endregion
export { Accordion as default };

//# sourceMappingURL=Accordion.mjs.map