"use client";
import Alert from "../../Alert/Alert.mjs";
import PreviewGroup from "../../Image/PreviewGroup.mjs";
import { styles } from "../../Markdown/style.mjs";
import Image from "../mdxComponents/Image.mjs";
import Video from "../mdxComponents/Video.mjs";
import { useMarkdownContent } from "../../hooks/useMarkdown/useMarkdownContent.mjs";
import Typography from "../../Markdown/Typography.mjs";
import mdxComponents from "../mdxComponents/index.mjs";
import CodeBlock from "../mdxComponents/CodeBlock.mjs";
import { memo, useEffect, useMemo, useState } from "react";
import jsxRuntime, { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { rehypeGithubAlerts } from "rehype-github-alerts";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { evaluate } from "@mdx-js/mdx";
import jsxDevRuntime from "react/jsx-dev-runtime";
//#region src/mdx/Mdx/index.tsx
const runtime = process.env.NODE_ENV === "production" ? jsxRuntime : jsxDevRuntime;
const Mdx = memo(({ children, className, style, fullFeaturedCodeBlock = true, enableImageGallery, enableLatex = true, enableMermaid = true, rehypePlugins, remarkPlugins, components = {}, fallback = null, fontSize, headerMultiple, lineHeight, marginMultiple, variant, ...rest }) => {
	const escapedContent = useMarkdownContent(children);
	const isChatMode = variant === "chat";
	const [MDXContent, setMDXContent] = useState(() => () => null);
	const innerRehypePlugins = Array.isArray(rehypePlugins) ? rehypePlugins : [rehypePlugins];
	const memoRehypePlugins = useMemo(() => [
		rehypeGithubAlerts,
		enableLatex && rehypeKatex,
		...innerRehypePlugins
	].filter(Boolean), [enableLatex, ...innerRehypePlugins]);
	const innerRemarkPlugins = Array.isArray(remarkPlugins) ? remarkPlugins : [remarkPlugins];
	const memoRemarkPlugins = useMemo(() => [
		remarkGfm,
		enableLatex && remarkMath,
		...innerRemarkPlugins
	].filter(Boolean), [enableLatex, ...innerRemarkPlugins]);
	const memoComponents = useMemo(() => {
		const list = {};
		Object.entries({
			...mdxComponents,
			img: Image,
			pre: (props) => /* @__PURE__ */ jsx(CodeBlock, {
				...props,
				enableMermaid,
				fullFeatured: fullFeaturedCodeBlock
			}),
			video: Video,
			...components
		}).forEach(([key, Render]) => {
			list[key] = (props) => /* @__PURE__ */ jsx(Render, { ...props });
		});
		return list;
	}, [
		components,
		enableMermaid,
		fullFeaturedCodeBlock
	]);
	useEffect(() => {
		if (!escapedContent) return;
		(async () => {
			try {
				const { default: Content } = await evaluate(escapedContent, {
					...runtime,
					development: process.env.NODE_ENV !== "production",
					rehypePlugins: memoRehypePlugins,
					remarkPlugins: memoRemarkPlugins
				});
				setMDXContent(() => Content);
			} catch (error) {
				setMDXContent(() => () => /* @__PURE__ */ jsx(Alert, {
					description: String(error?.message),
					title: "Error compiling MDX",
					type: "error",
					style: { width: "100%" }
				}));
				console.error("Error compiling MDX:", error);
			}
		})();
	}, [
		escapedContent,
		memoRehypePlugins,
		memoRemarkPlugins
	]);
	if (!escapedContent || !MDXContent) return fallback;
	return /* @__PURE__ */ jsx(Typography, {
		className: cx(enableLatex && styles.latex, isChatMode && styles.chat, className),
		"data-code-type": "mdx",
		fontSize,
		headerMultiple,
		lineHeight,
		marginMultiple,
		style,
		...rest,
		children: /* @__PURE__ */ jsx(PreviewGroup, {
			enable: enableImageGallery,
			children: /* @__PURE__ */ jsx(MDXContent, { components: memoComponents })
		})
	});
});
Mdx.displayName = "Mdx";
//#endregion
export { Mdx as default };

//# sourceMappingURL=index.mjs.map