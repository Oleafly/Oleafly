"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import ChatInputAreaInner from "../../chat/ChatInputArea/components/ChatInputAreaInner.mjs";
import SafeArea from "../SafeArea/SafeArea.mjs";
import { styles } from "./style.mjs";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSize } from "ahooks";
//#region src/mobile/ChatInputArea/ChatInputArea.tsx
const ChatInputArea = memo(({ ref, className, style, topAddons, textAreaLeftAddons, textAreaRightAddons, bottomAddons, expand = false, setExpand, onSend, onInput, loading, value, safeArea }) => {
	const containerRef = useRef(null);
	const size = useSize(containerRef);
	const [showFullscreen, setShowFullscreen] = useState(false);
	const [isFocused, setIsFocused] = useState(false);
	useEffect(() => {
		if (!size?.height) return;
		setShowFullscreen(size.height > 72);
	}, [size]);
	const InnerContainer = useCallback(({ children, ...r }) => expand ? /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: styles.inner,
		gap: 8,
		children: [
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				gap: 8,
				justify: "flex-end",
				children: [r.textAreaLeftAddons, r.textAreaRightAddons]
			}),
			children,
			r.topAddons,
			r.bottomAddons
		]
	}) : /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "flex-end",
		className: styles.inner,
		gap: 8,
		children: [
			r.textAreaLeftAddons,
			children,
			r.textAreaRightAddons
		]
	}), [expand, loading]);
	const showAddons = !expand && !isFocused;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(styles.container, expand && styles.expand, className),
		gap: 12,
		style,
		children: [
			topAddons && /* @__PURE__ */ jsx(FlexBasic_default, {
				style: showAddons ? {} : { display: "none" },
				children: topAddons
			}),
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				className: cx(expand && styles.expand),
				ref: containerRef,
				style: { position: "relative" },
				children: [showFullscreen && /* @__PURE__ */ jsx(ActionIcon, {
					active: true,
					className: styles.expandButton,
					icon: expand ? ChevronDown : ChevronUp,
					id: "sssssss",
					size: {
						blockSize: 24,
						borderRadius: "50%",
						size: 14
					},
					style: expand ? { top: 6 } : {},
					onClick: () => setExpand?.(!expand)
				}), /* @__PURE__ */ jsx(InnerContainer, {
					bottomAddons,
					textAreaLeftAddons,
					textAreaRightAddons,
					topAddons,
					children: /* @__PURE__ */ jsx(ChatInputAreaInner, {
						autoSize: expand ? false : {
							maxRows: 6,
							minRows: 1
						},
						className: styles.expandTextArea,
						loading,
						ref,
						style: {
							height: 36,
							paddingBlock: 6
						},
						value,
						variant: expand ? "borderless" : "filled",
						onBlur: () => setIsFocused(false),
						onFocus: () => setIsFocused(true),
						onInput,
						onSend
					})
				})]
			}),
			bottomAddons && /* @__PURE__ */ jsx(FlexBasic_default, {
				style: showAddons ? {} : { display: "none" },
				children: bottomAddons
			}),
			safeArea && !isFocused && /* @__PURE__ */ jsx(SafeArea, { position: "bottom" })
		]
	});
});
ChatInputArea.displayName = "ChatInputArea";
//#endregion
export { ChatInputArea as default };

//# sourceMappingURL=ChatInputArea.mjs.map