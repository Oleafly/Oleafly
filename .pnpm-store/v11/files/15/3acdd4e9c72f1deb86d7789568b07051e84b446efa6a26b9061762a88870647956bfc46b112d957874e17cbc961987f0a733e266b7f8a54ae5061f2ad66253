"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import chat_default from "../../i18n/resources/en/chat.mjs";
import { styles } from "./style.mjs";
import Actions from "./components/Actions.mjs";
import Avatar from "./components/Avatar.mjs";
import BorderSpacing from "./components/BorderSpacing.mjs";
import ErrorContent from "./components/ErrorContent.mjs";
import MessageContent from "./components/MessageContent.mjs";
import Title from "./components/Title.mjs";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cx, useResponsive } from "antd-style";
//#region src/chat/ChatItem/ChatItem.tsx
const MOBILE_AVATAR_SIZE = 32;
const ChatItem = memo(({ avatarAddon, onAvatarClick, avatarProps, actions, className, primary, loading, message, placeholderMessage, placement = "left", variant = "bubble", avatar, error, showTitle, time, editing, onChange, onEditingChange, messageExtra, renderMessage, text, errorMessage, onDoubleClick, fontSize, aboveMessage, belowMessage, markdownProps, actionsWrapWidth = 54, showAvatar = true, titleAddon, ...rest }) => {
	const { mobile } = useResponsive();
	const { t } = useTranslation(chat_default);
	const avatarSize = mobile ? MOBILE_AVATAR_SIZE : avatarProps?.size || 40;
	const cssVariables = useMemo(() => ({ "--chat-item-avatar-size": `${avatarSize}px` }), [avatarSize]);
	const hasTime = Boolean(time);
	const placeholderText = placeholderMessage ?? t("chat.placeholder");
	const avatarAlt = avatarProps?.alt || avatar.title || t("chat.avatar");
	const contentRef = useRef(null);
	const containerRef = useRef(null);
	const [layoutMode, setLayoutMode] = useState(variant === "bubble" ? "horizontal" : "vertical");
	useEffect(() => {
		if (variant === "docs") {
			setLayoutMode("vertical");
			return;
		}
		if (!contentRef.current || !containerRef.current) return;
		const observer = new ResizeObserver(() => {
			if (!contentRef.current || !containerRef.current) return;
			const containerWidth = containerRef.current.clientWidth;
			const contentWidth = contentRef.current.scrollWidth;
			setLayoutMode(contentWidth + actionsWrapWidth > containerWidth ? "vertical" : "horizontal");
		});
		observer.observe(contentRef.current);
		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [variant, actionsWrapWidth]);
	const containerClassName = cx(variant === "docs" ? styles.containerDocs : styles.container, className);
	const messageContainerClassName = useMemo(() => {
		if (editing) return hasTime ? styles.messageContainerEditingWithTime : styles.messageContainerEditing;
		return hasTime ? styles.messageContainerWithTime : styles.messageContainer;
	}, [editing, hasTime]);
	const messageContentClassName = useMemo(() => {
		return editing ? styles.messageContentEditing : styles.messageContent;
	}, [editing]);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: containerClassName,
		direction: placement === "left" ? "horizontal" : "horizontal-reverse",
		gap: mobile ? 6 : 12,
		style: cssVariables,
		...rest,
		children: [
			showAvatar && /* @__PURE__ */ jsx(Avatar, {
				...avatarProps,
				addon: avatarAddon,
				alt: avatarAlt,
				avatar,
				loading,
				placement,
				size: avatarSize,
				style: {
					marginTop: showTitle ? -12 : 6,
					...avatarProps?.style
				},
				onClick: onAvatarClick
			}),
			/* @__PURE__ */ jsxs(FlexBasic_default, {
				align: placement === "left" ? "flex-start" : "flex-end",
				className: messageContainerClassName,
				ref: containerRef,
				children: [
					/* @__PURE__ */ jsx(Title, {
						avatar,
						placement,
						showTitle,
						time,
						titleAddon
					}),
					aboveMessage,
					/* @__PURE__ */ jsxs(FlexBasic_default, {
						align: placement === "left" ? "flex-start" : "flex-end",
						className: messageContentClassName,
						"data-layout": layoutMode,
						gap: 8,
						direction: layoutMode === "horizontal" ? placement === "left" ? "horizontal" : "horizontal-reverse" : "vertical",
						children: [/* @__PURE__ */ jsx(FlexBasic_default, {
							ref: contentRef,
							width: "100%",
							children: error && (message === placeholderText || !message) ? /* @__PURE__ */ jsx(ErrorContent, {
								error,
								message: errorMessage,
								placement
							}) : /* @__PURE__ */ jsx(MessageContent, {
								editing,
								fontSize,
								markdownProps,
								message,
								placement,
								primary,
								renderMessage,
								text,
								variant,
								messageExtra: /* @__PURE__ */ jsxs(Fragment$1, { children: [error && /* @__PURE__ */ jsx(ErrorContent, {
									error,
									message: errorMessage,
									placement
								}), messageExtra] }),
								onChange,
								onDoubleClick,
								onEditingChange
							})
						}), actions && /* @__PURE__ */ jsx(Actions, {
							actions,
							editing,
							placement,
							variant
						})]
					}),
					belowMessage
				]
			}),
			mobile && variant === "bubble" && showAvatar && /* @__PURE__ */ jsx(BorderSpacing, { borderSpacing: MOBILE_AVATAR_SIZE })
		]
	});
});
//#endregion
export { ChatItem as default };

//# sourceMappingURL=ChatItem.mjs.map