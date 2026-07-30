"use client";
import Hotkey from "../../Hotkey/Hotkey.mjs";
import { useMarkdownContext } from "../../Markdown/components/MarkdownProvider.mjs";
import { CodeBlock } from "../../Markdown/components/CodeBlock.mjs";
import MarkdownTable from "../../Markdown/components/MarkdownTable/index.mjs";
import Image from "../../mdx/mdxComponents/Image.mjs";
import Link from "../../mdx/mdxComponents/Link.mjs";
import Section from "../../mdx/mdxComponents/Section.mjs";
import Video from "../../mdx/mdxComponents/Video.mjs";
import { useCallback, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/hooks/useMarkdown/useMarkdownComponents.tsx
const useMarkdownComponents = () => {
	const { components, animated, citations, componentProps, enableHtmlPreview, enableMermaid, fullFeaturedCodeBlock, showFootnotes } = useMarkdownContext();
	const memoA = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx(Link, {
		citations,
		...props,
		...componentProps?.a
	}), [citations, componentProps?.a]);
	const memoImg = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx(Image, {
		...props,
		...componentProps?.img
	}), [componentProps?.img]);
	const memoVideo = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx(Video, {
		...props,
		...componentProps?.video
	}), [componentProps?.video]);
	const memoSection = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx(Section, {
		showFootnotes,
		...props
	}), [showFootnotes]);
	const memoKbd = useCallback(({ children }) => /* @__PURE__ */ jsx(Hotkey, {
		keys: children,
		style: { display: "inline-flex" }
	}), []);
	const memoBr = useCallback(() => /* @__PURE__ */ jsx("br", {}), []);
	const memeP = useCallback(({ style, children, className }) => {
		if (typeof children === "object" && ["img", "video"].includes(children?.props?.node?.tagName)) return children;
		return /* @__PURE__ */ jsx("p", {
			className,
			style,
			children
		});
	}, []);
	const highlightTheme = useMemo(() => componentProps?.highlight?.theme, [JSON.stringify(componentProps?.highlight?.theme)]);
	const mermaidTheme = useMemo(() => componentProps?.mermaid?.theme, [JSON.stringify(componentProps?.mermaid?.theme)]);
	const stableComponentProps = useMemo(() => {
		if (!componentProps) return;
		return {
			highlight: componentProps.highlight ? {
				...componentProps.highlight,
				theme: highlightTheme
			} : void 0,
			html: componentProps.html,
			mermaid: componentProps.mermaid ? {
				...componentProps.mermaid,
				theme: mermaidTheme
			} : void 0
		};
	}, [
		highlightTheme,
		mermaidTheme,
		componentProps?.html
	]);
	const memoPre = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx(CodeBlock, {
		animated,
		enableHtmlPreview,
		enableMermaid,
		fullFeatured: fullFeaturedCodeBlock,
		...stableComponentProps,
		...componentProps?.pre,
		...props
	}), [
		animated,
		enableHtmlPreview,
		enableMermaid,
		fullFeaturedCodeBlock,
		stableComponentProps,
		componentProps?.pre
	]);
	const memoColorPreview = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx("code", { ...props }), []);
	const memoTable = useCallback(({ node, ...props }) => /* @__PURE__ */ jsx(MarkdownTable, {
		node,
		...props
	}), []);
	const memoComponents = useMemo(() => ({
		a: memoA,
		br: memoBr,
		colorPreview: memoColorPreview,
		img: memoImg,
		kbd: memoKbd,
		p: memeP,
		pre: memoPre,
		section: memoSection,
		table: memoTable,
		video: memoVideo
	}), [
		memoA,
		memoBr,
		memoImg,
		memoVideo,
		memoPre,
		memoSection,
		memeP,
		memoColorPreview,
		memoKbd,
		memoTable
	]);
	return useMemo(() => ({
		...memoComponents,
		...components
	}), [memoComponents, components]);
};
//#endregion
export { useMarkdownComponents };

//# sourceMappingURL=useMarkdownComponents.mjs.map