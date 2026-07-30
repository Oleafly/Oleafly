"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Divider from "../components/Divider.mjs";
import LobeChatText from "../LobeChatText/index.mjs";
import { styles } from "../LobeHub/style.mjs";
import Logo3d from "../Logo3d/index.mjs";
import LogoFlat_default from "../LogoFlat/index.mjs";
import icons_default from "../LogoMono/index.mjs";
import { memo } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
import { cssVar } from "antd-style";
//#region src/brand/LobeChat/index.tsx
const LobeChat = memo(({ type = "3d", size = 32, style, extra, className, ...rest }) => {
	let logoComponent;
	switch (type) {
		case "3d":
			logoComponent = /* @__PURE__ */ jsx(Logo3d, {
				alt: "LobeChat",
				size,
				...rest
			});
			break;
		case "flat":
			logoComponent = /* @__PURE__ */ jsx(LogoFlat_default, {
				size,
				style
			});
			break;
		case "mono":
			logoComponent = /* @__PURE__ */ jsx(icons_default, {
				size,
				style
			});
			break;
		case "text":
			logoComponent = /* @__PURE__ */ jsx(LobeChatText, {
				className,
				size,
				style,
				...rest
			});
			break;
		case "combine":
			logoComponent = /* @__PURE__ */ jsxs(Fragment$1, { children: [/* @__PURE__ */ jsx(Logo3d, {
				alt: "LobeChat",
				size
			}), /* @__PURE__ */ jsx(LobeChatText, {
				size,
				style: { marginLeft: Math.round(size / 4) }
			})] });
			if (!extra) logoComponent = /* @__PURE__ */ jsx(FlexBasic_default, {
				horizontal: true,
				align: "center",
				className,
				flex: "none",
				style,
				children: logoComponent
			});
			break;
	}
	if (!extra) return logoComponent;
	const extraSize = Math.round(size / 3 * 1.9);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className,
		flex: "none",
		style,
		...rest,
		children: [
			logoComponent,
			/* @__PURE__ */ jsx(Divider, {
				size: extraSize,
				style: { color: cssVar.colorFill }
			}),
			/* @__PURE__ */ jsx("div", {
				className: styles.extraTitle,
				style: { fontSize: extraSize },
				children: extra
			})
		]
	});
});
LobeChat.displayName = "LobeChatBrand";
//#endregion
export { LobeChat as default };

//# sourceMappingURL=index.mjs.map