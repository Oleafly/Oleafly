"use client";
import Center from "../Flex/Center.mjs";
import { safeReadableColor } from "../utils/safeReadableColor.mjs";
import Icon from "../Icon/Icon.mjs";
import Img from "../Img/index.mjs";
import FluentEmoji from "../FluentEmoji/FluentEmoji.mjs";
import { styles, variants } from "./style.mjs";
import { calculateEmojiSize, formatAvatarText, getActualColorForReadable, hasValidBackground, isDefaultAntAvatar } from "./utils.mjs";
import { memo, useMemo, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Avatar } from "antd";
import { cssVar, cx } from "antd-style";
import { Loader2 } from "lucide-react";
import { getEmoji } from "@lobehub/fluent-emoji";
//#region src/Avatar/Avatar.tsx
const Avatar$1 = memo(({ bordered, className, avatar, title, animation, borderedColor, size = 48, shape = "square", background, style, unoptimized, alt, variant = "borderless", shadow, loading, sliceText = true, emojiScaleWithBackground = true, ref, ...rest }) => {
	const isStringAvatar = typeof avatar === "string";
	const isDefaultAntAvatar$1 = useMemo(() => isDefaultAntAvatar(avatar), [avatar]);
	const [isImgError, setIsImgError] = useState(false);
	const emoji = useMemo(() => avatar && !isDefaultAntAvatar$1 && isStringAvatar && getEmoji(avatar), [
		avatar,
		isStringAvatar,
		isDefaultAntAvatar$1
	]);
	const text = String(isDefaultAntAvatar$1 ? title : avatar);
	const imgAlt = alt || title || "avatar";
	const defaultAvatar = useMemo(() => typeof avatar === "string" ? /* @__PURE__ */ jsx(Img, {
		alt: imgAlt,
		height: size,
		loading: "lazy",
		src: avatar,
		unoptimized,
		width: size,
		onError: () => setIsImgError(true)
	}) : avatar, [
		avatar,
		imgAlt,
		size,
		unoptimized
	]);
	const hasBackground = hasValidBackground(background);
	const customAvatar = useMemo(() => emoji ? /* @__PURE__ */ jsx(FluentEmoji, {
		emoji,
		size: calculateEmojiSize(size, hasBackground, emojiScaleWithBackground),
		type: animation ? "anim" : "3d",
		unoptimized
	}) : formatAvatarText(text || title, sliceText), [
		animation,
		emoji,
		hasBackground,
		size,
		sliceText,
		text,
		title,
		unoptimized,
		emojiScaleWithBackground
	]);
	const actualColorForReadable = useMemo(() => getActualColorForReadable(background, cssVar.colorBorder), [background]);
	const avatarStyle = useMemo(() => ({
		backgroundColor: isDefaultAntAvatar$1 && !isImgError || emoji ? background : background || cssVar.colorBorder,
		borderRadius: shape === "square" && size && size < 24 ? "33%" : void 0,
		boxShadow: bordered ? `${cssVar.colorBgLayout} 0 0 0 2px, ${borderedColor || cssVar.colorTextTertiary} 0 0 0 4px` : void 0,
		color: safeReadableColor(actualColorForReadable),
		cursor: rest?.onClick ? "pointer" : void 0,
		fontSize: size * (emoji ? .7 : .5),
		...style
	}), [
		isDefaultAntAvatar$1,
		isImgError,
		background,
		shape,
		emoji,
		size,
		bordered,
		borderedColor,
		actualColorForReadable,
		rest?.onClick,
		style
	]);
	const showFallback = !isDefaultAntAvatar$1 || isImgError;
	return /* @__PURE__ */ jsxs(Avatar, {
		alt: imgAlt,
		className: cx(variants({
			shadow,
			variant
		}), className),
		draggable: false,
		ref,
		shape,
		size,
		src: isDefaultAntAvatar$1 && !isImgError ? defaultAvatar : void 0,
		style: avatarStyle,
		...rest,
		children: [loading && /* @__PURE__ */ jsx(Center, {
			className: styles.loading,
			height: "100%",
			width: "100%",
			children: /* @__PURE__ */ jsx(Icon, {
				spin: true,
				icon: Loader2
			})
		}), showFallback && customAvatar]
	});
});
Avatar$1.displayName = "Avatar";
//#endregion
export { Avatar$1 as default };

//# sourceMappingURL=Avatar.mjs.map