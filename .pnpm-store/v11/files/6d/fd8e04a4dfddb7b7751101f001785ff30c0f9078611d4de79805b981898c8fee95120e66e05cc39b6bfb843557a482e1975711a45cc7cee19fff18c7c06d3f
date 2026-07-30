"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Center from "../Flex/Center.mjs";
import Icon from "../Icon/Icon.mjs";
import { styles } from "./style.mjs";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import useMergeState from "use-merge-value";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useHover } from "ahooks";
import { Resizable } from "re-resizable";
//#region src/DraggableSideNav/DraggableSideNav.tsx
const DEFAULT_MIN_WIDTH = 64;
const DEFAULT_EXPAND = true;
const DEFAULT_EXPANDED_WIDTH = 280;
const ANIMATION_DURATION = 300;
const COLLAPSE_ANIMATION_DELAY = 200;
const RESIZE_DISABLED = {
	bottom: false,
	bottomLeft: false,
	bottomRight: false,
	left: false,
	right: false,
	top: false,
	topLeft: false,
	topRight: false
};
function sideNavReducer(state, action) {
	switch (action.type) {
		case "START_RESIZE": return {
			...state,
			isResizing: true
		};
		case "STOP_RESIZE": return {
			...state,
			isResizing: false
		};
		case "START_ANIMATION": return {
			...state,
			isAnimating: true
		};
		case "STOP_ANIMATION": return {
			...state,
			isAnimating: false
		};
		case "SET_WIDTH": return {
			...state,
			internalWidth: action.payload
		};
		case "SET_EXPANDED_WIDTH": return {
			...state,
			expandedWidth: action.payload
		};
		case "SET_RENDER_EXPAND": return {
			...state,
			renderExpand: action.payload
		};
		case "ANIMATE_EXPAND": return {
			...state,
			internalWidth: action.payload,
			renderExpand: true
		};
		case "ANIMATE_COLLAPSE": return {
			...state,
			internalWidth: action.payload
		};
		default: return state;
	}
}
const DraggableSideNav = memo(({ body, className, classNames, defaultExpand = DEFAULT_EXPAND, defaultWidth, expand, expandable = true, footer, header, maxWidth, minWidth = DEFAULT_MIN_WIDTH, onExpandChange, onWidthChange, onWidthDragging, placement = "left", resizable = true, showBorder = true, showHandle = true, showHandleWhenCollapsed = false, showHandleHighlight = false, backgroundColor, styles: customStyles, width, ...rest }) => {
	const cssVariables = useMemo(() => ({ "--draggable-side-nav-bg": backgroundColor || "" }), [backgroundColor]);
	const ref = useRef(null);
	const isHovering = useHover(ref);
	const [isExpand, setIsExpand] = useMergeState(defaultExpand, {
		onChange: onExpandChange,
		value: expand
	});
	const animationTimeoutRef = useRef(void 0);
	const collapseTimeoutRef = useRef(void 0);
	const computedDefaultExpandedWidth = useMemo(() => defaultWidth || DEFAULT_EXPANDED_WIDTH, [defaultWidth]);
	const [state, dispatch] = useReducer(sideNavReducer, {
		expandedWidth: width ?? computedDefaultExpandedWidth,
		internalWidth: isExpand ? width ?? computedDefaultExpandedWidth : minWidth,
		isAnimating: false,
		isResizing: false,
		renderExpand: isExpand
	});
	const collapseThreshold = useMemo(() => {
		return minWidth + (state.expandedWidth - minWidth) / 3;
	}, [minWidth, state.expandedWidth]);
	const toggleExpand = useCallback(() => {
		if (!expandable) return;
		if (state.isAnimating || state.isResizing) return;
		if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
		dispatch({ type: "START_ANIMATION" });
		setIsExpand(!isExpand);
		animationTimeoutRef.current = setTimeout(() => {
			dispatch({ type: "STOP_ANIMATION" });
		}, ANIMATION_DURATION);
	}, [
		expandable,
		isExpand,
		setIsExpand,
		state.isAnimating,
		state.isResizing
	]);
	const prevExpandRef = useRef(isExpand);
	useEffect(() => {
		if (prevExpandRef.current !== isExpand && !state.isResizing && !state.isAnimating) {
			if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
			dispatch({ type: "START_ANIMATION" });
			animationTimeoutRef.current = setTimeout(() => {
				dispatch({ type: "STOP_ANIMATION" });
			}, ANIMATION_DURATION);
			prevExpandRef.current = isExpand;
		}
	}, [
		isExpand,
		state.isResizing,
		state.isAnimating
	]);
	useEffect(() => {
		if (state.isAnimating) {
			const rafId = requestAnimationFrame(() => {
				if (isExpand) dispatch({
					payload: state.expandedWidth,
					type: "ANIMATE_EXPAND"
				});
				else {
					dispatch({
						payload: minWidth,
						type: "ANIMATE_COLLAPSE"
					});
					if (collapseTimeoutRef.current) clearTimeout(collapseTimeoutRef.current);
					collapseTimeoutRef.current = setTimeout(() => {
						dispatch({
							payload: false,
							type: "SET_RENDER_EXPAND"
						});
					}, COLLAPSE_ANIMATION_DELAY);
				}
			});
			return () => {
				cancelAnimationFrame(rafId);
			};
		}
	}, [
		isExpand,
		state.isAnimating,
		minWidth,
		state.expandedWidth
	]);
	const prevIsResizingRef = useRef(state.isResizing);
	useEffect(() => {
		const wasResizing = prevIsResizingRef.current;
		prevIsResizingRef.current = state.isResizing;
		if (wasResizing && !state.isResizing && !state.isAnimating) dispatch({
			payload: isExpand,
			type: "SET_RENDER_EXPAND"
		});
	}, [
		isExpand,
		state.isAnimating,
		state.isResizing
	]);
	useEffect(() => {
		if (width !== void 0 && !state.isResizing && !state.isAnimating) {
			dispatch({
				payload: width,
				type: "SET_EXPANDED_WIDTH"
			});
			if (isExpand) dispatch({
				payload: width,
				type: "SET_WIDTH"
			});
		}
	}, [
		width,
		state.isResizing,
		state.isAnimating,
		isExpand
	]);
	const currentBody = useMemo(() => {
		return body(state.renderExpand);
	}, [body, state.renderExpand]);
	const currentHeader = useMemo(() => {
		return typeof header === "function" ? header(state.renderExpand) : header;
	}, [header, state.renderExpand]);
	const currentFooter = useMemo(() => {
		return typeof footer === "function" ? footer(state.renderExpand) : footer;
	}, [footer, state.renderExpand]);
	const handleResize = useCallback((_, __, ref, delta) => {
		const currentWidth = ref.offsetWidth;
		dispatch({
			payload: currentWidth,
			type: "SET_WIDTH"
		});
		onWidthDragging?.(delta, currentWidth);
	}, [onWidthDragging]);
	const handleResizeStart = useCallback(() => {
		dispatch({ type: "START_RESIZE" });
	}, []);
	const handleResizeStop = useCallback((_, __, ref, delta) => {
		dispatch({ type: "STOP_RESIZE" });
		const currentWidth = ref.offsetWidth;
		if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
		if (expandable) {
			const shouldCollapse = currentWidth <= minWidth || currentWidth < collapseThreshold;
			if (shouldCollapse || !isExpand && currentWidth > minWidth && currentWidth >= collapseThreshold) {
				dispatch({ type: "START_ANIMATION" });
				if (shouldCollapse) {
					setIsExpand(false);
					dispatch({
						payload: minWidth,
						type: "SET_WIDTH"
					});
				} else {
					setIsExpand(true);
					dispatch({
						payload: currentWidth,
						type: "SET_EXPANDED_WIDTH"
					});
					dispatch({
						payload: currentWidth,
						type: "SET_WIDTH"
					});
				}
				animationTimeoutRef.current = setTimeout(() => {
					dispatch({ type: "STOP_ANIMATION" });
				}, ANIMATION_DURATION);
			} else if (isExpand) {
				dispatch({
					payload: currentWidth,
					type: "SET_EXPANDED_WIDTH"
				});
				dispatch({
					payload: currentWidth,
					type: "SET_WIDTH"
				});
			}
		} else {
			dispatch({
				payload: currentWidth,
				type: "SET_EXPANDED_WIDTH"
			});
			dispatch({
				payload: currentWidth,
				type: "SET_WIDTH"
			});
		}
		onWidthChange?.(delta, currentWidth);
	}, [
		expandable,
		minWidth,
		collapseThreshold,
		isExpand,
		onWidthChange,
		setIsExpand
	]);
	const ArrowIcon = useMemo(() => {
		if (placement === "left") return ChevronLeft;
		return ChevronRight;
	}, [placement]);
	const handleRootStyle = useMemo(() => ({
		display: "flex",
		opacity: !isExpand && showHandleWhenCollapsed ? 1 : isHovering ? 1 : 0,
		transition: "opacity 0.25s ease"
	}), [
		isExpand,
		showHandleWhenCollapsed,
		isHovering
	]);
	const handleCenterStyle = useMemo(() => ({
		...customStyles?.handle,
		cursor: "pointer"
	}), [customStyles?.handle]);
	const handleIconWrapperStyle = useMemo(() => ({
		marginLeft: placement === "right" ? 4 : 0,
		marginRight: placement === "left" ? 4 : 0,
		transform: isExpand ? "rotate(0deg)" : "rotate(180deg)",
		transition: `transform ${COLLAPSE_ANIMATION_DELAY} ease`
	}), [placement, isExpand]);
	const handle = useMemo(() => showHandle && expandable && /* @__PURE__ */ jsx("div", {
		style: handleRootStyle,
		className: cx(styles.toggleRoot, placement === "left" ? styles.toggleLeft : styles.toggleRight),
		children: /* @__PURE__ */ jsx(Center, {
			className: classNames?.handle,
			style: handleCenterStyle,
			onClick: toggleExpand,
			children: /* @__PURE__ */ jsx("div", {
				style: handleIconWrapperStyle,
				children: /* @__PURE__ */ jsx(Icon, {
					className: styles.handlerIcon,
					icon: ArrowIcon,
					size: 16
				})
			})
		})
	}), [
		showHandle,
		expandable,
		styles.toggleRoot,
		styles.toggleLeft,
		styles.toggleRight,
		styles.handlerIcon,
		placement,
		handleRootStyle,
		classNames?.handle,
		toggleExpand,
		handleCenterStyle,
		handleIconWrapperStyle,
		ArrowIcon,
		cx
	]);
	const sizeConfig = useMemo(() => {
		return {
			maxWidth,
			minWidth,
			size: {
				height: "100%",
				width: state.internalWidth
			}
		};
	}, [
		state.internalWidth,
		minWidth,
		maxWidth
	]);
	const resizeEnable = useMemo(() => {
		if (!resizable) return RESIZE_DISABLED;
		return {
			bottom: false,
			bottomLeft: false,
			bottomRight: false,
			left: placement === "right",
			right: placement === "left",
			top: false,
			topLeft: false,
			topRight: false
		};
	}, [resizable, placement]);
	const handleClasses = useMemo(() => ({ [placement === "left" ? "right" : "left"]: cx(styles.resizeHandle, showHandleHighlight && styles.resizeHandleHighlight, placement === "left" ? styles.resizeHandleLeft : styles.resizeHandleRight) }), [
		placement,
		styles,
		showHandleHighlight,
		cx
	]);
	const containerStyle = useMemo(() => ({
		...customStyles?.container,
		...rest.style,
		transition: state.isResizing ? "none" : state.isAnimating ? `width ${ANIMATION_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)` : "none"
	}), [
		customStyles?.container,
		rest.style,
		state.isResizing,
		state.isAnimating
	]);
	const containerClassName = useMemo(() => cx(styles.container, classNames?.container, className), [
		cx,
		styles.container,
		classNames?.container,
		className
	]);
	const contentClassName = useMemo(() => cx(showBorder ? styles.contentContainer : styles.contentContainerNoBorder, styles.menuOverride, classNames?.content), [
		cx,
		styles.contentContainer,
		styles.contentContainerNoBorder,
		styles.menuOverride,
		classNames?.content,
		showBorder
	]);
	const headerClassName = useMemo(() => cx(styles.header, classNames?.header), [
		cx,
		styles.header,
		classNames?.header
	]);
	const bodyClassName = useMemo(() => cx(styles.body, classNames?.body), [
		cx,
		styles.body,
		classNames?.body
	]);
	const footerClassName = useMemo(() => cx(styles.footer, classNames?.footer), [
		cx,
		styles.footer,
		classNames?.footer
	]);
	useEffect(() => {
		return () => {
			if (animationTimeoutRef.current) clearTimeout(animationTimeoutRef.current);
			if (collapseTimeoutRef.current) clearTimeout(collapseTimeoutRef.current);
		};
	}, []);
	return /* @__PURE__ */ jsx("aside", {
		ref,
		children: /* @__PURE__ */ jsxs(Resizable, {
			...sizeConfig,
			className: containerClassName,
			enable: resizeEnable,
			handleClasses,
			style: containerStyle,
			onResize: handleResize,
			onResizeStart: handleResizeStart,
			onResizeStop: handleResizeStop,
			children: [handle, /* @__PURE__ */ jsxs(FlexBasic_default, {
				className: contentClassName,
				style: {
					...cssVariables,
					...customStyles?.content
				},
				children: [
					currentHeader && /* @__PURE__ */ jsx("div", {
						className: headerClassName,
						style: customStyles?.header,
						children: currentHeader
					}),
					/* @__PURE__ */ jsx("div", {
						className: bodyClassName,
						style: customStyles?.body,
						children: currentBody
					}),
					currentFooter && /* @__PURE__ */ jsx("div", {
						className: footerClassName,
						style: customStyles?.footer,
						children: currentFooter
					})
				]
			})]
		})
	});
});
DraggableSideNav.displayName = "DraggableSideNav";
//#endregion
export { DraggableSideNav as default };

//# sourceMappingURL=DraggableSideNav.mjs.map