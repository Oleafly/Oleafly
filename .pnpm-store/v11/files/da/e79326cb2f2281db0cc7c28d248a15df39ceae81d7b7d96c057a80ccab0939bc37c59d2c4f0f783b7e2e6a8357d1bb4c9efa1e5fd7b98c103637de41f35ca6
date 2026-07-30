import { isValidElement } from "react";
//#region src/Avatar/utils.ts
/**
* 判断 avatar 是否是默认的 Ant Design Avatar 类型
* (URL 路径或 React 元素)
*/
const isDefaultAntAvatar = (avatar) => {
	if (!avatar) return false;
	const isUrlOrDataUri = typeof avatar === "string" && [
		"/",
		"http",
		"data:"
	].some((prefix) => avatar.startsWith(prefix));
	return Boolean(isUrlOrDataUri || isValidElement(avatar));
};
/**
* 判断是否有有效的背景色
*/
const hasValidBackground = (background) => {
	return Boolean(background && background !== "transparent" && background !== "rgba(0,0,0,0)" && background !== null);
};
/**
* 获取用于可读性计算的实际颜色值
* 如果是 CSS 变量，返回 fallback 值
*/
const getActualColorForReadable = (background, fallbackColor) => {
	const bgColor = background || fallbackColor;
	if (typeof bgColor === "string" && bgColor.startsWith("var(")) return fallbackColor;
	return bgColor;
};
/**
* 格式化头像文本（转大写并可选切片）
*/
const formatAvatarText = (text, sliceText) => {
	if (!text) return "";
	const upperText = text.toUpperCase();
	return sliceText ? upperText.slice(0, 2) : upperText;
};
/**
* 计算 emoji 大小
*/
const calculateEmojiSize = (size, hasBackground, emojiScaleWithBackground) => {
	if (emojiScaleWithBackground) return hasBackground ? size * .85 : size;
	return size * .85;
};
//#endregion
export { calculateEmojiSize, formatAvatarText, getActualColorForReadable, hasValidBackground, isDefaultAntAvatar };

//# sourceMappingURL=utils.mjs.map