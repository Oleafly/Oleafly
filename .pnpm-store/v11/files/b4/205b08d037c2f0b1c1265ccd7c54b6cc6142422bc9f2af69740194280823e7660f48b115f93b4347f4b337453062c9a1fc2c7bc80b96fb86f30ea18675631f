"use client";
import { useMotionComponent } from "../MotionProvider/index.mjs";
import { useAccordionConfig, useAccordionItemState } from "./context.mjs";
import { styles } from "./style.mjs";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Block from "../Block/Block.mjs";
import Text from "../Text/Text.mjs";
import { stopPropagation } from "../utils/dom.mjs";
import ArrowIcon from "./ArrowIcon.mjs";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { AnimatePresence } from "motion/react";
import useMergeState from "use-merge-value";
//#region src/Accordion/AccordionItem.tsx
const motionContainerStyle = { overflow: "hidden" };
const AccordionStaticContent = memo(({ className, style, children, contentInnerClassName, isOpen, keepContentMounted }) => {
	if (keepContentMounted) return /* @__PURE__ */ jsx("div", {
		className,
		role: "region",
		style: {
			display: isOpen ? "block" : "none",
			...style
		},
		children: /* @__PURE__ */ jsx("div", {
			className: contentInnerClassName,
			children
		})
	});
	if (!isOpen) return null;
	return /* @__PURE__ */ jsx("div", {
		className,
		role: "region",
		style,
		children: /* @__PURE__ */ jsx("div", {
			className: contentInnerClassName,
			children
		})
	});
});
AccordionStaticContent.displayName = "AccordionStaticContent";
const AccordionMotionContent = memo(({ contextMotionProps, className, style, children, contentInnerClassName, isOpen, skipInitialAnimation }) => {
	const Motion = useMotionComponent();
	const motionProps = useMemo(() => ({
		animate: "enter",
		exit: "exit",
		initial: skipInitialAnimation ? false : "exit",
		variants: {
			enter: {
				height: "auto",
				opacity: 1,
				transition: {
					duration: .2,
					ease: [
						.4,
						0,
						.2,
						1
					]
				}
			},
			exit: {
				height: 0,
				opacity: 0,
				transition: {
					duration: .2,
					ease: [
						.4,
						0,
						.2,
						1
					]
				}
			}
		},
		...contextMotionProps
	}), [contextMotionProps, skipInitialAnimation]);
	return /* @__PURE__ */ jsx(AnimatePresence, {
		initial: false,
		children: isOpen ? /* @__PURE__ */ jsx(Motion.div, {
			...motionProps,
			style: motionContainerStyle,
			children: /* @__PURE__ */ jsx("div", {
				className,
				role: "region",
				style,
				children: /* @__PURE__ */ jsx("div", {
					className: contentInnerClassName,
					children
				})
			})
		}) : null
	});
});
AccordionMotionContent.displayName = "AccordionMotionContent";
const AccordionItemContent = memo(({ disableAnimation, isOpen, keepContentMounted, className, style, children, contentInnerClassName, contextMotionProps, skipInitialAnimation }) => {
	if (disableAnimation || !keepContentMounted) return /* @__PURE__ */ jsx(AccordionStaticContent, {
		className,
		contentInnerClassName,
		isOpen,
		keepContentMounted,
		style,
		children
	});
	return /* @__PURE__ */ jsx(AccordionMotionContent, {
		className,
		contentInnerClassName,
		contextMotionProps,
		isOpen,
		skipInitialAnimation,
		style,
		children
	});
});
AccordionItemContent.displayName = "AccordionItemContent";
const AccordionItem = memo(({ itemKey, title, children, action, alwaysShowAction = false, disabled = false, allowExpand = true, hideIndicator: itemHideIndicator, indicatorPlacement: itemIndicatorPlacement, indicator: customIndicator, classNames, paddingInline = 16, paddingBlock = 8, padding, ref, variant: customVariant, styles: customStyles, headerWrapper, defaultExpand, expand, onExpandChange }) => {
	const itemStateContext = useAccordionItemState();
	const configContext = useAccordionConfig();
	const isStandalone = expand !== void 0 || defaultExpand !== void 0;
	const [isExpandedStandalone, setIsExpandedStandalone] = useMergeState(defaultExpand ?? false, {
		onChange: onExpandChange,
		value: expand
	});
	const contextHideIndicator = configContext?.hideIndicator;
	const contextIndicatorPlacement = configContext?.indicatorPlacement;
	const contextKeepContentMounted = configContext?.keepContentMounted;
	const contextDisableAnimation = configContext?.disableAnimation;
	const contextMotionProps = configContext?.motionProps;
	const contextVariant = configContext?.variant ?? "borderless";
	const isInitialRenderRef = useRef(true);
	useEffect(() => {
		isInitialRenderRef.current = false;
	}, []);
	const isDirectContextItem = itemStateContext?.itemKey === itemKey;
	let isOpen = false;
	if (isStandalone) isOpen = isExpandedStandalone;
	else if (itemStateContext) isOpen = isDirectContextItem ? itemStateContext.isOpen : itemStateContext.isOpen || itemStateContext.isOpenKey(itemKey);
	const hideIndicatorFinal = itemHideIndicator ?? contextHideIndicator ?? false;
	const indicatorPlacementFinal = itemIndicatorPlacement ?? contextIndicatorPlacement ?? "start";
	const keepContentMounted = contextKeepContentMounted ?? true;
	const disableAnimation = contextDisableAnimation ?? false;
	const variant = customVariant || contextVariant;
	const contextOnToggle = useCallback(() => {
		if (!itemStateContext) return;
		if (itemStateContext.itemKey === itemKey) {
			itemStateContext.onToggle();
			return;
		}
		itemStateContext.onToggleNestedKey(itemKey);
	}, [itemStateContext, itemKey]);
	const handleToggle = useCallback(() => {
		if (!allowExpand) return;
		if (!disabled) {
			if (isStandalone) setIsExpandedStandalone(!isExpandedStandalone);
			else if (contextOnToggle) contextOnToggle();
		}
	}, [
		allowExpand,
		disabled,
		isStandalone,
		setIsExpandedStandalone,
		isExpandedStandalone,
		contextOnToggle
	]);
	const handleKeyDown = useCallback((e) => {
		if (!allowExpand || disabled) return;
		switch (e.key) {
			case "Enter":
			case " ":
				e.preventDefault();
				handleToggle();
				break;
		}
	}, [
		allowExpand,
		disabled,
		handleToggle
	]);
	const preventTitleTextSelection = useCallback((e) => {
		if (e?.detail > 1) e.preventDefault();
	}, []);
	const indicator = useMemo(() => {
		if (!allowExpand || hideIndicatorFinal) return null;
		if (customIndicator) {
			if (typeof customIndicator === "function") return /* @__PURE__ */ jsx("span", {
				"aria-hidden": "true",
				className: cx(styles.indicator, classNames?.indicator),
				style: customStyles?.indicator,
				children: customIndicator({
					isDisabled: disabled,
					isOpen
				})
			});
			return /* @__PURE__ */ jsx("span", {
				"aria-hidden": "true",
				className: cx(styles.indicator, classNames?.indicator),
				style: customStyles?.indicator,
				children: customIndicator
			});
		}
		return /* @__PURE__ */ jsx("span", {
			"aria-hidden": "true",
			className: cx(styles.indicator, classNames?.indicator),
			style: customStyles?.indicator,
			children: /* @__PURE__ */ jsx(ArrowIcon, { className: cx(styles.icon, isOpen && styles.iconRotate) })
		});
	}, [
		allowExpand,
		hideIndicatorFinal,
		customIndicator,
		disabled,
		isOpen,
		classNames,
		customStyles
	]);
	const skipInitialAnimation = isInitialRenderRef.current && isOpen;
	const contentClassName = useMemo(() => cx("accordion-content", styles.content, classNames?.content), [classNames?.content]);
	const titleNode = useMemo(() => typeof title === "string" ? /* @__PURE__ */ jsx(Text, {
		ellipsis: true,
		className: classNames?.title,
		style: customStyles?.title,
		children: title
	}) : title, [
		title,
		classNames?.title,
		customStyles?.title
	]);
	const actionNode = useMemo(() => action && /* @__PURE__ */ jsx(FlexBasic_default, {
		horizontal: true,
		align: "center",
		flex: "none",
		gap: 4,
		style: customStyles?.action,
		className: cx("accordion-action", styles.action, alwaysShowAction && styles.actionVisible, classNames?.action),
		onClick: stopPropagation,
		children: action
	}), [
		action,
		alwaysShowAction,
		classNames?.action,
		customStyles?.action
	]);
	const headerElement = useMemo(() => {
		const header = /* @__PURE__ */ jsx(Block, {
			horizontal: true,
			className: cx("accordion-header", styles.header, classNames?.header),
			clickable: !disabled && allowExpand,
			gap: 4,
			justify: "space-between",
			padding,
			paddingBlock,
			paddingInline,
			ref,
			variant: customVariant || variant,
			style: {
				alignItems: "center",
				cursor: disabled ? "not-allowed" : allowExpand ? "pointer" : "default",
				opacity: disabled ? .5 : void 0,
				overflow: "hidden",
				width: "100%",
				...customStyles?.header
			},
			onClick: handleToggle,
			onKeyDown: handleKeyDown,
			children: indicatorPlacementFinal === "start" ? /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: styles.titleWrapper,
				flex: 1,
				gap: 2,
				style: { overflow: "hidden" },
				onDoubleClick: preventTitleTextSelection,
				onMouseDown: preventTitleTextSelection,
				children: [titleNode, indicator]
			}), /* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				flex: "none",
				gap: 4,
				children: actionNode
			})] }) : /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: styles.titleWrapper,
				flex: 1,
				gap: 2,
				style: { overflow: "hidden" },
				onDoubleClick: preventTitleTextSelection,
				onMouseDown: preventTitleTextSelection,
				children: titleNode
			}), /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				flex: "none",
				gap: 4,
				children: [actionNode, indicator]
			})] })
		});
		if (headerWrapper) return headerWrapper(header);
		return header;
	}, [
		classNames?.header,
		disabled,
		allowExpand,
		padding,
		paddingBlock,
		paddingInline,
		ref,
		customVariant,
		variant,
		customStyles?.header,
		handleToggle,
		handleKeyDown,
		indicatorPlacementFinal,
		preventTitleTextSelection,
		titleNode,
		indicator,
		actionNode,
		headerWrapper
	]);
	return /* @__PURE__ */ jsxs("div", {
		className: cx("accordion-item", styles.item, classNames?.base),
		style: customStyles?.base,
		children: [headerElement, /* @__PURE__ */ jsx(AccordionItemContent, {
			className: contentClassName,
			contentInnerClassName: styles.contentInner,
			contextMotionProps,
			disableAnimation: !!disableAnimation,
			isOpen,
			keepContentMounted: !!keepContentMounted,
			skipInitialAnimation,
			style: customStyles?.content,
			children
		})]
	});
});
AccordionItem.displayName = "AccordionItem";
//#endregion
export { AccordionItem as default };

//# sourceMappingURL=AccordionItem.mjs.map