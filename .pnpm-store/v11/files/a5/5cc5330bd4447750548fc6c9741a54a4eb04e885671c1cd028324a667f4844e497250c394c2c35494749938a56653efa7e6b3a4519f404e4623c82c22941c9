"use client";
import { useCdnFn } from "../../ConfigProvider/index.mjs";
import Img from "../../Img/index.mjs";
import { LOGO_3D } from "../LobeHub/style.mjs";
import { jsx } from "react/jsx-runtime";
//#region src/brand/Logo3d/index.tsx
const Logo3d = ({ size = "1em", style, alt = "LobeHub", ...rest }) => {
	return /* @__PURE__ */ jsx(Img, {
		alt,
		height: size,
		src: useCdnFn()(LOGO_3D),
		style,
		width: size,
		...rest
	});
};
Logo3d.displayName = "LobeHubLogo3d";
//#endregion
export { Logo3d as default };

//# sourceMappingURL=index.mjs.map