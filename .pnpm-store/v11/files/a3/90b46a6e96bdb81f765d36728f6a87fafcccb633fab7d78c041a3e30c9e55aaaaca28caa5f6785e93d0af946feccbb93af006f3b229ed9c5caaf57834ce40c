//#region src/styles/theme/token/base.ts
const joinFontFamily = (fonts) => fonts.map((font) => font.includes(" ") ? `"${font}"` : font).join(",");
const FONT_EMOJI = [
	"/* EMOJI */",
	"Apple Color Emoji",
	"Segoe UI Emoji",
	"Segoe UI Symbol",
	"Noto Color Emoji"
];
const FONT_EN = [
	"Geist",
	"-apple-system",
	"BlinkMacSystemFont",
	"Segoe UI Variable Display",
	"Segoe UI",
	"Roboto",
	"Helvetica Neue",
	"Arial"
];
const FONT_CN = [
	"/* SC */",
	"HarmonyOS Sans SC",
	"PingFang SC",
	"Hiragino Sans GB",
	"Microsoft YaHei UI",
	"Microsoft YaHei",
	"Source Han Sans SC",
	"Noto Sans CJK SC"
];
const baseToken = {
	borderRadius: 8,
	borderRadiusLG: 12,
	borderRadiusSM: 6,
	borderRadiusXS: 4,
	controlHeight: 36,
	fontFamily: joinFontFamily([
		FONT_EN,
		FONT_CN,
		[
			"/* FALLBACK */",
			"ui-sans-serif",
			"system-ui",
			"sans-serif"
		],
		FONT_EMOJI
	].flat()),
	fontFamilyCode: joinFontFamily([
		[
			"Geist Mono",
			"ui-monospace",
			"SFMono-Regular",
			"SF Mono",
			"Menlo",
			"Cascadia Code",
			"Consolas",
			"Liberation Mono"
		],
		FONT_CN,
		["/* FALLBACK */", "monospace"],
		FONT_EMOJI
	].flat())
};
//#endregion
export { baseToken };

//# sourceMappingURL=base.mjs.map