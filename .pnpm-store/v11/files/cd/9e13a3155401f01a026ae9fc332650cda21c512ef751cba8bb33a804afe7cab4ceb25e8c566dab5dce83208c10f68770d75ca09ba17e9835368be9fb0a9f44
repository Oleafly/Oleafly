"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { stopPropagation } from "../utils/dom.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import SyntaxHighlighter from "../Highlighter/SyntaxHighlighter/index.mjs";
import CopyButton from "../CopyButton/CopyButton.mjs";
import { downloadBlob } from "../utils/downloadBlob.mjs";
import { actionsHoverCls, variants } from "../Highlighter/style.mjs";
import { containsScript, isFullHtmlDocument, isHtmlContentClosed } from "./const.mjs";
import NeuralNetworkLoading from "../NeuralNetworkLoading/NeuralNetworkLoading.mjs";
import Segmented from "../Segmented/Segmented.mjs";
import { HtmlPreviewIframe } from "./Iframe.mjs";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { createStyles, cx, keyframes } from "antd-style";
import { Download, Expand } from "lucide-react";
//#region src/HtmlPreview/HtmlPreview.tsx
const shimmer = keyframes`
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;
const useStyles = createStyles(({ css, cssVar, isDarkMode }) => ({
	loadingBackdrop: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset: 0;

    /* Subtle moving sheen so it doesn't look frozen. */
    background: linear-gradient(
      90deg,
      transparent 0%,
      ${isDarkMode ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)"} 50%,
      transparent 100%
    );
    background-repeat: no-repeat;
    background-size: 200% 100%;

    animation: ${shimmer} 1.6s ${cssVar.motionEaseInOut} infinite;
  `,
	loadingBadge: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 12px;
    inset-inline-start: 12px;

    display: inline-flex;
    gap: 8px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 6px 10px;
    border-radius: 999px;

    font-size: 12px;
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorBgContainer};
    backdrop-filter: blur(8px);
    box-shadow: 0 0 0 1px ${cssVar.colorBorderSecondary};
  `,
	loadingSource: css`
    pointer-events: none;
    overflow: hidden;
    height: 100%;

    /* Faded out so the iframe transition feels like content lighting up,
       not like one document jump-cutting to another. */
    opacity: 0.45;

    /* SyntaxHighlighter sets its own background; flatten so the shimmer
       overlay reads cleanly on top. */
    & [data-code-type='highlighter'] {
      background: transparent;
      box-shadow: none;
    }

    /* Tail-follow is layout-only — we anchor the scrollable element to
       its scrollHeight via the ref + effect; CSS just keeps the
       overflow hidden. */
    & pre,
    & code {
      background: transparent !important;
    }
  `,
	loadingRoot: css`
    position: relative;
    overflow: hidden;
    background: ${isDarkMode ? "#1f1f1f" : "#fafafa"};
  `,
	toolbar: cx(actionsHoverCls, css`
      position: absolute;
      z-index: 2;
      inset-block-start: 8px;
      inset-inline-end: 8px;

      padding: 4px;
      border-radius: ${cssVar.borderRadiusLG};

      opacity: 0;
      background: ${cssVar.colorBgContainer};
      backdrop-filter: blur(8px);
      box-shadow: 0 0 0 1px ${cssVar.colorBorderSecondary};

      transition: opacity 0.2s ${cssVar.motionEaseOut};

      &:focus-within {
        opacity: 1;
      }
    `)
}));
const themeBackground = (theme) => {
	if (theme === "dark") return "#1f1f1f";
	if (theme === "light") return "#ffffff";
};
const downloadHtml = async (content, fileName) => {
	const blob = new Blob([content], { type: "text/html;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	try {
		await downloadBlob(url, fileName);
	} finally {
		URL.revokeObjectURL(url);
	}
};
const HtmlPreview = memo(({ actionIconSize, actionsRender, animated, bodyRender, children, className, classNames, copyable = true, defaultHeight, defaultMode = "preview", downloadable = true, fileName, language = "html", onExpand, sandbox, shadow, streamingMode = "auto", style, styles: customStyles, theme, variant = "filled", fullFeatured: _fullFeatured, showLanguage: _showLanguage, defaultExpand: _defaultExpand, ...rest }) => {
	const trimmedChildren = useMemo(() => (children || "").trim(), [children]);
	const isFragment = useMemo(() => !isFullHtmlDocument(trimmedChildren), [trimmedChildren]);
	const [scriptLocked, setScriptLocked] = useState(false);
	const [headClosed, setHeadClosed] = useState(false);
	const [liveCommitted, setLiveCommitted] = useState(false);
	const prevAnimatedRef = useRef(animated);
	const lastCommitRef = useRef(0);
	const pendingTimerRef = useRef(null);
	const latestContentRef = useRef(trimmedChildren);
	useEffect(() => {
		latestContentRef.current = trimmedChildren;
	}, [trimmedChildren]);
	useEffect(() => {
		if (animated && !prevAnimatedRef.current) {
			setScriptLocked(false);
			setHeadClosed(false);
			setLiveCommitted(false);
			lastCommitRef.current = 0;
			if (pendingTimerRef.current) {
				clearTimeout(pendingTimerRef.current);
				pendingTimerRef.current = null;
			}
		}
		prevAnimatedRef.current = animated;
	}, [animated]);
	useEffect(() => {
		if (animated && !scriptLocked && containsScript(trimmedChildren)) setScriptLocked(true);
	}, [
		trimmedChildren,
		animated,
		scriptLocked
	]);
	useEffect(() => {
		if (animated && !headClosed) {
			const lowered = trimmedChildren.toLowerCase();
			if (lowered.includes("</head>") || lowered.includes("</style>")) setHeadClosed(true);
		}
	}, [
		trimmedChildren,
		animated,
		headClosed
	]);
	const [throttledContent, setThrottledContent] = useState(trimmedChildren);
	useEffect(() => {
		if (!animated) {
			if (pendingTimerRef.current) {
				clearTimeout(pendingTimerRef.current);
				pendingTimerRef.current = null;
			}
			lastCommitRef.current = Date.now();
			setThrottledContent(trimmedChildren);
			return;
		}
		if (!headClosed) return;
		const throttleMs = 250;
		const now = Date.now();
		const elapsed = now - lastCommitRef.current;
		if (elapsed >= throttleMs) {
			if (pendingTimerRef.current) {
				clearTimeout(pendingTimerRef.current);
				pendingTimerRef.current = null;
			}
			lastCommitRef.current = now;
			setThrottledContent(trimmedChildren);
			return;
		}
		if (pendingTimerRef.current === null) pendingTimerRef.current = setTimeout(() => {
			lastCommitRef.current = Date.now();
			pendingTimerRef.current = null;
			setThrottledContent(latestContentRef.current);
		}, throttleMs - elapsed);
	}, [
		trimmedChildren,
		animated,
		headClosed
	]);
	useEffect(() => () => {
		if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
	}, []);
	useEffect(() => {
		if (!animated || liveCommitted || !headClosed) return;
		if (streamingMode === "live" || streamingMode === "auto" && !scriptLocked) setLiveCommitted(true);
	}, [
		animated,
		headClosed,
		liveCommitted,
		scriptLocked,
		streamingMode
	]);
	const isStable = !animated || isHtmlContentClosed(trimmedChildren) || liveCommitted;
	const [mode, setMode] = useState(defaultMode);
	const effectiveMode = isFragment ? "source" : mode;
	const contentRef = useRef(trimmedChildren);
	useEffect(() => {
		contentRef.current = trimmedChildren;
	}, [trimmedChildren]);
	const loadingSourceRef = useRef(null);
	useEffect(() => {
		if (isStable) return;
		const node = loadingSourceRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [trimmedChildren, isStable]);
	const getCopyContent = useCallback(() => contentRef.current, []);
	const handleDownload = useCallback(() => {
		downloadHtml(contentRef.current, fileName || "preview.html");
	}, [fileName]);
	const handleExpand = useCallback(() => {
		onExpand?.(contentRef.current);
	}, [onExpand]);
	const background = themeBackground(theme);
	const sourceBody = useMemo(() => /* @__PURE__ */ jsx(SyntaxHighlighter, {
		animated,
		className: classNames?.content,
		language: "html",
		style: {
			height: "100%",
			...customStyles?.content
		},
		variant,
		children: trimmedChildren
	}), [
		animated,
		classNames?.content,
		customStyles?.content,
		trimmedChildren,
		variant
	]);
	const { styles } = useStyles();
	const iframeBody = useMemo(() => /* @__PURE__ */ jsx(HtmlPreviewIframe, {
		animated,
		background,
		className: classNames?.iframe,
		content: throttledContent,
		defaultHeight,
		sandbox,
		style: customStyles?.iframe
	}), [
		background,
		classNames?.iframe,
		customStyles?.iframe,
		defaultHeight,
		sandbox,
		throttledContent
	]);
	const loadingBody = useMemo(() => /* @__PURE__ */ jsxs("div", {
		className: styles.loadingRoot,
		style: { height: defaultHeight ?? 400 },
		children: [
			/* @__PURE__ */ jsx("div", {
				className: styles.loadingSource,
				ref: loadingSourceRef,
				children: /* @__PURE__ */ jsx(SyntaxHighlighter, {
					animated,
					language: "html",
					variant: "borderless",
					children: trimmedChildren
				})
			}),
			/* @__PURE__ */ jsx("div", { className: styles.loadingBackdrop }),
			/* @__PURE__ */ jsxs("div", {
				className: styles.loadingBadge,
				children: [/* @__PURE__ */ jsx(NeuralNetworkLoading, { size: 16 }), /* @__PURE__ */ jsx("span", { children: "Preparing preview…" })]
			})
		]
	}), [
		animated,
		defaultHeight,
		styles,
		trimmedChildren
	]);
	const defaultBody = effectiveMode === "preview" ? isStable ? iframeBody : loadingBody : sourceBody;
	const body = useMemo(() => {
		if (!bodyRender) return defaultBody;
		return bodyRender({
			content: trimmedChildren,
			mode: effectiveMode,
			originalNode: defaultBody
		});
	}, [
		bodyRender,
		defaultBody,
		effectiveMode,
		trimmedChildren
	]);
	const segmentOptions = useMemo(() => [{
		label: "Preview",
		value: "preview"
	}, {
		label: "Source",
		value: "source"
	}], []);
	const iconSize = actionIconSize || "small";
	const originalActions = /* @__PURE__ */ jsxs(Fragment$1, { children: [
		!isFragment && /* @__PURE__ */ jsx(Segmented, {
			options: segmentOptions,
			size: "small",
			value: effectiveMode,
			onChange: (v) => setMode(v)
		}),
		copyable && /* @__PURE__ */ jsx(CopyButton, {
			content: getCopyContent,
			size: iconSize
		}),
		downloadable && /* @__PURE__ */ jsx(ActionIcon, {
			icon: Download,
			size: iconSize,
			title: "Download HTML",
			onClick: handleDownload
		}),
		onExpand && /* @__PURE__ */ jsx(ActionIcon, {
			icon: Expand,
			size: iconSize,
			title: "Open full preview",
			onClick: handleExpand
		})
	] });
	const actions = actionsRender ? actionsRender({
		actionIconSize: iconSize,
		content: trimmedChildren,
		getContent: getCopyContent,
		mode: effectiveMode,
		originalNode: originalActions,
		setMode
	}) : originalActions;
	return /* @__PURE__ */ jsxs("div", {
		className: cx(variants({
			shadow,
			variant
		}), className),
		"data-code-type": "html-preview",
		"data-html-preview-language": language,
		style,
		...rest,
		children: [/* @__PURE__ */ jsx(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: cx(styles.toolbar, classNames?.header),
			flex: "none",
			gap: 4,
			style: customStyles?.header,
			onClick: stopPropagation,
			children: actions
		}), body]
	});
});
HtmlPreview.displayName = "HtmlPreview";
//#endregion
export { HtmlPreview as default };

//# sourceMappingURL=HtmlPreview.mjs.map