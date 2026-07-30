"use client";
import { useCdnFn } from "../../ConfigProvider/index.mjs";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Img from "../../Img/index.mjs";
import Spline from "../../awesome/Spline/Spine.mjs";
import { memo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/brand/LogoThree/index.tsx
const LOGO_3D = {
	path: "assets/logo-3d.webp",
	pkg: "@lobehub/assets-logo",
	version: "1.2.0"
};
const LogoThree = memo(({ className, style, size = 128, onLoad, ...rest }) => {
	const genCdnUrl = useCdnFn();
	const [loading, setLoading] = useState(true);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "center",
		className,
		flex: "none",
		justify: "center",
		style: {
			height: size,
			overflow: "hidden",
			position: "relative",
			width: size,
			...style
		},
		children: [loading && /* @__PURE__ */ jsx(Img, {
			alt: "logo",
			height: size * .75,
			src: genCdnUrl(LOGO_3D),
			style: { position: "absolute" },
			width: size * .75
		}), /* @__PURE__ */ jsx(Spline, {
			scene: "https://hub-apac-1.lobeobjects.space/logo.splinecode",
			style: {
				flex: "none",
				height: size,
				width: size
			},
			onLoad: (splineApp) => {
				setLoading(false);
				onLoad?.(splineApp);
			},
			...rest
		})]
	});
});
LogoThree.displayName = "LobeHubLogoThree";
//#endregion
export { LogoThree as default };

//# sourceMappingURL=index.mjs.map