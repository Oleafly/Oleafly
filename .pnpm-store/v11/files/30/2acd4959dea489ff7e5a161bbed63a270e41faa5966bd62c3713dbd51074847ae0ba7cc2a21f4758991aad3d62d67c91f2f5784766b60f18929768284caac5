"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Avatar from "../Avatar.mjs";
import { styles } from "./style.mjs";
import { memo } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { cssVar, cx } from "antd-style";
//#region src/Avatar/AvatarGroup/index.tsx
const AvatarGroup = memo(({ items, max, gap, variant = "borderless", bordered, shadow, size = 48, background, animation, draggable, classNames, shape, styles: customStyles, onClick, ref, zIndexReverse, ...rest }) => {
	const avatars = max ? items.slice(0, max) : items;
	const restAvatars = items.slice(max, items.length);
	const gapValue = gap ?? Math.floor(-size / 4);
	const avatarProps = {
		animation,
		background,
		bordered,
		draggable,
		shadow,
		shape,
		size,
		variant
	};
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		gap,
		ref,
		style: { position: "relative" },
		...rest,
		children: [avatars.map((avatar, index) => {
			const { key, style: avatarStyle, className: avatarClassName, ...restAvatarProps } = avatar;
			return /* @__PURE__ */ jsx(Avatar, {
				className: cx(classNames?.avatar, avatarClassName, styles.avatar),
				style: {
					marginLeft: index === 0 ? 0 : gapValue,
					zIndex: zIndexReverse ? items.length - index : index,
					...customStyles?.avatar,
					...avatarStyle
				},
				onClick: () => onClick?.({
					item: avatar,
					key
				}),
				...avatarProps,
				...restAvatarProps
			}, key);
		}), max && restAvatars.length > 0 && /* @__PURE__ */ jsx(Avatar, {
			...avatarProps,
			avatar: `+${restAvatars.length}`,
			background: cssVar.colorText,
			className: cx(styles.avatar, styles.count, classNames?.count),
			sliceText: false,
			style: {
				marginLeft: gapValue,
				zIndex: zIndexReverse ? 0 : avatars.length,
				...customStyles?.count
			}
		})]
	});
});
AvatarGroup.displayName = "AvatarGroup";
//#endregion
export { AvatarGroup as default };

//# sourceMappingURL=index.mjs.map