import FlexBasic_default from "../../../Flex/FlexBasic.mjs";
import Avatar$1 from "../../../Avatar/index.mjs";
import { styles } from "../style.mjs";
import Loading from "./Loading.mjs";
import { useMemo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
//#region src/chat/ChatItem/components/Avatar.tsx
const Avatar = ({ loading, avatar, placement, unoptimized, addon, onClick, size = 40, style, alt }) => {
	const cssVariables = useMemo(() => ({ "--chat-item-avatar-size": `${size}px` }), [size]);
	const avatarContent = /* @__PURE__ */ jsxs("div", {
		className: styles.avatarContainer,
		style: {
			...cssVariables,
			...style
		},
		children: [/* @__PURE__ */ jsx(Avatar$1, {
			alt: alt || avatar.title,
			animation: loading,
			avatar: avatar.avatar,
			background: avatar.backgroundColor,
			size,
			title: avatar.title,
			unoptimized,
			onClick
		}), /* @__PURE__ */ jsx(Loading, {
			loading,
			placement
		})]
	});
	if (!addon) return avatarContent;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		align: "center",
		className: styles.avatarGroupContainer,
		gap: 8,
		children: [avatarContent, addon]
	});
};
//#endregion
export { Avatar as default };

//# sourceMappingURL=Avatar.mjs.map