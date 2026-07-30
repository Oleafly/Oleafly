"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { useEventCallback } from "../hooks/useEventCallback.mjs";
import { variants } from "./style.mjs";
import { useScrollOverflow } from "./useScrollOverflow.mjs";
import { useMemo, useRef } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { mergeRefs } from "react-merge-refs";
//#region src/ScrollShadow/ScrollShadow.tsx
const ScrollShadow = ({ className, children, orientation = "vertical", hideScrollBar = false, size = 16, offset = 8, visibility = "auto", isEnabled = true, onVisibilityChange, style, ref, ...rest }) => {
	const cssVariables = useMemo(() => ({ "--scroll-shadow-size": `${size}%` }), [size]);
	const domRef = useRef(null);
	const onVisibilityChangeEvent = useEventCallback((visibility) => {
		onVisibilityChange?.(visibility);
	});
	const scrollState = useScrollOverflow({
		domRef,
		isEnabled: isEnabled && visibility === "auto",
		offset,
		onVisibilityChange: onVisibilityChangeEvent,
		orientation,
		updateDeps: [children]
	});
	const finalScrollState = useMemo(() => {
		if (visibility === "always") return {
			bottom: true,
			left: true,
			right: true,
			top: true
		};
		if (visibility === "never") return {
			bottom: false,
			left: false,
			right: false,
			top: false
		};
		return scrollState;
	}, [visibility, scrollState]);
	const dataAttributes = useMemo(() => {
		const attributes = { "data-orientation": orientation };
		if (orientation === "vertical") {
			if (finalScrollState.top && finalScrollState.bottom) attributes["data-top-bottom-scroll"] = true;
			else if (finalScrollState.top) attributes["data-top-scroll"] = true;
			else if (finalScrollState.bottom) attributes["data-bottom-scroll"] = true;
		} else if (finalScrollState.left && finalScrollState.right) attributes["data-left-right-scroll"] = true;
		else if (finalScrollState.left) attributes["data-left-scroll"] = true;
		else if (finalScrollState.right) attributes["data-right-scroll"] = true;
		return attributes;
	}, [orientation, finalScrollState]);
	return /* @__PURE__ */ jsx(FlexBasic_default, {
		className: cx(variants({
			hideScrollBar,
			orientation,
			scrollPosition: useMemo(() => {
				if (orientation === "vertical") {
					if (finalScrollState.top && finalScrollState.bottom) return "top-bottom";
					if (finalScrollState.top) return "top";
					if (finalScrollState.bottom) return "bottom";
				} else {
					if (finalScrollState.left && finalScrollState.right) return "left-right";
					if (finalScrollState.left) return "left";
					if (finalScrollState.right) return "right";
				}
				return "none";
			}, [orientation, finalScrollState])
		}), className),
		ref: mergeRefs([domRef, ref]),
		style: {
			...cssVariables,
			...style
		},
		...dataAttributes,
		...rest,
		children
	});
};
ScrollShadow.displayName = "ScrollShadow";
//#endregion
export { ScrollShadow as default };

//# sourceMappingURL=ScrollShadow.mjs.map