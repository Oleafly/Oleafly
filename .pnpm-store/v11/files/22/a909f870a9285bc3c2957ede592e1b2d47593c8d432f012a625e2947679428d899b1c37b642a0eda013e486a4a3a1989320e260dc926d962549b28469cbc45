import geekblue from "../../../color/colors/geekblue.mjs";
import gold from "../../../color/colors/gold.mjs";
import gray from "../../../color/colors/gray.mjs";
import green from "../../../color/colors/green.mjs";
import primary from "../../../color/colors/primary.mjs";
import volcano from "../../../color/colors/volcano.mjs";
import { generateColorNeutralPalette, generateColorPalette } from "../generateColorPalette.mjs";
//#region src/styles/theme/token/light.ts
const primaryToken = generateColorPalette({
	appearance: "light",
	scale: primary,
	type: "Primary"
});
const neutralToken = generateColorNeutralPalette({
	appearance: "light",
	scale: gray
});
const successToken = generateColorPalette({
	appearance: "light",
	scale: green,
	type: "Success"
});
const warningToken = generateColorPalette({
	appearance: "light",
	scale: gold,
	type: "Warning"
});
const errorToken = generateColorPalette({
	appearance: "light",
	scale: volcano,
	type: "Error"
});
const infoToken = generateColorPalette({
	appearance: "light",
	scale: geekblue,
	type: "Info"
});
const lightBaseToken = {
	...primaryToken,
	...neutralToken,
	...successToken,
	...warningToken,
	...errorToken,
	...infoToken,
	boxShadow: "0 20px 20px -8px rgba(0, 0, 0, 0.24)",
	boxShadowSecondary: "0 8px 16px -4px rgba(0, 0, 0, 0.2)",
	boxShadowTertiary: "0 3px 1px -1px rgba(26, 26, 26, 0.06)",
	colorLink: infoToken.colorInfoText,
	colorLinkActive: infoToken.colorInfoTextActive,
	colorLinkHover: infoToken.colorInfoTextHover,
	colorTextLightSolid: neutralToken.colorBgLayout
};
//#endregion
export { lightBaseToken as default };

//# sourceMappingURL=light.mjs.map