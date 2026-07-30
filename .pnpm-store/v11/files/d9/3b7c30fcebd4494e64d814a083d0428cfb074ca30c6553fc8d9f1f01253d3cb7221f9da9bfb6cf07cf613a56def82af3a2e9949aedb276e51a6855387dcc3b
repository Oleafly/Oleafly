"use client";
import Block from "../Block/Block.mjs";
import Avatar from "../Avatar/index.mjs";
import Grid from "../Grid/Grid.mjs";
import { variants } from "./style.mjs";
import { useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/GroupAvatar/GroupAvatar.tsx
const GroupAvatar = ({ className, style, avatars = [], size = 32, grid = 2, cornerShape = "square", avatarShape = "square", ...rest }) => {
	const calcSize = useMemo(() => {
		const length = avatars.length;
		const gridSize = grid === "auto" ? length > 4 ? 3 : 2 : grid;
		const isCircle = cornerShape === "circle";
		const avatarSize = Math.floor(size / gridSize * (isCircle ? .65 : .75));
		const gapSize = Math.floor((size - avatarSize * gridSize) / (isCircle ? 6 : 4));
		return {
			avatarSize,
			gapSize,
			gridSize,
			gridWidth: avatarSize * gridSize + gapSize,
			maxItemWidth: avatarSize - 1
		};
	}, [
		avatars,
		grid,
		size,
		cornerShape
	]);
	const calcAvatars = useMemo(() => avatars?.slice(0, calcSize.gridSize * calcSize.gridSize), [avatars, calcSize.gridSize]);
	const isSingle = calcAvatars?.length === 1;
	return /* @__PURE__ */ jsx(Block, {
		align: "center",
		className: cx(variants({ cornerShape }), className),
		height: size,
		justify: "center",
		style,
		width: size,
		...rest,
		children: /* @__PURE__ */ jsx(Grid, {
			gap: calcSize.gapSize,
			maxItemWidth: 0,
			rows: calcSize.gridSize,
			width: calcSize.gridWidth,
			children: calcAvatars.map((item, index) => {
				if (typeof item === "string") return /* @__PURE__ */ jsx(Avatar, {
					avatar: item,
					shape: avatarShape,
					size: isSingle ? size * .8 : calcSize.avatarSize
				}, index);
				return /* @__PURE__ */ jsx(Avatar, {
					...item,
					shape: avatarShape,
					size: isSingle ? size * .8 : calcSize.avatarSize
				}, index);
			})
		})
	});
};
//#endregion
export { GroupAvatar as default };

//# sourceMappingURL=GroupAvatar.mjs.map