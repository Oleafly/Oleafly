import Spline from "../../awesome/Spline/Spine.mjs";
import Loading from "./Loading.mjs";
import { memo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { useThemeMode } from "antd-style";
//#region src/brand/LogoThree/LogoSpline.tsx
const LIGHT = "https://hub-apac-1.lobeobjects.space/light.splinecode";
const DARK = "https://hub-apac-1.lobeobjects.space/dark.splinecode";
const LogoSpline = memo(({ className, style, width, height, onLoad, ...rest }) => {
	const { isDarkMode } = useThemeMode();
	const [loading, setLoading] = useState(true);
	return /* @__PURE__ */ jsxs("div", {
		className,
		style: {
			height,
			position: "relative",
			width,
			...style
		},
		children: [loading && /* @__PURE__ */ jsx(Loading, {}), /* @__PURE__ */ jsx(Spline, {
			scene: isDarkMode ? DARK : LIGHT,
			onLoad: (splineApp) => {
				setLoading(false);
				onLoad?.(splineApp);
			},
			...rest
		})]
	});
});
//#endregion
export { LogoSpline as default };

//# sourceMappingURL=LogoSpline.mjs.map