"use client";
import { useCdnFn } from "../ConfigProvider/index.mjs";
import Center from "../Flex/Center.mjs";
import Img from "../Img/index.mjs";
import { styles } from "./style.mjs";
import { genEmojiUrl } from "./utils.mjs";
import { useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/FluentEmoji/FluentEmoji.tsx
const FluentEmoji = ({ emoji, className, style, type = "3d", size = 40, unoptimized, ref, ...rest }) => {
	const [loadingFail, setLoadingFail] = useState(false);
	const genCdnUrl = useCdnFn();
	const emojiUrl = useMemo(() => genEmojiUrl(emoji, type), [type, emoji]);
	if (type === "raw" || !emojiUrl || loadingFail) return /* @__PURE__ */ jsx(Center, {
		className: cx(styles.container, className),
		flex: "none",
		height: size,
		ref,
		role: "img",
		style: {
			fontSize: size * .9,
			...style
		},
		width: size,
		...rest,
		children: emoji
	});
	return /* @__PURE__ */ jsx(Img, {
		alt: emoji,
		className,
		height: size,
		loading: "lazy",
		ref,
		src: genCdnUrl(emojiUrl),
		style: {
			flex: "none",
			...style
		},
		unoptimized,
		width: size,
		onError: () => setLoadingFail(true),
		...rest
	});
};
FluentEmoji.displayName = "FluentEmoji";
//#endregion
export { FluentEmoji as default };

//# sourceMappingURL=FluentEmoji.mjs.map