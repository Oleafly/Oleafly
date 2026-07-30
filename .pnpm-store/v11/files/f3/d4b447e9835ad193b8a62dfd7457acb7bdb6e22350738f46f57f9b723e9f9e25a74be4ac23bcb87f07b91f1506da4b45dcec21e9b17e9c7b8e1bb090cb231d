"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import { styles } from "./style.mjs";
import SkeletonAvatar from "./SkeletonAvatar.mjs";
import SkeletonParagraph from "./SkeletonParagraph.mjs";
import SkeletonTitle from "./SkeletonTitle.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Skeleton/Skeleton.tsx
const Skeleton = ({ active, avatar = false, title = true, paragraph = true, className, classNames, styles: customStyles, style, width, height, gap = 16, ...rest }) => {
	const showAvatar = Boolean(avatar);
	const showTitle = Boolean(title);
	const showParagraph = Boolean(paragraph);
	const avatarProps = typeof avatar === "object" ? avatar : void 0;
	const titleProps = typeof title === "object" ? title : void 0;
	const paragraphProps = typeof paragraph === "object" ? paragraph : void 0;
	const rootStyle = {
		...style,
		...customStyles?.root,
		...width !== void 0 ? { width } : {},
		...height !== void 0 ? { height } : {}
	};
	const avatarActive = avatarProps?.active ?? active;
	const titleActive = titleProps?.active ?? active;
	const paragraphActive = paragraphProps?.active ?? active;
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: showParagraph ? "flex-start" : "center",
		className: cx(className, classNames?.root),
		gap,
		style: rootStyle,
		width: "100%",
		...rest,
		children: [showAvatar && /* @__PURE__ */ jsx(SkeletonAvatar, {
			...avatarProps,
			active: avatarActive,
			className: cx(styles.avatar, classNames?.avatar, avatarProps?.className),
			style: {
				...avatarProps?.style,
				...customStyles?.avatar
			}
		}), /* @__PURE__ */ jsxs(FlexBasic_default, {
			gap,
			width: "100%",
			children: [showTitle && /* @__PURE__ */ jsx(SkeletonTitle, {
				...titleProps,
				active: titleActive,
				className: cx(classNames?.title, titleProps?.className),
				style: {
					...titleProps?.style,
					...customStyles?.title
				}
			}), showParagraph && /* @__PURE__ */ jsx(SkeletonParagraph, {
				...paragraphProps,
				active: paragraphActive,
				className: cx(classNames?.paragraph, paragraphProps?.className),
				style: {
					...paragraphProps?.style,
					...customStyles?.paragraph
				}
			})]
		})]
	});
};
Skeleton.displayName = "Skeleton";
//#endregion
export { Skeleton as default };

//# sourceMappingURL=Skeleton.mjs.map