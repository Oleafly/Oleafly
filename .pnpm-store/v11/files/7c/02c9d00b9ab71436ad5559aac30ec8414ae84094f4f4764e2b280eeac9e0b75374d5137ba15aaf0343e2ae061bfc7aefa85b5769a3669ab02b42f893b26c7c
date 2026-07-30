import { styles } from "./style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/base-ui/FloatingSheet/FloatingSheetHeader.tsx
function FloatingSheetHeader({ title, headerActions, isDragging, handleProps }) {
	const s = styles;
	return /* @__PURE__ */ jsxs("div", {
		className: cx(s.header, isDragging && s.headerDragging),
		...handleProps,
		children: [/* @__PURE__ */ jsx("div", { className: s.handle }), /* @__PURE__ */ jsxs("div", {
			className: s.headerContent,
			children: [title && /* @__PURE__ */ jsx("div", {
				className: s.headerTitle,
				children: title
			}), headerActions && /* @__PURE__ */ jsx("div", {
				className: s.headerActions,
				"data-no-drag": "",
				children: headerActions
			})]
		})]
	});
}
//#endregion
export { FloatingSheetHeader };

//# sourceMappingURL=FloatingSheetHeader.mjs.map