"use client";
import ScrollAreaGlobalStyle from "./globalStyle.mjs";
import { styles } from "./style.mjs";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ScrollArea } from "@base-ui/react/scroll-area";
//#region src/base-ui/ScrollArea/atoms.tsx
const mergeStateClassName = (base, className) => {
	if (typeof className === "function") return (state) => cx(base, className(state));
	return cx(base, className);
};
const ScrollAreaRoot = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(ScrollArea.Root, {
		...rest,
		className: mergeStateClassName(styles.root, className)
	});
};
ScrollAreaRoot.displayName = "ScrollAreaRoot";
const resolveFadeClass = (scrollFade) => {
	if (!scrollFade) return void 0;
	const orientation = scrollFade === true ? "vertical" : scrollFade;
	if (orientation === "horizontal") return styles.viewportFadeHorizontal;
	if (orientation === "both") return styles.viewportFadeBoth;
	return styles.viewportFade;
};
const ScrollAreaViewport = ({ className, scrollFade = false, ...rest }) => {
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(ScrollAreaGlobalStyle, {}), /* @__PURE__ */ jsx(ScrollArea.Viewport, {
		...rest,
		className: mergeStateClassName(cx(styles.viewport, resolveFadeClass(scrollFade)), className)
	})] });
};
ScrollAreaViewport.displayName = "ScrollAreaViewport";
const ScrollAreaContent = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(ScrollArea.Content, {
		...rest,
		className: mergeStateClassName(styles.content, className)
	});
};
ScrollAreaContent.displayName = "ScrollAreaContent";
const ScrollAreaScrollbar = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(ScrollArea.Scrollbar, {
		...rest,
		className: mergeStateClassName(styles.scrollbar, className)
	});
};
ScrollAreaScrollbar.displayName = "ScrollAreaScrollbar";
const ScrollAreaThumb = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(ScrollArea.Thumb, {
		...rest,
		className: mergeStateClassName(styles.thumb, className)
	});
};
ScrollAreaThumb.displayName = "ScrollAreaThumb";
const ScrollAreaCorner = ({ className, ...rest }) => {
	return /* @__PURE__ */ jsx(ScrollArea.Corner, {
		...rest,
		className: mergeStateClassName(styles.corner, className)
	});
};
ScrollAreaCorner.displayName = "ScrollAreaCorner";
//#endregion
export { ScrollAreaContent, ScrollAreaCorner, ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport };

//# sourceMappingURL=atoms.mjs.map