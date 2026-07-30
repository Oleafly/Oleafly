"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { styles, variants } from "./style.mjs";
import { memo, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Skeleton } from "antd";
import { cssVar, cx } from "antd-style";
import { PlayIcon } from "lucide-react";
//#region src/Video/index.tsx
const Video = memo(({ ref, preload = "auto", src, style, classNames, className, maxHeight = "100%", maxWidth = "100%", minHeight, minWidth, onEnded, onPause, onPlay, onPlaying, width, height, onMouseEnter, styles: customStyles, onMouseLeave, preview = true, isLoading, variant = "filled", autoPlay, ...rest }) => {
	const [isPlaying, setIsPlaying] = useState(false);
	const [showControls, setShowControls] = useState(false);
	const cssVariables = useMemo(() => {
		const vars = {};
		if (maxHeight !== void 0) vars["--video-max-height"] = typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight;
		if (maxWidth !== void 0) vars["--video-max-width"] = typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth;
		if (minHeight !== void 0) vars["--video-min-height"] = typeof minHeight === "number" ? `${minHeight}px` : minHeight;
		if (minWidth !== void 0) vars["--video-min-width"] = typeof minWidth === "number" ? `${minWidth}px` : minWidth;
		return vars;
	}, [
		maxHeight,
		maxWidth,
		minHeight,
		minWidth
	]);
	if (isLoading) return /* @__PURE__ */ jsx(Skeleton.Avatar, {
		active: true,
		style: {
			borderRadius: cssVar.borderRadiusLG,
			height,
			maxHeight,
			maxWidth,
			minHeight,
			minWidth,
			width
		}
	});
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(variants({ variant }), className, classNames?.wrapper),
		height,
		ref,
		width,
		style: {
			...cssVariables,
			...style,
			...customStyles?.wrapper
		},
		children: [preview && !isPlaying && /* @__PURE__ */ jsx(FlexBasic_default, {
			align: "center",
			className: cx(styles.mask, classNames?.mask),
			justify: "center",
			style: customStyles?.mask,
			children: /* @__PURE__ */ jsx(ActionIcon, {
				color: "#fff",
				icon: PlayIcon,
				variant: "filled"
			})
		}), /* @__PURE__ */ jsx("video", {
			autoPlay,
			className: cx(styles.video, classNames?.video),
			controls: showControls,
			height,
			preload,
			width,
			style: {
				height: "auto",
				maxWidth: "100%",
				...customStyles?.video
			},
			onEnded: (e) => {
				setIsPlaying(false);
				onEnded?.(e);
			},
			onMouseEnter: (e) => {
				setShowControls(true);
				onMouseEnter?.(e);
			},
			onMouseLeave: (e) => {
				setShowControls(false);
				onMouseLeave?.(e);
			},
			onPause: (e) => {
				setIsPlaying(false);
				onPause?.(e);
			},
			onPlay: (e) => {
				setIsPlaying(true);
				onPlay?.(e);
			},
			onPlaying: (e) => {
				setIsPlaying(true);
				onPlaying?.(e);
			},
			...rest,
			children: /* @__PURE__ */ jsx("source", { src })
		})]
	});
});
Video.displayName = "Video";
//#endregion
export { Video as default };

//# sourceMappingURL=index.mjs.map