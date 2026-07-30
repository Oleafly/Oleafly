import { KeyMapEnum } from "./const.mjs";
//#region src/Hotkey/utils.ts
const NORMATIVE_MODIFIER = [
	KeyMapEnum.Ctrl,
	KeyMapEnum.Control,
	KeyMapEnum.CommandOrControl,
	KeyMapEnum.Meta,
	KeyMapEnum.Mod,
	KeyMapEnum.Alt,
	KeyMapEnum.Shift
];
const orderMap = Object.fromEntries(NORMATIVE_MODIFIER.map((key, index) => [key, index]));
const splitKeysByPlus = (keys) => {
	return keys.replaceAll("++", `+${KeyMapEnum.Equal}`).split("+").sort((x, y) => {
		return (orderMap[x.toLowerCase()] ?? orderMap.length) - (orderMap[y.toLowerCase()] ?? orderMap.length);
	});
};
const startCase = (str) => {
	return str.replaceAll(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
};
const checkIsAppleDevice = (isApple) => {
	if (isApple !== void 0) return isApple;
	if (typeof window === "undefined" || typeof navigator === "undefined") return false;
	const userAgent = navigator.userAgent.toLowerCase();
	return /mac|iphone|ipod|ipad|ios/i.test(userAgent);
};
const combineKeys = (keys) => keys.join("+");
//#endregion
export { NORMATIVE_MODIFIER, checkIsAppleDevice, combineKeys, splitKeysByPlus, startCase };

//# sourceMappingURL=utils.mjs.map