"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Icon from "../Icon/Icon.mjs";
import { Tooltip } from "../base-ui/Tooltip/Tooltip.mjs";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import Avatar from "../Avatar/index.mjs";
import { useTranslation } from "../i18n/useTranslation.mjs";
import emojiPicker_default from "../i18n/resources/en/emojiPicker.mjs";
import Popover from "../base-ui/Popover/Popover.mjs";
import Tabs from "../Tabs/Tabs.mjs";
import AvatarUploader from "./AvatarUploader.mjs";
import { styles } from "./style.mjs";
import { memo, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx, useTheme } from "antd-style";
import useMergeState from "use-merge-value";
import { SmileIcon, TrashIcon, UploadIcon } from "lucide-react";
import chroma from "chroma-js";
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { getLobeIconCDN, toc } from "@lobehub/icons";
import useSWR from "swr";
//#region src/EmojiPicker/EmojiPicker.tsx
const DEFAULT_AVATAR = "🤖";
const EmojiPicker = memo(({ value, defaultAvatar = DEFAULT_AVATAR, onChange, locale = "en-US", allowUpload, allowDelete, allowModelAvatar, texts, onDelete, compressSize = 256, customEmojis, className, loading, onUpload, customTabs = [], popupClassName, popupStyle, customRender, open, defaultOpen = false, onOpenChange, popupProps, shape, contentProps, ...rest }) => {
	const ref = useRef(null);
	const { t } = useTranslation(emojiPicker_default);
	const [visible, setVisible] = useMergeState(defaultOpen, {
		defaultValue: defaultOpen,
		onChange: onOpenChange,
		value: open
	});
	const [tab, setTab] = useState("emoji");
	const theme = useTheme();
	const pickerCssVariables = useMemo(() => ({
		"--emoji-picker-rgb-accent": chroma(theme.colorPrimary).rgb().join(", "),
		"--emoji-picker-rgb-background": chroma(theme.colorBgElevated).rgb().join(", ")
	}), [theme.colorPrimary, theme.colorBgElevated]);
	const { data: i18n } = useSWR(locale, async () => await import(
		/* @vite-ignore */
		`@emoji-mart/data/i18n/${locale.split("-")[0]}.json`
), {
		revalidateOnFocus: false,
		revalidateOnMount: false
	});
	const [ava, setAva] = useMergeState(defaultAvatar, {
		defaultValue: defaultAvatar,
		onChange,
		value
	});
	const handleAvatarChange = (emoji) => {
		setAva(emoji);
		setVisible(false);
	};
	const mergedCustomEmojis = useMemo(() => {
		if (!allowModelAvatar) return customEmojis;
		const modelEmojisCategory = {
			id: "models",
			name: "Models / Providers",
			emojis: toc.filter((item) => item.group !== "application").map((item) => ({
				id: item.id.toLowerCase(),
				name: item.title,
				keywords: [
					item.title,
					item.id,
					item.fullTitle
				],
				skins: [{ src: getLobeIconCDN(item.id, {
					format: "avatar",
					cdn: "aliyun"
				}) }]
			}))
		};
		return customEmojis ? [modelEmojisCategory, ...customEmojis] : [modelEmojisCategory];
	}, [allowModelAvatar, customEmojis]);
	const emojiText = texts?.emoji ?? t("emojiPicker.emoji");
	const uploadText = texts?.upload ?? t("emojiPicker.upload");
	const deleteText = texts?.delete ?? t("emojiPicker.delete");
	const items = [
		!(typeof allowUpload === "object" && allowUpload?.enableEmoji === false) && {
			key: "emoji",
			label: /* @__PURE__ */ jsx(Tooltip, {
				title: emojiText,
				children: /* @__PURE__ */ jsx(Icon, {
					icon: SmileIcon,
					size: {
						size: 20,
						strokeWidth: 2.5
					}
				})
			})
		},
		allowUpload && {
			key: "upload",
			label: /* @__PURE__ */ jsx(Tooltip, {
				title: uploadText,
				children: /* @__PURE__ */ jsx(Icon, {
					icon: UploadIcon,
					size: {
						size: 20,
						strokeWidth: 2.5
					}
				})
			})
		},
		...customTabs.map((tab) => ({
			key: tab.value,
			label: tab.label
		}))
	].filter(Boolean);
	const showTabs = allowDelete || items && items.length > 1;
	const content = /* @__PURE__ */ jsxs(FlexBasic_default, {
		className: cx(styles.picker, popupClassName),
		ref,
		style: {
			minWidth: 310,
			paddingTop: showTabs ? 4 : 0,
			...pickerCssVariables,
			...popupStyle
		},
		...contentProps,
		children: [
			showTabs && /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className: styles.tabs,
				justify: "space-between",
				paddingInline: 10,
				children: [/* @__PURE__ */ jsx(Tabs, {
					compact: true,
					activeKey: tab,
					items,
					size: "small",
					onChange: (key) => setTab(key)
				}), allowDelete && /* @__PURE__ */ jsx(ActionIcon, {
					icon: TrashIcon,
					title: deleteText,
					size: {
						blockSize: 32,
						size: 18
					},
					onClick: () => {
						handleAvatarChange(defaultAvatar);
						onDelete?.();
					}
				})]
			}),
			tab === "emoji" && /* @__PURE__ */ jsx(Picker, {
				custom: mergedCustomEmojis,
				data,
				i18n,
				icons: "outline",
				locale: locale.split("-")[0],
				navPosition: showTabs ? "bottom" : "top",
				previewPosition: "none",
				skinTonePosition: "none",
				theme: theme.isDarkMode ? "dark" : "light",
				onEmojiSelect: (e) => handleAvatarChange(e.src || e.native)
			}),
			tab === "upload" && /* @__PURE__ */ jsx(AvatarUploader, {
				compressSize,
				shape,
				texts,
				onChange: handleAvatarChange,
				onUpload
			}),
			customTabs.map((item) => tab === item.value && /* @__PURE__ */ jsx(FlexBasic_default, {
				padding: 10,
				children: item.render(handleAvatarChange)
			}, item.value))
		]
	});
	return /* @__PURE__ */ jsx(Popover, {
		className: cx(styles.popover),
		content,
		defaultOpen,
		open: visible,
		placement: "bottom",
		trigger: "click",
		classNames: {
			content: styles.popover,
			root: styles.positioner
		},
		onOpenChange: (v) => {
			if (loading) return;
			setVisible(v);
		},
		...popupProps,
		children: customRender ? customRender(ava) : /* @__PURE__ */ jsx(Avatar, {
			avatar: ava,
			className: cx(styles.root, className),
			loading,
			shape,
			...rest
		})
	});
});
EmojiPicker.displayName = "EmojiPicker";
//#endregion
export { EmojiPicker as default };

//# sourceMappingURL=EmojiPicker.mjs.map