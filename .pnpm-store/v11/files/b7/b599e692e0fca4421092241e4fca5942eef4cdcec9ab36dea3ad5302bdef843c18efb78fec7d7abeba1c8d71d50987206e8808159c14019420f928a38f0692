import { colorScales } from "../../color/colors/index.mjs";
import { camelCase } from "es-toolkit/compat";
import { mix } from "polished";
//#region src/styles/theme/customToken.ts
const generateColorPalette = ({ name, scale, appearance }) => {
	const isDarkMode = appearance === "dark";
	return {
		[`${name}Fill`]: scale[`${appearance}A`][isDarkMode ? 3 : 4],
		[`${name}FillSecondary`]: scale[`${appearance}A`][isDarkMode ? 2 : 3],
		[`${name}FillTertiary`]: scale[`${appearance}A`][isDarkMode ? 1 : 2],
		[`${name}FillQuaternary`]: scale[`${appearance}A`][isDarkMode ? 0 : 1],
		[`${name}Bg`]: scale[`${appearance}A`][1],
		[`${name}BgHover`]: scale[`${appearance}A`][2],
		[`${name}Border`]: scale[appearance][4],
		[`${name}BorderSecondary`]: scale[appearance][3],
		[`${name}BorderHover`]: scale[appearance][isDarkMode ? 5 : 3],
		[`${name}Hover`]: scale[appearance][isDarkMode ? 10 : 8],
		[`${name}`]: scale[appearance][9],
		[`${name}Active`]: scale[appearance][isDarkMode ? 7 : 10],
		[`${name}TextHover`]: scale[`${appearance}A`][isDarkMode ? 10 : 8],
		[`${name}Text`]: scale[`${appearance}A`][9],
		[`${name}TextActive`]: scale[`${appearance}A`][isDarkMode ? 7 : 10]
	};
};
const generateCustomColorPalette = ({ name, scale, appearance }) => {
	const colorStepPalette = {};
	for (const [index, color] of scale[appearance].entries()) {
		if (index === 0 || index === 12) continue;
		colorStepPalette[`${name}${index}`] = color;
	}
	for (const [index, color] of scale[`${appearance}A`].entries()) {
		if (index === 0 || index === 12) continue;
		colorStepPalette[`${name}${index}A`] = color;
	}
	return {
		...colorStepPalette,
		...generateColorPalette({
			appearance,
			name,
			scale
		})
	};
};
const generateCustomColorToken = (isDarkMode) => {
	let colorCustomToken = {};
	for (const [type, scale] of Object.entries(colorScales)) colorCustomToken = {
		...colorCustomToken,
		...generateCustomColorPalette({
			appearance: isDarkMode ? "dark" : "light",
			name: camelCase(type),
			scale
		})
	};
	return colorCustomToken;
};
const generateCustomToken = ({ isDarkMode, token }) => {
	return {
		...generateCustomColorToken(isDarkMode),
		colorBgContainerSecondary: mix(.5, token.colorBgLayout, token.colorBgContainer)
	};
};
//#endregion
export { generateCustomColorToken, generateCustomToken };

//# sourceMappingURL=customToken.mjs.map