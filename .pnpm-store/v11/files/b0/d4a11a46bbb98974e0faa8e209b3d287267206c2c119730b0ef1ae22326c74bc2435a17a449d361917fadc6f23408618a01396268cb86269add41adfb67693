"use client";
import { DEFAULT_SANDBOX, SRCDOC_MAX_LENGTH } from "./const.mjs";
import "./injectAutoHeightScript.mjs";
import { SHELL_UPDATE_MESSAGE_TYPE, buildShellSrcDoc } from "./buildShellSrcDoc.mjs";
import { buildStaticSrcDoc } from "./buildStaticSrcDoc.mjs";
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { createStyles, cx } from "antd-style";
//#region src/HtmlPreview/Iframe.tsx
const useStyles = createStyles(({ css, cssVar }) => ({
	fallback: css`
    padding: 16px;
    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
	iframe: css`
    display: block;
    width: 100%;
    border: none;
    background: transparent;
  `
}));
const headSealedPattern = /<\/head\s*>|<body[\s>]/i;
const isHeadSealed = (raw) => headSealedPattern.test(raw);
const parseContent = (() => {
	let parser = null;
	return (content) => {
		if (typeof window === "undefined") return null;
		if (!content) return {
			bodyHtml: "",
			headExtrasHtml: "",
			styleContent: ""
		};
		if (!parser) parser = new DOMParser();
		const doc = parser.parseFromString(content, "text/html");
		const styleParts = [];
		const headExtras = [];
		if (doc.head) for (const child of Array.from(doc.head.children)) if (child.tagName === "STYLE") styleParts.push(child.textContent || "");
		else headExtras.push(child.outerHTML);
		return {
			bodyHtml: doc.body ? doc.body.innerHTML : "",
			headExtrasHtml: isHeadSealed(content) ? headExtras.join("") : "",
			styleContent: styleParts.join("\n")
		};
	};
})();
const HtmlPreviewIframe = memo(({ animated, background, content, className, defaultHeight = 400, ref, sandbox = DEFAULT_SANDBOX, style, title = "HTML preview" }) => {
	const { styles } = useStyles();
	const innerRef = useRef(null);
	const frameId = useId();
	const [height, setHeight] = useState(defaultHeight);
	const defaultHeightRef = useRef(defaultHeight);
	useEffect(() => {
		defaultHeightRef.current = defaultHeight;
	}, [defaultHeight]);
	const tooLarge = content.length > SRCDOC_MAX_LENGTH;
	const staticSrcDoc = useMemo(() => {
		if (animated || tooLarge) return null;
		return buildStaticSrcDoc({
			background,
			content,
			frameId
		});
	}, [
		animated,
		background,
		content,
		frameId,
		tooLarge
	]);
	const shellSrcDoc = useMemo(() => {
		if (!animated || tooLarge) return null;
		return buildShellSrcDoc({
			background,
			frameId
		});
	}, [
		animated,
		background,
		frameId,
		tooLarge
	]);
	const [shellReady, setShellReady] = useState(false);
	useEffect(() => {
		setShellReady(false);
	}, [shellSrcDoc]);
	const payload = useMemo(() => {
		if (!animated || tooLarge) return null;
		return parseContent(content);
	}, [
		animated,
		content,
		tooLarge
	]);
	useEffect(() => {
		if (!animated) return;
		if (!shellReady || !payload) return;
		const win = innerRef.current?.contentWindow;
		if (!win) return;
		win.postMessage({
			frameId,
			payload,
			type: SHELL_UPDATE_MESSAGE_TYPE
		}, "*");
	}, [
		animated,
		payload,
		shellReady,
		frameId
	]);
	useEffect(() => {
		const handler = (event) => {
			const data = event.data;
			if (!data || typeof data !== "object") return;
			if (data.frameId !== frameId) return;
			if (event.source !== innerRef.current?.contentWindow) return;
			if (data.type === `lobe-html-shell-update:ready`) {
				setShellReady(true);
				return;
			}
			if (data.type === "lobe-html-resize") {
				const next = Number(data.height);
				if (!Number.isFinite(next) || next <= 0) return;
				const floored = Math.max(next, defaultHeightRef.current);
				setHeight((prev) => Math.abs(prev - floored) < 1 ? prev : floored);
			}
		};
		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, [frameId]);
	const setRef = useCallback((node) => {
		innerRef.current = node;
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
	}, [ref]);
	if (tooLarge) return /* @__PURE__ */ jsx("div", {
		className: cx(styles.fallback, className),
		style,
		children: "Content too large to preview inline."
	});
	const srcDoc = staticSrcDoc ?? shellSrcDoc ?? "";
	const iframeKey = animated ? "shell" : "static";
	return /* @__PURE__ */ jsx("iframe", {
		className: cx(styles.iframe, className),
		ref: setRef,
		sandbox,
		srcDoc,
		style: {
			height,
			...style
		},
		title
	}, iframeKey);
});
HtmlPreviewIframe.displayName = "HtmlPreviewIframe";
//#endregion
export { HtmlPreviewIframe, HtmlPreviewIframe as default };

//# sourceMappingURL=Iframe.mjs.map