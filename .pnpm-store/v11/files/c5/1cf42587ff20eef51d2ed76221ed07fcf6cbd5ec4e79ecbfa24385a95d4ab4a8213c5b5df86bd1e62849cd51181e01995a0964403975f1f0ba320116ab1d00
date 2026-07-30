"use client";
import PreviewGroup from "../Image/PreviewGroup.mjs";
import { useStableValue } from "../hooks/useStableValue.mjs";
import { MarkdownProvider } from "./components/MarkdownProvider.mjs";
import { useDelayedAnimated } from "./components/useDelayedAnimated.mjs";
import { variants } from "./style.mjs";
import MarkdownRenderer from "./SyntaxMarkdown/MarkdownRender.mjs";
import { StreamdownRender } from "./SyntaxMarkdown/StreamdownRender.mjs";
import Typography from "./Typography.mjs";
import { memo, useCallback } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Markdown/Markdown.tsx
const Markdown = memo((props) => {
	const { ref, children = "", className, style, fullFeaturedCodeBlock, onDoubleClick, animated, enableHtmlPreview = false, enableLatex = true, enableMermaid = true, enableImageGallery, enableCustomFootnotes, enableGithubAlert, enableStream = true, componentProps, rehypePluginsAhead, allowHtml, borderRadius, fontSize = props.variant === "chat" ? 14 : void 0, headerMultiple = props.variant === "chat" ? .25 : void 0, marginMultiple = props.variant === "chat" ? 1 : void 0, variant = "default", reactMarkdownProps, lineHeight = props.variant === "chat" ? 1.6 : void 0, rehypePlugins, remarkPlugins, remarkPluginsAhead, components = {}, customRender, showFootnotes = true, streamAnimationGranularity, streamSmoothingPreset, citations, ...rest } = props;
	const delayedAnimated = useDelayedAnimated(animated);
	const stableComponentProps = useStableValue(componentProps);
	const stableComponents = useStableValue(components);
	const Render = useCallback(({ enableStream, children, reactMarkdownProps }) => {
		const defaultDOM = /* @__PURE__ */ jsx(enableStream ? StreamdownRender : MarkdownRenderer, {
			...reactMarkdownProps,
			children
		});
		return customRender ? customRender(defaultDOM, { text: children }) : defaultDOM;
	}, [customRender]);
	return /* @__PURE__ */ jsx(PreviewGroup, {
		enable: enableImageGallery,
		children: /* @__PURE__ */ jsx(Typography, {
			borderRadius,
			className: cx(variants({
				enableLatex,
				variant
			}), className),
			"data-code-type": "markdown",
			fontSize,
			headerMultiple,
			lineHeight,
			marginMultiple,
			ref,
			style,
			onDoubleClick,
			...rest,
			children: /* @__PURE__ */ jsx(MarkdownProvider, {
				allowHtml,
				animated: delayedAnimated,
				citations,
				componentProps: stableComponentProps,
				components: stableComponents,
				enableCustomFootnotes,
				enableGithubAlert,
				enableHtmlPreview,
				enableLatex,
				enableMermaid,
				fullFeaturedCodeBlock,
				rehypePlugins,
				rehypePluginsAhead,
				remarkPlugins,
				remarkPluginsAhead,
				showFootnotes,
				streamAnimationGranularity,
				streamSmoothingPreset,
				variant,
				children: /* @__PURE__ */ jsx(Render, {
					enableStream: enableStream && delayedAnimated,
					reactMarkdownProps,
					children
				})
			})
		})
	});
});
Markdown.displayName = "Markdown";
//#endregion
export { Markdown as default };

//# sourceMappingURL=Markdown.mjs.map