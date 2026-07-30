import { darkAlgorithm } from "./algorithms/darkAlgorithm.mjs";
import { lightAlgorithm } from "./algorithms/lightAlgorithm.mjs";
import { baseToken } from "./token/base.mjs";
//#region src/styles/theme/antdTheme.ts
/**
* create A LobeHub Style Antd Theme Object
* @param neutralColor
* @param appearance
* @param primaryColor
*/
const createLobeAntdTheme = ({ neutralColor, appearance, primaryColor }) => {
	return {
		algorithm: appearance === "dark" ? darkAlgorithm : lightAlgorithm,
		components: {
			Button: { contentFontSizeSM: 12 },
			DatePicker: {
				activeBorderColor: baseToken.colorBorder,
				hoverBorderColor: baseToken.colorBorder
			},
			Input: {
				activeBorderColor: baseToken.colorBorder,
				hoverBorderColor: baseToken.colorBorder
			},
			InputNumber: {
				activeBorderColor: baseToken.colorBorder,
				hoverBorderColor: baseToken.colorBorder
			},
			Mentions: {
				activeBorderColor: baseToken.colorBorder,
				hoverBorderColor: baseToken.colorBorder
			},
			Select: {
				activeBorderColor: baseToken.colorBorder,
				hoverBorderColor: baseToken.colorBorder
			}
		},
		token: {
			...baseToken,
			neutralColor,
			primaryColor
		}
	};
};
//#endregion
export { createLobeAntdTheme };

//# sourceMappingURL=antdTheme.mjs.map