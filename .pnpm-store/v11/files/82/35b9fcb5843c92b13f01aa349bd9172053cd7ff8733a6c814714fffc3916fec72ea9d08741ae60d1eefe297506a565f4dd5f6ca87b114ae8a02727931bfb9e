"use client";
import { createMermaidConfig, loadMermaid } from "./useMermaid.mjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "antd-style";
//#region src/hooks/useStreamMermaid.ts
/**
* 流式 Mermaid 渲染 - 支持内容逐步更新
*/
const useStreamMermaid = (content, { enabled = true, id, theme: customTheme }) => {
	const theme = useTheme();
	const [data, setData] = useState("");
	const previousContentRef = useRef("");
	const latestContentRef = useRef(content);
	const renderTimeoutRef = useRef(void 0);
	const mermaidConfig = useMemo(() => createMermaidConfig(theme, customTheme), [
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
		customTheme
	]);
	useEffect(() => {
		latestContentRef.current = content;
	}, [content]);
	useEffect(() => {
		if (!enabled) {
			setData("");
			previousContentRef.current = "";
			const timeoutId = renderTimeoutRef.current;
			if (timeoutId) clearTimeout(timeoutId);
			return;
		}
		const currentContent = latestContentRef.current;
		if (currentContent === previousContentRef.current && data) return;
		const timeoutId = renderTimeoutRef.current;
		if (timeoutId) clearTimeout(timeoutId);
		renderTimeoutRef.current = setTimeout(async () => {
			const contentToRender = latestContentRef.current;
			if (contentToRender !== currentContent) return;
			try {
				const mermaidInstance = await loadMermaid();
				if (!mermaidInstance) return;
				if (await mermaidInstance.parse(contentToRender)) {
					mermaidInstance.initialize(mermaidConfig);
					const { svg } = await mermaidInstance.render(id, contentToRender);
					if (latestContentRef.current === contentToRender) {
						setData(svg);
						previousContentRef.current = contentToRender;
					}
				}
			} catch (error_) {
				if (contentToRender === latestContentRef.current) console.error("Mermaid 解析错误:", error_);
			}
		}, 300);
		return () => {
			const timeoutId = renderTimeoutRef.current;
			if (timeoutId) clearTimeout(timeoutId);
		};
	}, [
		enabled,
		content,
		id,
		mermaidConfig,
		data
	]);
	return data;
};
//#endregion
export { useStreamMermaid };

//# sourceMappingURL=useStreamMermaid.mjs.map