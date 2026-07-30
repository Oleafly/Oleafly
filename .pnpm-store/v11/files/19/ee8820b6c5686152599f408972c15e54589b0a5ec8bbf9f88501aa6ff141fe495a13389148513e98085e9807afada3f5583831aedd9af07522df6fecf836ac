"use client";
import Image from "../../Image/index.mjs";
import { mermaidThemes } from "../const.mjs";
import { useStreamMermaid } from "../../hooks/useStreamMermaid.mjs";
import { memo, useEffect, useId, useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { kebabCase } from "es-toolkit/compat";
//#region src/Mermaid/SyntaxMermaid/StreamMermaid.tsx
const StreamMermaid = memo(({ children, className, fallbackClassName, ref, style, theme: customTheme, variant }) => {
	const safeChildren = children ?? "";
	const isDefaultTheme = customTheme === "lobe-theme" || !customTheme;
	const background = useMemo(() => {
		if (isDefaultTheme) return;
		return mermaidThemes.find((item) => item.id === customTheme)?.background;
	}, [isDefaultTheme, customTheme]);
	const data = useStreamMermaid(safeChildren, {
		enabled: true,
		id: kebabCase(`mermaid-${useId()}`),
		theme: isDefaultTheme ? void 0 : customTheme
	});
	const isLoading = !data;
	const [blobUrl, setBlobUrl] = useState();
	useEffect(() => {
		return () => {
			if (blobUrl) URL.revokeObjectURL(blobUrl);
		};
	}, [blobUrl]);
	useEffect(() => {
		if (isLoading || !data) {
			setBlobUrl(void 0);
			return;
		}
		let finalSvgString = data;
		if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.userAgent.includes("Firefox")) {
			const svgDoc = new DOMParser().parseFromString(data, "image/svg+xml");
			const svgElement = svgDoc.documentElement;
			if (svgElement && svgElement.hasAttribute("viewBox")) {
				const viewBoxParts = svgElement.getAttribute("viewBox").split(" ");
				if (Array.isArray(viewBoxParts) && viewBoxParts.length === 4) {
					svgElement.setAttribute("width", viewBoxParts[2]);
					svgElement.setAttribute("height", viewBoxParts[3]);
				}
				finalSvgString = new XMLSerializer().serializeToString(svgDoc);
			}
		}
		const svgBlob = new Blob([finalSvgString], { type: "image/svg+xml" });
		const url = URL.createObjectURL(svgBlob);
		setBlobUrl(url);
	}, [isLoading, data]);
	const containerStyle = {
		background: variant === "filled" ? background : void 0,
		margin: 0,
		minWidth: 300,
		padding: variant === "borderless" ? 0 : 16,
		position: "relative",
		width: "100%",
		...style
	};
	if (!blobUrl) return /* @__PURE__ */ jsx("div", {
		className: fallbackClassName,
		style,
		children: /* @__PURE__ */ jsx("div", {
			style: { padding: 16 },
			children: "Rendering..."
		})
	});
	return /* @__PURE__ */ jsx(Image, {
		alt: "mermaid",
		className,
		maxHeight: 480,
		minWidth: 300,
		objectFit: "contain",
		ref,
		src: blobUrl,
		style: containerStyle,
		variant: "borderless",
		width: "100%"
	});
});
StreamMermaid.displayName = "StreamMermaid";
//#endregion
export { StreamMermaid as default };

//# sourceMappingURL=StreamMermaid.mjs.map