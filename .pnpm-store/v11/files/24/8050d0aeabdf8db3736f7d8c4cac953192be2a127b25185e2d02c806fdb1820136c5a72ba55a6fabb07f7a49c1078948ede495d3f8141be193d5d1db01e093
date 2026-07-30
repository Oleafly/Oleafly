import { t as structuredClone } from "../../structured-clone-DndUdUpo.js";
import { arg } from "@unified-latex/unified-latex-builder";
import { getArgsContent } from "@unified-latex/unified-latex-util-arguments";
import { XColorPegParser } from "@unified-latex/unified-latex-util-pegjs";
import { printRaw as printRaw$1 } from "@unified-latex/unified-latex-util-print-raw";
import { deleteComments } from "@unified-latex/unified-latex-util-comments";
import Color from "color";
//#region package/xcolor/provides.ts
var macros = {
	substitutecolormodel: {
		signature: "m m",
		renderInfo: { breakAround: true }
	},
	selectcolormodel: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	definecolor: {
		signature: "o m m m",
		renderInfo: { breakAround: true }
	},
	providecolor: {
		signature: "o m m m",
		renderInfo: { breakAround: true }
	},
	colorlet: {
		signature: "o m o m",
		renderInfo: { breakAround: true }
	},
	definecolorset: {
		signature: "o m m m",
		renderInfo: { breakAround: true }
	},
	providecolorset: {
		signature: "o m m m m",
		renderInfo: { breakAround: true }
	},
	preparecolor: {
		signature: "o m m m",
		renderInfo: { breakAround: true }
	},
	preparecolorset: {
		signature: "o m m m m",
		renderInfo: { breakAround: true }
	},
	DefineNamedColor: {
		signature: "m m m m",
		renderInfo: { breakAround: true }
	},
	definecolors: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	providecolors: {
		signature: "m",
		renderInfo: { breakAround: true }
	},
	color: {
		signature: "o m",
		renderInfo: { breakAround: true }
	},
	textcolor: {
		signature: "o m m",
		renderInfo: { inParMode: true }
	},
	pagecolor: { signature: "o m" },
	colorbox: { signature: "o m m" },
	fcolorbox: { signature: "o m o m m" },
	boxframe: { signature: "o m" },
	testcolor: { signature: "o m" },
	blendcolors: { signature: "s m" },
	maskcolors: { signature: "o m" },
	definecolorseries: {
		signature: "m m m o m o m",
		renderInfo: { breakAround: true }
	},
	resetcolorseries: {
		signature: "o m",
		renderInfo: { breakAround: true }
	},
	rowcolors: { signature: "s o m m m" },
	extractcolorspec: { signature: "m m" },
	extractcolorspecs: { signature: "m m m" },
	convertcolorspec: { signature: "m m m m" }
};
var environments = { testcolors: {
	signature: "o",
	renderInfo: { pgfkeysArgs: true }
} };
//#endregion
//#region package/xcolor/libs/predefined-colors.ts
var fromRgb = ([r, g, b]) => Color([
	r * 255,
	g * 255,
	b * 255
], "rgb");
var DVI_PS_NAMES = {
	Apricot: Color("#FBB982"),
	Aquamarine: Color("#00B5BE"),
	Bittersweet: Color("#C04F17"),
	Black: Color("#221E1F"),
	Blue: Color("#2D2F92"),
	BlueGreen: Color("#00B3B8"),
	BlueViolet: Color("#473992"),
	BrickRed: Color("#B6321C"),
	Brown: Color("#792500"),
	BurntOrange: Color("#F7921D"),
	CadetBlue: Color("#74729A"),
	CarnationPink: Color("#F282B4"),
	Cerulean: Color("#00A2E3"),
	CornflowerBlue: Color("#41B0E4"),
	Cyan: Color("#00AEEF"),
	Dandelion: Color("#FDBC42"),
	DarkOrchid: Color("#A4538A"),
	Emerald: Color("#00A99D"),
	ForestGreen: Color("#009B55"),
	Fuchsia: Color("#8C368C"),
	Goldenrod: Color("#FFDF42"),
	Gray: Color("#949698"),
	Green: Color("#00A64F"),
	GreenYellow: Color("#DFE674"),
	JungleGreen: Color("#00A99A"),
	Lavender: Color("#F49EC4"),
	LimeGreen: Color("#8DC73E"),
	Magenta: Color("#EC008C"),
	Mahogany: Color("#A9341F"),
	Maroon: Color("#AF3235"),
	Melon: Color("#F89E7B"),
	MidnightBlue: Color("#006795"),
	Mulberry: Color("#A93C93"),
	NavyBlue: Color("#006EB8"),
	OliveGreen: Color("#3C8031"),
	Orange: Color("#F58137"),
	OrangeRed: Color("#ED135A"),
	Orchid: Color("#AF72B0"),
	Peach: Color("#F7965A"),
	Periwinkle: Color("#7977B8"),
	PineGreen: Color("#008B72"),
	Plum: Color("#92268F"),
	ProcessBlue: Color("#00B0F0"),
	Purple: Color("#99479B"),
	RawSienna: Color("#974006"),
	Red: Color("#ED1B23"),
	RedOrange: Color("#F26035"),
	RedViolet: Color("#A1246B"),
	Rhodamine: Color("#EF559F"),
	RoyalBlue: Color("#0071BC"),
	RoyalPurple: Color("#613F99"),
	RubineRed: Color("#ED017D"),
	Salmon: Color("#F69289"),
	SeaGreen: Color("#3FBC9D"),
	Sepia: Color("#671800"),
	SkyBlue: Color("#46C5DD"),
	SpringGreen: Color("#C6DC67"),
	Tan: Color("#DA9D76"),
	TealBlue: Color("#00AEB3"),
	Thistle: Color("#D883B7"),
	Turquoise: Color("#00B4CE"),
	Violet: Color("#58429B"),
	VioletRed: Color("#EF58A0"),
	White: Color("#FFFFFF"),
	WildStrawberry: Color("#EE2967"),
	Yellow: Color("#FFF200"),
	YellowGreen: Color("#98CC70"),
	YellowOrange: Color("#FAA21A")
};
var SVG_NAMES = {
	AliceBlue: fromRgb([
		.94,
		.972,
		1
	]),
	AntiqueWhite: fromRgb([
		.98,
		.92,
		.844
	]),
	Aqua: fromRgb([
		0,
		1,
		1
	]),
	Aquamarine: fromRgb([
		.498,
		1,
		.83
	]),
	Azure: fromRgb([
		.94,
		1,
		1
	]),
	Beige: fromRgb([
		.96,
		.96,
		.864
	]),
	Bisque: fromRgb([
		1,
		.894,
		.77
	]),
	Black: fromRgb([
		0,
		0,
		0
	]),
	BlanchedAlmond: fromRgb([
		1,
		.92,
		.804
	]),
	Blue: fromRgb([
		0,
		0,
		1
	]),
	BlueViolet: fromRgb([
		.54,
		.17,
		.888
	]),
	Brown: fromRgb([
		.648,
		.165,
		.165
	]),
	BurlyWood: fromRgb([
		.87,
		.72,
		.53
	]),
	CadetBlue: fromRgb([
		.372,
		.62,
		.628
	]),
	Chartreuse: fromRgb([
		.498,
		1,
		0
	]),
	Chocolate: fromRgb([
		.824,
		.41,
		.116
	]),
	Coral: fromRgb([
		1,
		.498,
		.312
	]),
	CornflowerBlue: fromRgb([
		.392,
		.585,
		.93
	]),
	Cornsilk: fromRgb([
		1,
		.972,
		.864
	]),
	Crimson: fromRgb([
		.864,
		.08,
		.235
	]),
	Cyan: fromRgb([
		0,
		1,
		1
	]),
	DarkBlue: fromRgb([
		0,
		0,
		.545
	]),
	DarkCyan: fromRgb([
		0,
		.545,
		.545
	]),
	DarkGoldenrod: fromRgb([
		.72,
		.525,
		.044
	]),
	DarkGray: fromRgb([
		.664,
		.664,
		.664
	]),
	DarkGreen: fromRgb([
		0,
		.392,
		0
	]),
	DarkGrey: fromRgb([
		.664,
		.664,
		.664
	]),
	DarkKhaki: fromRgb([
		.74,
		.716,
		.42
	]),
	DarkMagenta: fromRgb([
		.545,
		0,
		.545
	]),
	DarkOliveGreen: fromRgb([
		.332,
		.42,
		.185
	]),
	DarkOrange: fromRgb([
		1,
		.55,
		0
	]),
	DarkOrchid: fromRgb([
		.6,
		.196,
		.8
	]),
	DarkRed: fromRgb([
		.545,
		0,
		0
	]),
	DarkSalmon: fromRgb([
		.912,
		.59,
		.48
	]),
	DarkSeaGreen: fromRgb([
		.56,
		.736,
		.56
	]),
	DarkSlateBlue: fromRgb([
		.284,
		.24,
		.545
	]),
	DarkSlateGray: fromRgb([
		.185,
		.31,
		.31
	]),
	DarkSlateGrey: fromRgb([
		.185,
		.31,
		.31
	]),
	DarkTurquoise: fromRgb([
		0,
		.808,
		.82
	]),
	DarkViolet: fromRgb([
		.58,
		0,
		.828
	]),
	DeepPink: fromRgb([
		1,
		.08,
		.576
	]),
	DeepSkyBlue: fromRgb([
		0,
		.75,
		1
	]),
	DimGray: fromRgb([
		.41,
		.41,
		.41
	]),
	DimGrey: fromRgb([
		.41,
		.41,
		.41
	]),
	DodgerBlue: fromRgb([
		.116,
		.565,
		1
	]),
	FireBrick: fromRgb([
		.698,
		.132,
		.132
	]),
	FloralWhite: fromRgb([
		1,
		.98,
		.94
	]),
	ForestGreen: fromRgb([
		.132,
		.545,
		.132
	]),
	Fuchsia: fromRgb([
		1,
		0,
		1
	]),
	Gainsboro: fromRgb([
		.864,
		.864,
		.864
	]),
	GhostWhite: fromRgb([
		.972,
		.972,
		1
	]),
	Gold: fromRgb([
		1,
		.844,
		0
	]),
	Goldenrod: fromRgb([
		.855,
		.648,
		.125
	]),
	Gray: fromRgb([
		.5,
		.5,
		.5
	]),
	Green: fromRgb([
		0,
		.5,
		0
	]),
	GreenYellow: fromRgb([
		.68,
		1,
		.185
	]),
	Grey: fromRgb([
		.5,
		.5,
		.5
	]),
	Honeydew: fromRgb([
		.94,
		1,
		.94
	]),
	HotPink: fromRgb([
		1,
		.41,
		.705
	]),
	IndianRed: fromRgb([
		.804,
		.36,
		.36
	]),
	Indigo: fromRgb([
		.294,
		0,
		.51
	]),
	Ivory: fromRgb([
		1,
		1,
		.94
	]),
	Khaki: fromRgb([
		.94,
		.9,
		.55
	]),
	Lavender: fromRgb([
		.9,
		.9,
		.98
	]),
	LavenderBlush: fromRgb([
		1,
		.94,
		.96
	]),
	LawnGreen: fromRgb([
		.488,
		.99,
		0
	]),
	LemonChiffon: fromRgb([
		1,
		.98,
		.804
	]),
	LightBlue: fromRgb([
		.68,
		.848,
		.9
	]),
	LightCoral: fromRgb([
		.94,
		.5,
		.5
	]),
	LightCyan: fromRgb([
		.88,
		1,
		1
	]),
	LightGoldenrod: fromRgb([
		.933,
		.867,
		.51
	]),
	LightGoldenrodYellow: fromRgb([
		.98,
		.98,
		.824
	]),
	LightGray: fromRgb([
		.828,
		.828,
		.828
	]),
	LightGreen: fromRgb([
		.565,
		.932,
		.565
	]),
	LightGrey: fromRgb([
		.828,
		.828,
		.828
	]),
	LightPink: fromRgb([
		1,
		.712,
		.756
	]),
	LightSalmon: fromRgb([
		1,
		.628,
		.48
	]),
	LightSeaGreen: fromRgb([
		.125,
		.698,
		.668
	]),
	LightSkyBlue: fromRgb([
		.53,
		.808,
		.98
	]),
	LightSlateBlue: fromRgb([
		.518,
		.44,
		1
	]),
	LightSlateGray: fromRgb([
		.468,
		.532,
		.6
	]),
	LightSlateGrey: fromRgb([
		.468,
		.532,
		.6
	]),
	LightSteelBlue: fromRgb([
		.69,
		.77,
		.87
	]),
	LightYellow: fromRgb([
		1,
		1,
		.88
	]),
	Lime: fromRgb([
		0,
		1,
		0
	]),
	LimeGreen: fromRgb([
		.196,
		.804,
		.196
	]),
	Linen: fromRgb([
		.98,
		.94,
		.9
	]),
	Magenta: fromRgb([
		1,
		0,
		1
	]),
	Maroon: fromRgb([
		.5,
		0,
		0
	]),
	MediumAquamarine: fromRgb([
		.4,
		.804,
		.668
	]),
	MediumBlue: fromRgb([
		0,
		0,
		.804
	]),
	MediumOrchid: fromRgb([
		.73,
		.332,
		.828
	]),
	MediumPurple: fromRgb([
		.576,
		.44,
		.86
	]),
	MediumSeaGreen: fromRgb([
		.235,
		.7,
		.444
	]),
	MediumSlateBlue: fromRgb([
		.484,
		.408,
		.932
	]),
	MediumSpringGreen: fromRgb([
		0,
		.98,
		.604
	]),
	MediumTurquoise: fromRgb([
		.284,
		.82,
		.8
	]),
	MediumVioletRed: fromRgb([
		.78,
		.084,
		.52
	]),
	MidnightBlue: fromRgb([
		.098,
		.098,
		.44
	]),
	MintCream: fromRgb([
		.96,
		1,
		.98
	]),
	MistyRose: fromRgb([
		1,
		.894,
		.884
	]),
	Moccasin: fromRgb([
		1,
		.894,
		.71
	]),
	NavajoWhite: fromRgb([
		1,
		.87,
		.68
	]),
	Navy: fromRgb([
		0,
		0,
		.5
	]),
	NavyBlue: fromRgb([
		0,
		0,
		.5
	]),
	OldLace: fromRgb([
		.992,
		.96,
		.9
	]),
	Olive: fromRgb([
		.5,
		.5,
		0
	]),
	OliveDrab: fromRgb([
		.42,
		.556,
		.136
	]),
	Orange: fromRgb([
		1,
		.648,
		0
	]),
	OrangeRed: fromRgb([
		1,
		.27,
		0
	]),
	Orchid: fromRgb([
		.855,
		.44,
		.84
	]),
	PaleGoldenrod: fromRgb([
		.932,
		.91,
		.668
	]),
	PaleGreen: fromRgb([
		.596,
		.985,
		.596
	]),
	PaleTurquoise: fromRgb([
		.688,
		.932,
		.932
	]),
	PaleVioletRed: fromRgb([
		.86,
		.44,
		.576
	]),
	PapayaWhip: fromRgb([
		1,
		.936,
		.835
	]),
	PeachPuff: fromRgb([
		1,
		.855,
		.725
	]),
	Peru: fromRgb([
		.804,
		.52,
		.248
	]),
	Pink: fromRgb([
		1,
		.752,
		.796
	]),
	Plum: fromRgb([
		.868,
		.628,
		.868
	]),
	PowderBlue: fromRgb([
		.69,
		.88,
		.9
	]),
	Purple: fromRgb([
		.5,
		0,
		.5
	]),
	Red: fromRgb([
		1,
		0,
		0
	]),
	RosyBrown: fromRgb([
		.736,
		.56,
		.56
	]),
	RoyalBlue: fromRgb([
		.255,
		.41,
		.884
	]),
	SaddleBrown: fromRgb([
		.545,
		.27,
		.075
	]),
	Salmon: fromRgb([
		.98,
		.5,
		.448
	]),
	SandyBrown: fromRgb([
		.956,
		.644,
		.376
	]),
	SeaGreen: fromRgb([
		.18,
		.545,
		.34
	]),
	Seashell: fromRgb([
		1,
		.96,
		.932
	]),
	Sienna: fromRgb([
		.628,
		.32,
		.176
	]),
	Silver: fromRgb([
		.752,
		.752,
		.752
	]),
	SkyBlue: fromRgb([
		.53,
		.808,
		.92
	]),
	SlateBlue: fromRgb([
		.415,
		.352,
		.804
	]),
	SlateGray: fromRgb([
		.44,
		.5,
		.565
	]),
	SlateGrey: fromRgb([
		.44,
		.5,
		.565
	]),
	Snow: fromRgb([
		1,
		.98,
		.98
	]),
	SpringGreen: fromRgb([
		0,
		1,
		.498
	]),
	SteelBlue: fromRgb([
		.275,
		.51,
		.705
	]),
	Tan: fromRgb([
		.824,
		.705,
		.55
	]),
	Teal: fromRgb([
		0,
		.5,
		.5
	]),
	Thistle: fromRgb([
		.848,
		.75,
		.848
	]),
	Tomato: fromRgb([
		1,
		.39,
		.28
	]),
	Turquoise: fromRgb([
		.25,
		.88,
		.815
	]),
	Violet: fromRgb([
		.932,
		.51,
		.932
	]),
	VioletRed: fromRgb([
		.816,
		.125,
		.565
	]),
	Wheat: fromRgb([
		.96,
		.87,
		.7
	]),
	White: fromRgb([
		1,
		1,
		1
	]),
	WhiteSmoke: fromRgb([
		.96,
		.96,
		.96
	]),
	Yellow: fromRgb([
		1,
		1,
		0
	]),
	YellowGreen: fromRgb([
		.604,
		.804,
		.196
	])
};
var X11_NAMES = {
	AntiqueWhite1: fromRgb([
		1,
		.936,
		.86
	]),
	AntiqueWhite2: fromRgb([
		.932,
		.875,
		.8
	]),
	AntiqueWhite3: fromRgb([
		.804,
		.752,
		.69
	]),
	AntiqueWhite4: fromRgb([
		.545,
		.512,
		.47
	]),
	Aquamarine1: fromRgb([
		.498,
		1,
		.83
	]),
	Aquamarine2: fromRgb([
		.464,
		.932,
		.776
	]),
	Aquamarine3: fromRgb([
		.4,
		.804,
		.668
	]),
	Aquamarine4: fromRgb([
		.27,
		.545,
		.455
	]),
	Azure1: fromRgb([
		.94,
		1,
		1
	]),
	Azure2: fromRgb([
		.88,
		.932,
		.932
	]),
	Azure3: fromRgb([
		.756,
		.804,
		.804
	]),
	Azure4: fromRgb([
		.512,
		.545,
		.545
	]),
	Bisque1: fromRgb([
		1,
		.894,
		.77
	]),
	Bisque2: fromRgb([
		.932,
		.835,
		.716
	]),
	Bisque3: fromRgb([
		.804,
		.716,
		.62
	]),
	Bisque4: fromRgb([
		.545,
		.49,
		.42
	]),
	Blue1: fromRgb([
		0,
		0,
		1
	]),
	Blue2: fromRgb([
		0,
		0,
		.932
	]),
	Blue3: fromRgb([
		0,
		0,
		.804
	]),
	Blue4: fromRgb([
		0,
		0,
		.545
	]),
	Brown1: fromRgb([
		1,
		.25,
		.25
	]),
	Brown2: fromRgb([
		.932,
		.23,
		.23
	]),
	Brown3: fromRgb([
		.804,
		.2,
		.2
	]),
	Brown4: fromRgb([
		.545,
		.136,
		.136
	]),
	Burlywood1: fromRgb([
		1,
		.828,
		.608
	]),
	Burlywood2: fromRgb([
		.932,
		.772,
		.57
	]),
	Burlywood3: fromRgb([
		.804,
		.668,
		.49
	]),
	Burlywood4: fromRgb([
		.545,
		.45,
		.332
	]),
	CadetBlue1: fromRgb([
		.596,
		.96,
		1
	]),
	CadetBlue2: fromRgb([
		.556,
		.898,
		.932
	]),
	CadetBlue3: fromRgb([
		.48,
		.772,
		.804
	]),
	CadetBlue4: fromRgb([
		.325,
		.525,
		.545
	]),
	Chartreuse1: fromRgb([
		.498,
		1,
		0
	]),
	Chartreuse2: fromRgb([
		.464,
		.932,
		0
	]),
	Chartreuse3: fromRgb([
		.4,
		.804,
		0
	]),
	Chartreuse4: fromRgb([
		.27,
		.545,
		0
	]),
	Chocolate1: fromRgb([
		1,
		.498,
		.14
	]),
	Chocolate2: fromRgb([
		.932,
		.464,
		.13
	]),
	Chocolate3: fromRgb([
		.804,
		.4,
		.112
	]),
	Chocolate4: fromRgb([
		.545,
		.27,
		.075
	]),
	Coral1: fromRgb([
		1,
		.448,
		.336
	]),
	Coral2: fromRgb([
		.932,
		.415,
		.312
	]),
	Coral3: fromRgb([
		.804,
		.356,
		.27
	]),
	Coral4: fromRgb([
		.545,
		.244,
		.185
	]),
	Cornsilk1: fromRgb([
		1,
		.972,
		.864
	]),
	Cornsilk2: fromRgb([
		.932,
		.91,
		.804
	]),
	Cornsilk3: fromRgb([
		.804,
		.785,
		.694
	]),
	Cornsilk4: fromRgb([
		.545,
		.532,
		.47
	]),
	Cyan1: fromRgb([
		0,
		1,
		1
	]),
	Cyan2: fromRgb([
		0,
		.932,
		.932
	]),
	Cyan3: fromRgb([
		0,
		.804,
		.804
	]),
	Cyan4: fromRgb([
		0,
		.545,
		.545
	]),
	DarkGoldenrod1: fromRgb([
		1,
		.725,
		.06
	]),
	DarkGoldenrod2: fromRgb([
		.932,
		.68,
		.055
	]),
	DarkGoldenrod3: fromRgb([
		.804,
		.585,
		.048
	]),
	DarkGoldenrod4: fromRgb([
		.545,
		.396,
		.03
	]),
	DarkOliveGreen1: fromRgb([
		.792,
		1,
		.44
	]),
	DarkOliveGreen2: fromRgb([
		.736,
		.932,
		.408
	]),
	DarkOliveGreen3: fromRgb([
		.635,
		.804,
		.352
	]),
	DarkOliveGreen4: fromRgb([
		.43,
		.545,
		.24
	]),
	DarkOrange1: fromRgb([
		1,
		.498,
		0
	]),
	DarkOrange2: fromRgb([
		.932,
		.464,
		0
	]),
	DarkOrange3: fromRgb([
		.804,
		.4,
		0
	]),
	DarkOrange4: fromRgb([
		.545,
		.27,
		0
	]),
	DarkOrchid1: fromRgb([
		.75,
		.244,
		1
	]),
	DarkOrchid2: fromRgb([
		.698,
		.228,
		.932
	]),
	DarkOrchid3: fromRgb([
		.604,
		.196,
		.804
	]),
	DarkOrchid4: fromRgb([
		.408,
		.132,
		.545
	]),
	DarkSeaGreen1: fromRgb([
		.756,
		1,
		.756
	]),
	DarkSeaGreen2: fromRgb([
		.705,
		.932,
		.705
	]),
	DarkSeaGreen3: fromRgb([
		.608,
		.804,
		.608
	]),
	DarkSeaGreen4: fromRgb([
		.41,
		.545,
		.41
	]),
	DarkSlateGray1: fromRgb([
		.592,
		1,
		1
	]),
	DarkSlateGray2: fromRgb([
		.552,
		.932,
		.932
	]),
	DarkSlateGray3: fromRgb([
		.475,
		.804,
		.804
	]),
	DarkSlateGray4: fromRgb([
		.32,
		.545,
		.545
	]),
	DeepPink1: fromRgb([
		1,
		.08,
		.576
	]),
	DeepPink2: fromRgb([
		.932,
		.07,
		.536
	]),
	DeepPink3: fromRgb([
		.804,
		.064,
		.464
	]),
	DeepPink4: fromRgb([
		.545,
		.04,
		.312
	]),
	DeepSkyBlue1: fromRgb([
		0,
		.75,
		1
	]),
	DeepSkyBlue2: fromRgb([
		0,
		.698,
		.932
	]),
	DeepSkyBlue3: fromRgb([
		0,
		.604,
		.804
	]),
	DeepSkyBlue4: fromRgb([
		0,
		.408,
		.545
	]),
	DodgerBlue1: fromRgb([
		.116,
		.565,
		1
	]),
	DodgerBlue2: fromRgb([
		.11,
		.525,
		.932
	]),
	DodgerBlue3: fromRgb([
		.094,
		.455,
		.804
	]),
	DodgerBlue4: fromRgb([
		.064,
		.305,
		.545
	]),
	Firebrick1: fromRgb([
		1,
		.19,
		.19
	]),
	Firebrick2: fromRgb([
		.932,
		.172,
		.172
	]),
	Firebrick3: fromRgb([
		.804,
		.15,
		.15
	]),
	Firebrick4: fromRgb([
		.545,
		.1,
		.1
	]),
	Gold1: fromRgb([
		1,
		.844,
		0
	]),
	Gold2: fromRgb([
		.932,
		.79,
		0
	]),
	Gold3: fromRgb([
		.804,
		.68,
		0
	]),
	Gold4: fromRgb([
		.545,
		.46,
		0
	]),
	Goldenrod1: fromRgb([
		1,
		.756,
		.145
	]),
	Goldenrod2: fromRgb([
		.932,
		.705,
		.132
	]),
	Goldenrod3: fromRgb([
		.804,
		.608,
		.112
	]),
	Goldenrod4: fromRgb([
		.545,
		.41,
		.08
	]),
	Green1: fromRgb([
		0,
		1,
		0
	]),
	Green2: fromRgb([
		0,
		.932,
		0
	]),
	Green3: fromRgb([
		0,
		.804,
		0
	]),
	Green4: fromRgb([
		0,
		.545,
		0
	]),
	Honeydew1: fromRgb([
		.94,
		1,
		.94
	]),
	Honeydew2: fromRgb([
		.88,
		.932,
		.88
	]),
	Honeydew3: fromRgb([
		.756,
		.804,
		.756
	]),
	Honeydew4: fromRgb([
		.512,
		.545,
		.512
	]),
	HotPink1: fromRgb([
		1,
		.43,
		.705
	]),
	HotPink2: fromRgb([
		.932,
		.415,
		.655
	]),
	HotPink3: fromRgb([
		.804,
		.376,
		.565
	]),
	HotPink4: fromRgb([
		.545,
		.228,
		.385
	]),
	IndianRed1: fromRgb([
		1,
		.415,
		.415
	]),
	IndianRed2: fromRgb([
		.932,
		.39,
		.39
	]),
	IndianRed3: fromRgb([
		.804,
		.332,
		.332
	]),
	IndianRed4: fromRgb([
		.545,
		.228,
		.228
	]),
	Ivory1: fromRgb([
		1,
		1,
		.94
	]),
	Ivory2: fromRgb([
		.932,
		.932,
		.88
	]),
	Ivory3: fromRgb([
		.804,
		.804,
		.756
	]),
	Ivory4: fromRgb([
		.545,
		.545,
		.512
	]),
	Khaki1: fromRgb([
		1,
		.965,
		.56
	]),
	Khaki2: fromRgb([
		.932,
		.9,
		.52
	]),
	Khaki3: fromRgb([
		.804,
		.776,
		.45
	]),
	Khaki4: fromRgb([
		.545,
		.525,
		.305
	]),
	LavenderBlush1: fromRgb([
		1,
		.94,
		.96
	]),
	LavenderBlush2: fromRgb([
		.932,
		.88,
		.898
	]),
	LavenderBlush3: fromRgb([
		.804,
		.756,
		.772
	]),
	LavenderBlush4: fromRgb([
		.545,
		.512,
		.525
	]),
	LemonChiffon1: fromRgb([
		1,
		.98,
		.804
	]),
	LemonChiffon2: fromRgb([
		.932,
		.912,
		.75
	]),
	LemonChiffon3: fromRgb([
		.804,
		.79,
		.648
	]),
	LemonChiffon4: fromRgb([
		.545,
		.536,
		.44
	]),
	LightBlue1: fromRgb([
		.75,
		.936,
		1
	]),
	LightBlue2: fromRgb([
		.698,
		.875,
		.932
	]),
	LightBlue3: fromRgb([
		.604,
		.752,
		.804
	]),
	LightBlue4: fromRgb([
		.408,
		.512,
		.545
	]),
	LightCyan1: fromRgb([
		.88,
		1,
		1
	]),
	LightCyan2: fromRgb([
		.82,
		.932,
		.932
	]),
	LightCyan3: fromRgb([
		.705,
		.804,
		.804
	]),
	LightCyan4: fromRgb([
		.48,
		.545,
		.545
	]),
	LightGoldenrod1: fromRgb([
		1,
		.925,
		.545
	]),
	LightGoldenrod2: fromRgb([
		.932,
		.864,
		.51
	]),
	LightGoldenrod3: fromRgb([
		.804,
		.745,
		.44
	]),
	LightGoldenrod4: fromRgb([
		.545,
		.505,
		.298
	]),
	LightPink1: fromRgb([
		1,
		.684,
		.725
	]),
	LightPink2: fromRgb([
		.932,
		.635,
		.68
	]),
	LightPink3: fromRgb([
		.804,
		.55,
		.585
	]),
	LightPink4: fromRgb([
		.545,
		.372,
		.396
	]),
	LightSalmon1: fromRgb([
		1,
		.628,
		.48
	]),
	LightSalmon2: fromRgb([
		.932,
		.585,
		.448
	]),
	LightSalmon3: fromRgb([
		.804,
		.505,
		.385
	]),
	LightSalmon4: fromRgb([
		.545,
		.34,
		.26
	]),
	LightSkyBlue1: fromRgb([
		.69,
		.888,
		1
	]),
	LightSkyBlue2: fromRgb([
		.644,
		.828,
		.932
	]),
	LightSkyBlue3: fromRgb([
		.552,
		.712,
		.804
	]),
	LightSkyBlue4: fromRgb([
		.376,
		.484,
		.545
	]),
	LightSteelBlue1: fromRgb([
		.792,
		.884,
		1
	]),
	LightSteelBlue2: fromRgb([
		.736,
		.824,
		.932
	]),
	LightSteelBlue3: fromRgb([
		.635,
		.71,
		.804
	]),
	LightSteelBlue4: fromRgb([
		.43,
		.484,
		.545
	]),
	LightYellow1: fromRgb([
		1,
		1,
		.88
	]),
	LightYellow2: fromRgb([
		.932,
		.932,
		.82
	]),
	LightYellow3: fromRgb([
		.804,
		.804,
		.705
	]),
	LightYellow4: fromRgb([
		.545,
		.545,
		.48
	]),
	Magenta1: fromRgb([
		1,
		0,
		1
	]),
	Magenta2: fromRgb([
		.932,
		0,
		.932
	]),
	Magenta3: fromRgb([
		.804,
		0,
		.804
	]),
	Magenta4: fromRgb([
		.545,
		0,
		.545
	]),
	Maroon1: fromRgb([
		1,
		.204,
		.7
	]),
	Maroon2: fromRgb([
		.932,
		.19,
		.655
	]),
	Maroon3: fromRgb([
		.804,
		.16,
		.565
	]),
	Maroon4: fromRgb([
		.545,
		.11,
		.385
	]),
	MediumOrchid1: fromRgb([
		.88,
		.4,
		1
	]),
	MediumOrchid2: fromRgb([
		.82,
		.372,
		.932
	]),
	MediumOrchid3: fromRgb([
		.705,
		.32,
		.804
	]),
	MediumOrchid4: fromRgb([
		.48,
		.215,
		.545
	]),
	MediumPurple1: fromRgb([
		.67,
		.51,
		1
	]),
	MediumPurple2: fromRgb([
		.624,
		.475,
		.932
	]),
	MediumPurple3: fromRgb([
		.536,
		.408,
		.804
	]),
	MediumPurple4: fromRgb([
		.365,
		.28,
		.545
	]),
	MistyRose1: fromRgb([
		1,
		.894,
		.884
	]),
	MistyRose2: fromRgb([
		.932,
		.835,
		.824
	]),
	MistyRose3: fromRgb([
		.804,
		.716,
		.71
	]),
	MistyRose4: fromRgb([
		.545,
		.49,
		.484
	]),
	NavajoWhite1: fromRgb([
		1,
		.87,
		.68
	]),
	NavajoWhite2: fromRgb([
		.932,
		.81,
		.63
	]),
	NavajoWhite3: fromRgb([
		.804,
		.7,
		.545
	]),
	NavajoWhite4: fromRgb([
		.545,
		.475,
		.37
	]),
	OliveDrab1: fromRgb([
		.752,
		1,
		.244
	]),
	OliveDrab2: fromRgb([
		.7,
		.932,
		.228
	]),
	OliveDrab3: fromRgb([
		.604,
		.804,
		.196
	]),
	OliveDrab4: fromRgb([
		.41,
		.545,
		.132
	]),
	Orange1: fromRgb([
		1,
		.648,
		0
	]),
	Orange2: fromRgb([
		.932,
		.604,
		0
	]),
	Orange3: fromRgb([
		.804,
		.52,
		0
	]),
	Orange4: fromRgb([
		.545,
		.352,
		0
	]),
	OrangeRed1: fromRgb([
		1,
		.27,
		0
	]),
	OrangeRed2: fromRgb([
		.932,
		.25,
		0
	]),
	OrangeRed3: fromRgb([
		.804,
		.215,
		0
	]),
	OrangeRed4: fromRgb([
		.545,
		.145,
		0
	]),
	Orchid1: fromRgb([
		1,
		.512,
		.98
	]),
	Orchid2: fromRgb([
		.932,
		.48,
		.912
	]),
	Orchid3: fromRgb([
		.804,
		.41,
		.79
	]),
	Orchid4: fromRgb([
		.545,
		.28,
		.536
	]),
	PaleGreen1: fromRgb([
		.604,
		1,
		.604
	]),
	PaleGreen2: fromRgb([
		.565,
		.932,
		.565
	]),
	PaleGreen3: fromRgb([
		.488,
		.804,
		.488
	]),
	PaleGreen4: fromRgb([
		.33,
		.545,
		.33
	]),
	PaleTurquoise1: fromRgb([
		.732,
		1,
		1
	]),
	PaleTurquoise2: fromRgb([
		.684,
		.932,
		.932
	]),
	PaleTurquoise3: fromRgb([
		.59,
		.804,
		.804
	]),
	PaleTurquoise4: fromRgb([
		.4,
		.545,
		.545
	]),
	PaleVioletRed1: fromRgb([
		1,
		.51,
		.67
	]),
	PaleVioletRed2: fromRgb([
		.932,
		.475,
		.624
	]),
	PaleVioletRed3: fromRgb([
		.804,
		.408,
		.536
	]),
	PaleVioletRed4: fromRgb([
		.545,
		.28,
		.365
	]),
	PeachPuff1: fromRgb([
		1,
		.855,
		.725
	]),
	PeachPuff2: fromRgb([
		.932,
		.796,
		.68
	]),
	PeachPuff3: fromRgb([
		.804,
		.688,
		.585
	]),
	PeachPuff4: fromRgb([
		.545,
		.468,
		.396
	]),
	Pink1: fromRgb([
		1,
		.71,
		.772
	]),
	Pink2: fromRgb([
		.932,
		.664,
		.72
	]),
	Pink3: fromRgb([
		.804,
		.57,
		.62
	]),
	Pink4: fromRgb([
		.545,
		.39,
		.424
	]),
	Plum1: fromRgb([
		1,
		.732,
		1
	]),
	Plum2: fromRgb([
		.932,
		.684,
		.932
	]),
	Plum3: fromRgb([
		.804,
		.59,
		.804
	]),
	Plum4: fromRgb([
		.545,
		.4,
		.545
	]),
	Purple1: fromRgb([
		.608,
		.19,
		1
	]),
	Purple2: fromRgb([
		.57,
		.172,
		.932
	]),
	Purple3: fromRgb([
		.49,
		.15,
		.804
	]),
	Purple4: fromRgb([
		.332,
		.1,
		.545
	]),
	Red1: fromRgb([
		1,
		0,
		0
	]),
	Red2: fromRgb([
		.932,
		0,
		0
	]),
	Red3: fromRgb([
		.804,
		0,
		0
	]),
	Red4: fromRgb([
		.545,
		0,
		0
	]),
	RosyBrown1: fromRgb([
		1,
		.756,
		.756
	]),
	RosyBrown2: fromRgb([
		.932,
		.705,
		.705
	]),
	RosyBrown3: fromRgb([
		.804,
		.608,
		.608
	]),
	RosyBrown4: fromRgb([
		.545,
		.41,
		.41
	]),
	RoyalBlue1: fromRgb([
		.284,
		.464,
		1
	]),
	RoyalBlue2: fromRgb([
		.264,
		.43,
		.932
	]),
	RoyalBlue3: fromRgb([
		.228,
		.372,
		.804
	]),
	RoyalBlue4: fromRgb([
		.152,
		.25,
		.545
	]),
	Salmon1: fromRgb([
		1,
		.55,
		.41
	]),
	Salmon2: fromRgb([
		.932,
		.51,
		.385
	]),
	Salmon3: fromRgb([
		.804,
		.44,
		.33
	]),
	Salmon4: fromRgb([
		.545,
		.298,
		.224
	]),
	SeaGreen1: fromRgb([
		.33,
		1,
		.624
	]),
	SeaGreen2: fromRgb([
		.305,
		.932,
		.58
	]),
	SeaGreen3: fromRgb([
		.264,
		.804,
		.5
	]),
	SeaGreen4: fromRgb([
		.18,
		.545,
		.34
	]),
	Seashell1: fromRgb([
		1,
		.96,
		.932
	]),
	Seashell2: fromRgb([
		.932,
		.898,
		.87
	]),
	Seashell3: fromRgb([
		.804,
		.772,
		.75
	]),
	Seashell4: fromRgb([
		.545,
		.525,
		.51
	]),
	Sienna1: fromRgb([
		1,
		.51,
		.28
	]),
	Sienna2: fromRgb([
		.932,
		.475,
		.26
	]),
	Sienna3: fromRgb([
		.804,
		.408,
		.224
	]),
	Sienna4: fromRgb([
		.545,
		.28,
		.15
	]),
	SkyBlue1: fromRgb([
		.53,
		.808,
		1
	]),
	SkyBlue2: fromRgb([
		.494,
		.752,
		.932
	]),
	SkyBlue3: fromRgb([
		.424,
		.65,
		.804
	]),
	SkyBlue4: fromRgb([
		.29,
		.44,
		.545
	]),
	SlateBlue1: fromRgb([
		.512,
		.435,
		1
	]),
	SlateBlue2: fromRgb([
		.48,
		.404,
		.932
	]),
	SlateBlue3: fromRgb([
		.41,
		.35,
		.804
	]),
	SlateBlue4: fromRgb([
		.28,
		.235,
		.545
	]),
	SlateGray1: fromRgb([
		.776,
		.888,
		1
	]),
	SlateGray2: fromRgb([
		.725,
		.828,
		.932
	]),
	SlateGray3: fromRgb([
		.624,
		.712,
		.804
	]),
	SlateGray4: fromRgb([
		.424,
		.484,
		.545
	]),
	Snow1: fromRgb([
		1,
		.98,
		.98
	]),
	Snow2: fromRgb([
		.932,
		.912,
		.912
	]),
	Snow3: fromRgb([
		.804,
		.79,
		.79
	]),
	Snow4: fromRgb([
		.545,
		.536,
		.536
	]),
	SpringGreen1: fromRgb([
		0,
		1,
		.498
	]),
	SpringGreen2: fromRgb([
		0,
		.932,
		.464
	]),
	SpringGreen3: fromRgb([
		0,
		.804,
		.4
	]),
	SpringGreen4: fromRgb([
		0,
		.545,
		.27
	]),
	SteelBlue1: fromRgb([
		.39,
		.72,
		1
	]),
	SteelBlue2: fromRgb([
		.36,
		.675,
		.932
	]),
	SteelBlue3: fromRgb([
		.31,
		.58,
		.804
	]),
	SteelBlue4: fromRgb([
		.21,
		.392,
		.545
	]),
	Tan1: fromRgb([
		1,
		.648,
		.31
	]),
	Tan2: fromRgb([
		.932,
		.604,
		.288
	]),
	Tan3: fromRgb([
		.804,
		.52,
		.248
	]),
	Tan4: fromRgb([
		.545,
		.352,
		.17
	]),
	Thistle1: fromRgb([
		1,
		.884,
		1
	]),
	Thistle2: fromRgb([
		.932,
		.824,
		.932
	]),
	Thistle3: fromRgb([
		.804,
		.71,
		.804
	]),
	Thistle4: fromRgb([
		.545,
		.484,
		.545
	]),
	Tomato1: fromRgb([
		1,
		.39,
		.28
	]),
	Tomato2: fromRgb([
		.932,
		.36,
		.26
	]),
	Tomato3: fromRgb([
		.804,
		.31,
		.224
	]),
	Tomato4: fromRgb([
		.545,
		.21,
		.15
	]),
	Turquoise1: fromRgb([
		0,
		.96,
		1
	]),
	Turquoise2: fromRgb([
		0,
		.898,
		.932
	]),
	Turquoise3: fromRgb([
		0,
		.772,
		.804
	]),
	Turquoise4: fromRgb([
		0,
		.525,
		.545
	]),
	VioletRed1: fromRgb([
		1,
		.244,
		.59
	]),
	VioletRed2: fromRgb([
		.932,
		.228,
		.55
	]),
	VioletRed3: fromRgb([
		.804,
		.196,
		.47
	]),
	VioletRed4: fromRgb([
		.545,
		.132,
		.32
	]),
	Wheat1: fromRgb([
		1,
		.905,
		.73
	]),
	Wheat2: fromRgb([
		.932,
		.848,
		.684
	]),
	Wheat3: fromRgb([
		.804,
		.73,
		.59
	]),
	Wheat4: fromRgb([
		.545,
		.494,
		.4
	]),
	Yellow1: fromRgb([
		1,
		1,
		0
	]),
	Yellow2: fromRgb([
		.932,
		.932,
		0
	]),
	Yellow3: fromRgb([
		.804,
		.804,
		0
	]),
	Yellow4: fromRgb([
		.545,
		.545,
		0
	]),
	Gray0: fromRgb([
		.745,
		.745,
		.745
	]),
	Green0: fromRgb([
		0,
		1,
		0
	]),
	Grey0: fromRgb([
		.745,
		.745,
		.745
	]),
	Maroon0: fromRgb([
		.69,
		.19,
		.376
	]),
	Purple0: fromRgb([
		.628,
		.125,
		.94
	])
};
//#endregion
//#region package/xcolor/libs/parser.ts
var parseCache = {};
/**
* Parse an `xparse` argument specification string to an AST.
* This function caches results. Don't mutate the returned AST!
*
* @param {string} [str=""] - LaTeX string input
* @returns - AST for LaTeX string
*/
function parse(str = "") {
	parseCache[str] = parseCache[str] || XColorPegParser.parse(str);
	return parseCache[str];
}
//#endregion
//#region package/xcolor/libs/xcolor.ts
var CORE_MODELS = new Set([
	"rgb",
	"cmy",
	"cmyk",
	"hsb",
	"gray"
]);
var XColorCoreModelToColor = {
	rgb: ([r, g, b]) => Color([
		r * 255,
		g * 255,
		b * 255
	], "rgb"),
	cmy: ([c, m, y]) => XColorCoreModelToColor.rgb([
		1 - c,
		1 - m,
		1 - y
	]),
	cmyk: ([c, m, y, k]) => Color([
		c * 255,
		m * 255,
		y * 255,
		k * 100
	], "cmyk"),
	hsb: ([h, s, b]) => Color([
		h * 360,
		s * 100,
		b * 100
	], "hsv"),
	gray: ([v]) => Color([
		v * 255,
		v * 255,
		v * 255
	], "rgb")
};
var XColorModelToColor = {
	wave: ([lambda]) => {
		const gamma = .8;
		let baseRgb = [
			0,
			0,
			0
		];
		if (380 <= lambda && lambda < 440) baseRgb = [
			(440 - lambda) / 60,
			0,
			1
		];
		if (440 <= lambda && lambda < 490) baseRgb = [
			0,
			(lambda - 440) / 50,
			1
		];
		if (490 <= lambda && lambda < 510) baseRgb = [
			0,
			1,
			(510 - lambda) / 20
		];
		if (510 <= lambda && lambda < 580) baseRgb = [
			(lambda - 510) / 70,
			1,
			0
		];
		if (580 <= lambda && lambda < 6450) baseRgb = [
			1,
			(645 - lambda) / 65,
			0
		];
		if (645 <= lambda && lambda <= 780) baseRgb = [
			1,
			0,
			0
		];
		let f = 1;
		if (380 <= lambda && 420 < lambda) f = .3 + .7 * (lambda - 380) / 40;
		if (700 < lambda && lambda <= 780) f = .3 + .7 * (780 - lambda) / 80;
		const rgb = [
			Math.pow(baseRgb[0] * f, gamma),
			Math.pow(baseRgb[1] * f, gamma),
			Math.pow(baseRgb[2] * f, gamma)
		];
		return Color([
			rgb[0] * 255,
			rgb[1] * 255,
			rgb[2] * 255
		], "rgb");
	},
	Hsb: ([h, s, b]) => XColorCoreModelToColor.hsb([
		h / 360,
		s,
		b
	]),
	HSB: ([h, s, b]) => XColorCoreModelToColor.hsb([
		h / 240,
		s / 240,
		b / 240
	]),
	HTML: ([v]) => v.startsWith("#") ? Color(v) : Color(`#${v}`),
	RGB: ([r, g, b]) => Color([
		r,
		g,
		b
	], "rgb"),
	Gray: ([v]) => XColorCoreModelToColor.gray([v / 15]),
	...XColorCoreModelToColor
};
var ColorToXColorModel = {
	rgb: (color) => color.rgb().array().map((v) => v / 255),
	cmy: (color) => [
		255 - color.red(),
		255 - color.green(),
		255 - color.blue()
	].map((v) => v / 255),
	cmyk: (color) => color.cmyk().array().map((v, i) => i === 3 ? v / 100 : v / 255),
	hsb: (color) => [
		color.hue() / 360,
		color.saturationv() / 100,
		color.value() / 100
	],
	gray: (color) => [color.gray() / 100]
};
var PREDEFINED_XCOLOR_COLORS = {
	red: XColorCoreModelToColor.rgb([
		1,
		0,
		0
	]),
	green: XColorCoreModelToColor.rgb([
		0,
		1,
		0
	]),
	blue: XColorCoreModelToColor.rgb([
		0,
		0,
		1
	]),
	brown: XColorCoreModelToColor.rgb([
		.75,
		.5,
		.25
	]),
	lime: XColorCoreModelToColor.rgb([
		.75,
		1,
		0
	]),
	orange: XColorCoreModelToColor.rgb([
		1,
		.5,
		0
	]),
	pink: XColorCoreModelToColor.rgb([
		1,
		.75,
		.75
	]),
	purple: XColorCoreModelToColor.rgb([
		.75,
		0,
		.25
	]),
	teal: XColorCoreModelToColor.rgb([
		0,
		.5,
		.5
	]),
	violet: XColorCoreModelToColor.rgb([
		.5,
		0,
		.5
	]),
	cyan: XColorCoreModelToColor.rgb([
		0,
		1,
		1
	]),
	magenta: XColorCoreModelToColor.rgb([
		1,
		0,
		1
	]),
	yellow: XColorCoreModelToColor.rgb([
		1,
		1,
		0
	]),
	olive: XColorCoreModelToColor.rgb([
		.5,
		.5,
		0
	]),
	black: XColorCoreModelToColor.rgb([
		0,
		0,
		0
	]),
	darkgray: XColorCoreModelToColor.rgb([
		.25,
		.25,
		.25
	]),
	gray: XColorCoreModelToColor.rgb([
		.5,
		.5,
		.5
	]),
	lightgray: XColorCoreModelToColor.rgb([
		.75,
		.75,
		.75
	]),
	white: XColorCoreModelToColor.rgb([
		1,
		1,
		1
	]),
	...DVI_PS_NAMES,
	...SVG_NAMES,
	...X11_NAMES
};
function scalarMul(scalar, vec) {
	return vec.map((v) => scalar * v);
}
function addVectors(...vecs) {
	return vecs.reduce((prev, current) => prev.map((v, i) => v + current[i]));
}
/**
* Mix a color in color model `model` as per the algorithm in 2.3.3 of the xcolor manual.
*/
function mixInModel(model, colorsAndCoefficients) {
	if (!CORE_MODELS.has(model)) throw new Error(`Cannot mix colors in model "${model}"; only core modes ${Array.from(CORE_MODELS).join(", ")} are supported`);
	const toModel = ColorToXColorModel[model];
	const fromModel = XColorCoreModelToColor[model];
	return fromModel(addVectors(...colorsAndCoefficients.map(([v, color]) => {
		return scalarMul(v, toModel(color));
	})));
}
/**
* Given a parsed `XColor`, compute the color and return a `Color` object
* (that can be used in CSS, for example).
*/
function computeColor(expr, predefinedColors = {}) {
	if (expr.type !== "color") throw new Error(`Can only compute the color of a "color" expression, not one of type ${expr.type}`);
	const knownColors = {
		...PREDEFINED_XCOLOR_COLORS,
		...predefinedColors
	};
	function getColor(name) {
		if (!knownColors[name]) throw new Error(`Unknown color "${name}"`);
		return knownColors[name];
	}
	const color = expr.color;
	let computedColor = Color("#000000");
	if (color.type === "expr") {
		let base = getColor(color.name);
		for (const mix of color.mix_expr) if (mix.type === "complete_mix") {
			const mixColor = getColor(mix.name);
			base = base.mix(mixColor, 1 - mix.mix_percent / 100);
		} else if (mix.type === "partial_mix") base = base.mix(Color("#FFFFFF"), 1 - mix.mix_percent / 100);
		if (color.prefix && color.prefix.length % 2 === 1) base = base.rotate(180);
		computedColor = base;
	}
	if (color.type === "extended_expr") {
		const model = color.core_model;
		const div = color.div || color.expressions.reduce((a, expr) => a + expr.weight, 0);
		if (div <= 0) throw new Error(`Cannot mix color with ratios that have a denominator of ${div}`);
		computedColor = mixInModel(model, color.expressions.map((expr) => [expr.weight / div, computeColor({
			type: "color",
			color: expr.color,
			functions: []
		})]));
	}
	for (const func of expr.functions) {
		if (func.name === "wheel") {
			const angle = func.args[0];
			const circ = func.args[1] || 360;
			computedColor = computedColor.rotate(angle / circ * 360);
		}
		if (func.name === "twheel") {
			const angle = func.args[0];
			const circ = func.args[1] || 360;
			computedColor = computedColor.rotate(angle / circ * 360 + 60);
		}
	}
	return computedColor;
}
/**
* Convert the xcolor defined color to RGB Hex representation.
* If the color is unknown or cannot be computed, `null` is returned.
*
* If `model` is supplied,
*
* The most likely reason a color will be `null` is if the color is defined
* using a pre-defined color that wasn't supplied as an argument.
*/
function xcolorColorToHex(color, model, options = { predefinedColors: {} }) {
	const { predefinedColors = {} } = options;
	const parsed = parse(color);
	if (model && model !== "default" && parsed.type !== "color") {
		if (!(model in XColorModelToColor)) throw new Error(`Unknown color model "${model}"; known models are ${Object.keys(XColorModelToColor).join(", ")}`);
		if (parsed.type !== "hex_spec" && parsed.type !== "num_spec") throw new Error(`Cannot use model ${model} to compute the color "${color}"`);
		if (model === "HTML" && parsed.type === "hex_spec") return XColorModelToColor.HTML(parsed.content).hex();
		else if (parsed.type === "num_spec") return XColorModelToColor[model](parsed.content).hex();
		throw new Error(`Don't know how to process color "${color}" in model "${model}"`);
	}
	if (Array.isArray(parsed) || parsed.type !== "color") throw new Error(`Cannot the color "${color}" is not a valid color string`);
	let computed = null;
	try {
		computed = computeColor(parsed, predefinedColors);
	} catch (e) {}
	return computed && computed.hex();
}
//#endregion
//#region package/xcolor/libs/print-raw.ts
/**
* Print an `xcolor` argument specification AST to a string.
*/
function printRaw(node, root = false) {
	if (typeof node === "string") return node;
	if (Array.isArray(node)) {
		const sepToken = root ? " " : "";
		return node.map((tok) => printRaw(tok)).join(sepToken);
	}
	if (node.type === "invalid_spec") return node.content;
	switch (node.type) {
		case "postfix": if (node.plusses != null) return `!!${node.plusses}`;
		else return `!![${node.num}]`;
		case "complete_mix": return `!${node.mix_percent}!${node.name}`;
		case "partial_mix": return `!${node.mix_percent}`;
		case "expr": return `${node.prefix || ""}${node.name}${node.mix_expr.map((mix) => printRaw(mix)).join("")}${node.postfix ? printRaw(node.postfix) : ""}`;
		case "weighted_expr": return `${printRaw(node.color)},${node.weight}`;
		case "extended_expr":
			let prefix = node.core_model;
			if (node.div) prefix += `,${node.div}`;
			return `${prefix}:${node.expressions.map((expr) => printRaw(expr)).join(";")}`;
		case "function": return `>${node.name},${node.args.map((a) => "" + a).join(",")}`;
		case "color": return printRaw(node.color) + node.functions.map((f) => printRaw(f)).join("");
		default:
			console.warn(`Unknown node type "${node.type}" for node`, node);
			return "";
	}
}
//#endregion
//#region package/xcolor/libs/xcolor-macro-to-hex.ts
/**
* Compute the hex representation of a color specified by an xcolor color command.
* For example `\color[rgb]{1 .5 .5}` or `\textcolor{red}{foo}`. If the color cannot be parsed,
* `null` is returned for the hex value. In all cases a css variable name (prefixed with "--"")
* is returned. This can be used to set up CSS for custom colors.
*/
function xcolorMacroToHex(node) {
	node = structuredClone(node);
	deleteComments(node);
	const args = getArgsContent(node);
	const model = args[0] && printRaw$1(args[0]);
	const colorStr = printRaw$1(args[1] || []);
	let hex = null;
	try {
		hex = xcolorColorToHex(colorStr, model);
	} catch (e) {}
	const cssVarName = "--" + colorStr.replace(/[^a-zA-Z0-9-_]/g, "-");
	return {
		hex,
		cssVarName
	};
}
//#endregion
//#region package/xcolor/libs/color-to-textcolor-macro.ts
/**
* Create a `\textcolor` macro. Color arguments are taken from `origMacro`.
*/
function colorToTextcolorMacro(content, origMacro) {
	if (!Array.isArray(content)) content = [content];
	return {
		type: "macro",
		content: "textcolor",
		args: (origMacro.args ? origMacro.args : [arg([], {
			closeMark: "",
			openMark: ""
		}), arg([])]).concat(arg(content)),
		_renderInfo: { inParMode: true }
	};
}
//#endregion
export { DVI_PS_NAMES, PREDEFINED_XCOLOR_COLORS, SVG_NAMES, X11_NAMES, XColorCoreModelToColor, colorToTextcolorMacro, computeColor, environments, macros, parse, printRaw, xcolorColorToHex, xcolorMacroToHex };

//# sourceMappingURL=index.js.map