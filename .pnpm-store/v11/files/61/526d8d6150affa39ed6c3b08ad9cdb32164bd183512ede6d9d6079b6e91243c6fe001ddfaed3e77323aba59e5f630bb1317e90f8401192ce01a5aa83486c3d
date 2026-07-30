import { colorScales } from "../../../color/colors/index.mjs";
import { neutralColorScales } from "../../../color/neutrals/index.mjs";
import { generateCustomColorToken } from "../customToken.mjs";
import { generateColorNeutralPalette, generateColorPalette } from "../generateColorPalette.mjs";
import darkBaseToken from "../token/dark.mjs";
//#region src/styles/theme/algorithms/darkAlgorithm.ts
const darkAlgorithm = (seedToken, mapToken) => {
	const primaryColor = seedToken.primaryColor;
	const neutralColor = seedToken.neutralColor;
	let primaryTokens = {};
	let neutralTokens = {};
	const primaryScale = colorScales[primaryColor];
	if (primaryScale) primaryTokens = generateColorPalette({
		appearance: "dark",
		scale: primaryScale,
		type: "Primary"
	});
	const neutralScale = neutralColorScales[neutralColor];
	if (neutralScale) neutralTokens = generateColorNeutralPalette({
		appearance: "dark",
		scale: neutralScale
	});
	return {
		...mapToken,
		...darkBaseToken,
		...primaryTokens,
		...neutralTokens,
		...generateCustomColorToken(true)
	};
};
//#endregion
export { darkAlgorithm };

//# sourceMappingURL=darkAlgorithm.mjs.map