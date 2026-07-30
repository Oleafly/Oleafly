import { cssVar } from "antd-style";
import { readableColor } from "polished";
//#region src/utils/safeReadableColor.ts
const safeReadableColor = (bgColor, fallbackColor) => {
	try {
		return readableColor(bgColor);
	} catch {
		if (bgColor.startsWith("var(")) return `contrast-color(${bgColor})`;
		return fallbackColor || cssVar.colorText;
	}
};
//#endregion
export { safeReadableColor };

//# sourceMappingURL=safeReadableColor.mjs.map