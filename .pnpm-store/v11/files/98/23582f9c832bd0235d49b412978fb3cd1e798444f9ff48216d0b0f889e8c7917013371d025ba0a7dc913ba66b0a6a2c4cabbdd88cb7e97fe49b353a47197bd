"use client";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "antd-style";
import { Md5 } from "ts-md5";
//#region src/hooks/useMermaid.ts
const MD5_LENGTH_THRESHOLD = 1e4;
const mermaidCache = /* @__PURE__ */ new Map();
const MAX_CACHE_SIZE = 500;
const cleanupCache = () => {
	if (mermaidCache.size > MAX_CACHE_SIZE) {
		const entriesToRemove = Math.floor(MAX_CACHE_SIZE * .2);
		const keysToRemove = Array.from(mermaidCache.keys()).slice(0, entriesToRemove);
		for (const key of keysToRemove) mermaidCache.delete(key);
	}
};
let mermaidPromise = null;
const loadMermaid = () => {
	if (typeof window === "undefined") return Promise.resolve(null);
	if (!mermaidPromise) mermaidPromise = import("mermaid").then((mod) => mod.default);
	return mermaidPromise;
};
const createMermaidConfig = (theme, customTheme, securityLevel = "strict") => ({
	fontFamily: theme.fontFamilyCode,
	gantt: { useWidth: 1920 },
	securityLevel,
	startOnLoad: false,
	theme: customTheme || (theme.isDarkMode ? "dark" : "neutral"),
	themeVariables: customTheme ? void 0 : {
		errorBkgColor: theme.colorTextDescription,
		errorTextColor: theme.colorTextDescription,
		fontFamily: theme.fontFamily,
		lineColor: theme.colorTextSecondary,
		mainBkg: theme.colorBgContainer,
		noteBkgColor: theme.colorInfoBg,
		noteTextColor: theme.colorInfoText,
		pie1: theme.geekblue,
		pie2: theme.colorWarning,
		pie3: theme.colorSuccess,
		pie4: theme.colorError,
		primaryBorderColor: theme.colorBorder,
		primaryColor: theme.colorBgContainer,
		primaryTextColor: theme.colorText,
		secondaryBorderColor: theme.colorInfoBorder,
		secondaryColor: theme.colorInfoBg,
		secondaryTextColor: theme.colorInfoText,
		tertiaryBorderColor: theme.colorSuccessBorder,
		tertiaryColor: theme.colorSuccessBg,
		tertiaryTextColor: theme.colorSuccessText,
		textColor: theme.colorText
	}
});
/**
* 验证并处理 Mermaid 图表内容 - 优化版本（移除 SWR）
*/
const useMermaid = (content, { id, theme: customTheme, securityLevel }) => {
	const theme = useTheme();
	const [data, setData] = useState("");
	const mermaidConfig = useMemo(() => createMermaidConfig(theme, customTheme, securityLevel), [
		theme.fontFamilyCode,
		theme.isDarkMode,
		theme.colorTextDescription,
		theme.fontFamily,
		theme.colorTextSecondary,
		theme.colorBgContainer,
		theme.colorInfoBg,
		theme.colorInfoText,
		theme.geekblue,
		theme.colorWarning,
		theme.colorSuccess,
		theme.colorError,
		theme.colorBorder,
		theme.colorInfoBorder,
		theme.colorSuccessBorder,
		theme.colorSuccessBg,
		theme.colorSuccessText,
		theme.colorText,
		customTheme,
		securityLevel
	]);
	const cacheKey = useMemo(() => {
		const hash = content.length < 1e4 ? content : Md5.hashStr(content);
		return [
			id,
			customTheme || (theme.isDarkMode ? "d" : "l"),
			hash
		].filter(Boolean).join("-");
	}, [
		content,
		id,
		theme.isDarkMode,
		customTheme
	]);
	useEffect(() => {
		const cachedPromise = mermaidCache.get(cacheKey);
		if (cachedPromise) {
			cachedPromise.then((svg) => {
				setData(svg);
			}).catch(() => {});
			return;
		}
		const renderPromise = (async () => {
			try {
				const mermaidInstance = await loadMermaid();
				if (!mermaidInstance) return "";
				if (await mermaidInstance.parse(content)) {
					mermaidInstance.initialize(mermaidConfig);
					const { svg } = await mermaidInstance.render(id, content);
					return svg;
				} else throw new Error("Mermaid 语法无效");
			} catch (error_) {
				console.error("Mermaid 解析错误:", error_);
				return "";
			}
		})();
		mermaidCache.set(cacheKey, renderPromise);
		cleanupCache();
		renderPromise.then((svg) => {
			if (mermaidCache.get(cacheKey) === renderPromise) setData(svg);
		}).catch(() => {
			if (mermaidCache.get(cacheKey) === renderPromise) mermaidCache.delete(cacheKey);
		});
	}, [
		cacheKey,
		content,
		id,
		mermaidConfig
	]);
	return data;
};
//#endregion
export { MD5_LENGTH_THRESHOLD, createMermaidConfig, loadMermaid, useMermaid };

//# sourceMappingURL=useMermaid.mjs.map