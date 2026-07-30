"use client";
import { useCdnFn } from "../ConfigProvider/index.mjs";
import { generateCustomStylish } from "../styles/theme/customStylish.mjs";
import { generateCustomToken } from "../styles/theme/customToken.mjs";
import AppElementContext from "./AppElementContext.mjs";
import { LOBE_THEME_APP_ID } from "./constants.mjs";
import FontLoader from "../FontLoader/index.mjs";
import { createLobeAntdTheme } from "../styles/theme/antdTheme.mjs";
import ConfigProvider$1 from "./ConfigProvider.mjs";
import GlobalStyle, { EssentialStyle } from "./GlobalStyle/index.mjs";
import { memo, useCallback, useMemo, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { App } from "antd";
import { ThemeProvider } from "antd-style";
import { merge } from "es-toolkit/compat";
//#region src/ThemeProvider/ThemeProvider.tsx
const ThemeProvider$1 = memo(({ appId = LOBE_THEME_APP_ID, children, customStylish, customToken, enableCustomFonts = true, enableGlobalStyle = true, customFonts, customTheme = {}, className, style, theme: antdTheme, ...rest }) => {
	const genCdnUrl = useCdnFn();
	const [appRef, setAppRef] = useState(null);
	const webfontUrls = useMemo(() => customFonts || [
		genCdnUrl({
			path: "css/index.css",
			pkg: "@lobehub/webfont-geist-mono",
			version: "1.0.0"
		}),
		genCdnUrl({
			path: "css/index-full.css",
			pkg: "@lobehub/webfont-geist",
			version: "1.0.0"
		}),
		genCdnUrl({
			path: "css/index.css",
			pkg: "@lobehub/webfont-harmony-sans-sc",
			version: "1.0.0"
		}),
		genCdnUrl({
			path: "dist/katex.min.css",
			pkg: "katex",
			version: "0.17.0"
		})
	], [customFonts, genCdnUrl]);
	const stylish = useCallback((theme) => ({
		...generateCustomStylish(theme),
		...customStylish?.(theme)
	}), [customStylish]);
	const token = useCallback((theme) => ({
		...generateCustomToken(theme),
		...customToken?.(theme)
	}), [customToken]);
	const theme = useCallback((appearance) => {
		return merge(createLobeAntdTheme({
			appearance,
			neutralColor: customTheme.neutralColor,
			primaryColor: customTheme.primaryColor
		}), antdTheme);
	}, [
		customTheme.primaryColor,
		customTheme.neutralColor,
		antdTheme
	]);
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [enableCustomFonts && webfontUrls?.length > 0 && webfontUrls.map((webfont) => /* @__PURE__ */ jsx(FontLoader, { url: webfont }, webfont)), /* @__PURE__ */ jsx(ThemeProvider, {
		customStylish: stylish,
		customToken: token,
		theme,
		...rest,
		children: /* @__PURE__ */ jsxs(ConfigProvider$1, { children: [
			/* @__PURE__ */ jsx(EssentialStyle, {}),
			enableGlobalStyle && /* @__PURE__ */ jsx(GlobalStyle, {}),
			/* @__PURE__ */ jsx(App, {
				className,
				style: {
					isolation: "isolate",
					minHeight: "inherit",
					width: "inherit",
					...style
				},
				children: /* @__PURE__ */ jsx("div", {
					id: appId,
					style: contentsStyle,
					children: /* @__PURE__ */ jsxs(AppElementContext, {
						value: appRef,
						children: [children, /* @__PURE__ */ jsx("div", {
							"data-lobe-portal-host": "",
							ref: setAppRef,
							style: hostPortalHostStyle
						})]
					})
				})
			})
		] })
	})] });
});
ThemeProvider$1.displayName = "LobeThemeProvider";
const hostPortalHostStyle = {
	height: 0,
	left: 0,
	position: "fixed",
	right: 0,
	top: 0,
	zIndex: 1100
};
const contentsStyle = { display: "contents" };
//#endregion
export { ThemeProvider$1 as default };

//# sourceMappingURL=ThemeProvider.mjs.map