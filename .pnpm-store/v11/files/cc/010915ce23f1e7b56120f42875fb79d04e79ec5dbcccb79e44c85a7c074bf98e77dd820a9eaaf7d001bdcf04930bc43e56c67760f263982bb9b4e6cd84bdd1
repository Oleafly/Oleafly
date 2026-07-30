import blueGeekblueMix from "../color/colors/blue.mjs";
import cyan from "../color/colors/cyan.mjs";
import geekblue from "../color/colors/geekblue.mjs";
import gold from "../color/colors/gold.mjs";
import green from "../color/colors/green.mjs";
import lime from "../color/colors/lime.mjs";
import magenta from "../color/colors/magenta.mjs";
import orange from "../color/colors/orange.mjs";
import purple from "../color/colors/purple.mjs";
import red from "../color/colors/red.mjs";
import volcano from "../color/colors/volcano.mjs";
import yellow from "../color/colors/yellow.mjs";
import mauve from "../color/neutrals/mauve.mjs";
import olive from "../color/neutrals/olive.mjs";
import sage from "../color/neutrals/sage.mjs";
import sand from "../color/neutrals/sand.mjs";
import slate from "../color/neutrals/slate.mjs";
//#region src/styles/customTheme.ts
const primaryColors = {
	blue: blueGeekblueMix.dark[9],
	cyan: cyan.dark[9],
	geekblue: geekblue.dark[9],
	gold: gold.dark[9],
	green: green.dark[9],
	lime: lime.dark[9],
	magenta: magenta.dark[9],
	orange: orange.dark[9],
	purple: purple.dark[9],
	red: red.dark[9],
	volcano: volcano.dark[9],
	yellow: yellow.dark[9]
};
const primaryColorsSwatches = [
	primaryColors.red,
	primaryColors.orange,
	primaryColors.gold,
	primaryColors.yellow,
	primaryColors.lime,
	primaryColors.green,
	primaryColors.cyan,
	primaryColors.blue,
	primaryColors.geekblue,
	primaryColors.purple,
	primaryColors.magenta,
	primaryColors.volcano
];
const neutralColors = {
	mauve: mauve.dark[9],
	olive: olive.dark[9],
	sage: sage.dark[9],
	sand: sand.dark[9],
	slate: slate.dark[9]
};
const neutralColorsSwatches = [
	neutralColors.mauve,
	neutralColors.slate,
	neutralColors.sage,
	neutralColors.olive,
	neutralColors.sand
];
const findCustomThemeName = (type, value) => {
	return Object.entries(type === "primary" ? primaryColors : neutralColors).find((item) => item[1] === value)?.[0];
};
//#endregion
export { findCustomThemeName, neutralColors, neutralColorsSwatches, primaryColors, primaryColorsSwatches };

//# sourceMappingURL=customTheme.mjs.map