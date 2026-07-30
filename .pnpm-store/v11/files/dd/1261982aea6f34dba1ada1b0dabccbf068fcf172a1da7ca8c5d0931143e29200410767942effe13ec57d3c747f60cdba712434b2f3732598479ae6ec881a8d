import { colorScales } from "../../../color/colors/index.mjs";
import { neutralColorScales } from "../../../color/neutrals/index.mjs";
import { generateCustomColorToken } from "../customToken.mjs";
import { generateColorNeutralPalette, generateColorPalette } from "../generateColorPalette.mjs";
import lightBaseToken from "../token/light.mjs";
//#region src/styles/theme/algorithms/lightAlgorithm.ts
const lightAlgorithm = (seedToken, mapToken) => {
	const primaryColor = seedToken.primaryColor;
	const neutralColor = seedToken.neutralColor;
	let primaryTokens = {};
	let neutralTokens = {};
	const primaryScale = colorScales[primaryColor];
	if (primaryScale) primaryTokens = generateColorPalette({
		appearance: "light",
		scale: primaryScale,
		type: "Primary"
	});
	const neutralScale = neutralColorScales[neutralColor];
	if (neutralScale) neutralTokens = generateColorNeutralPalette({
		appearance: "light",
		scale: neutralScale
	});
	return {
		...mapToken,
		...lightBaseToken,
		...primaryTokens,
		...neutralTokens,
		...generateCustomColorToken(false)
	};
};
//#endregion
export { lightAlgorithm };

//# sourceMappingURL=lightAlgorithm.mjs.map