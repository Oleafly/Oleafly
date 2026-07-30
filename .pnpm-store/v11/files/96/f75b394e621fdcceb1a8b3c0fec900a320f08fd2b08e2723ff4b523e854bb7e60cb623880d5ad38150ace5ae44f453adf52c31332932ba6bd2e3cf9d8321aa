import { styles } from "../style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx } from "antd-style";
//#region src/FileTypeIcon/components/FileIcon.tsx
const FileIcon = ({ size, isMono, hasIcon, iconColor, filetypeShort, className, fontSize, style, ...rest }) => {
	return /* @__PURE__ */ jsxs("svg", {
		className: cx(styles.icon, !hasIcon && className),
		height: size,
		style: hasIcon ? void 0 : style,
		viewBox: "0 0 24 24",
		width: size,
		xmlns: "http://www.w3.org/2000/svg",
		...rest,
		children: [
			/* @__PURE__ */ jsx("path", {
				d: "M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6z",
				fill: iconColor
			}),
			/* @__PURE__ */ jsx("path", {
				d: "M14 2l6 6h-4a2 2 0 01-2-2V2z",
				fill: isMono ? cssVar.colorFill : "#fff",
				fillOpacity: ".5"
			}),
			filetypeShort && /* @__PURE__ */ jsx("text", {
				fill: isMono ? cssVar.colorTextSecondary : "#fff",
				fontSize,
				fontWeight: "bold",
				textAnchor: "middle",
				x: "50%",
				y: "70%",
				children: filetypeShort.toUpperCase()
			}),
			/* @__PURE__ */ jsx("path", {
				d: "M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6z",
				fill: "transparent",
				stroke: cssVar.colorFillSecondary,
				strokeWidth: .5
			})
		]
	});
};
//#endregion
export { FileIcon as default };

//# sourceMappingURL=FileIcon.mjs.map