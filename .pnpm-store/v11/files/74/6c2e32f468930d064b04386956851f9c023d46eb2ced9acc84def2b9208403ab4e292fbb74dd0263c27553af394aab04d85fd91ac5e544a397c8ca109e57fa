import { styles } from "../style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx } from "antd-style";
//#region src/FileTypeIcon/components/FolderIcon.tsx
const FolderIcon = ({ size, isMono, hasIcon, iconColor, filetype, className, fontSize, style, ...rest }) => {
	return /* @__PURE__ */ jsxs("svg", {
		className: cx(styles.icon, !hasIcon && className),
		height: size,
		style: hasIcon ? void 0 : style,
		viewBox: "0 0 24 24",
		width: size,
		xmlns: "http://www.w3.org/2000/svg",
		...rest,
		children: [/* @__PURE__ */ jsx("path", {
			d: "M10.46 5.076l-.92-.752A1.446 1.446 0 008.626 4H3.429c-.38 0-.743.147-1.01.41A1.386 1.386 0 002 5.4v13.2c0 .371.15.727.418.99.268.262.632.41 1.01.41h17.143c.38 0 .743-.148 1.01-.41.268-.263.419-.619.419-.99V6.8c0-.371-.15-.727-.418-.99a1.444 1.444 0 00-1.01-.41h-9.198c-.334 0-.657-.115-.914-.324z",
			fill: iconColor,
			stroke: cssVar.colorFillSecondary,
			strokeWidth: .5
		}), !hasIcon && filetype && /* @__PURE__ */ jsx("text", {
			fill: isMono ? cssVar.colorTextSecondary : "#fff",
			fontSize,
			fontWeight: "bold",
			textAnchor: "middle",
			x: "50%",
			y: "70%",
			children: filetype.toUpperCase()
		})]
	});
};
//#endregion
export { FolderIcon as default };

//# sourceMappingURL=FolderIcon.mjs.map