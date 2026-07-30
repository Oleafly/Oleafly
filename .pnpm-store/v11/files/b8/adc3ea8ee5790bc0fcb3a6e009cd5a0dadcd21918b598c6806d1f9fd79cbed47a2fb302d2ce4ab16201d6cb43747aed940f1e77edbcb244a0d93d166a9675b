"use client";
import { ScrollAreaContent, ScrollAreaCorner, ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from "./atoms.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/base-ui/ScrollArea/ScrollArea.tsx
const ScrollArea = ({ children, contentProps, corner = false, cornerProps, disableContentFit = false, scrollFade = false, scrollbarProps, thumbProps, viewportProps, ...rest }) => {
	const mergedContentProps = disableContentFit ? {
		...contentProps,
		style: {
			minWidth: 0,
			...contentProps?.style
		}
	} : contentProps;
	return /* @__PURE__ */ jsxs(ScrollAreaRoot, {
		...rest,
		children: [
			/* @__PURE__ */ jsx(ScrollAreaViewport, {
				scrollFade,
				...viewportProps,
				children: /* @__PURE__ */ jsx(ScrollAreaContent, {
					...mergedContentProps,
					children
				})
			}),
			/* @__PURE__ */ jsx(ScrollAreaScrollbar, {
				...scrollbarProps,
				children: /* @__PURE__ */ jsx(ScrollAreaThumb, { ...thumbProps })
			}),
			corner && /* @__PURE__ */ jsx(ScrollAreaCorner, { ...cornerProps })
		]
	});
};
//#endregion
export { ScrollArea };

//# sourceMappingURL=ScrollArea.mjs.map