import lobe_theme_default from "../Highlighter/theme/lobe-theme.mjs";
import { cssVar } from "antd-style";
import { registerCustomTheme, resolveTheme } from "@pierre/diffs";
//#region src/CodeDiff/theme.ts
let isLobeDiffThemeRegistered = false;
const registerLobeDiffThemes = () => {
	if (isLobeDiffThemeRegistered) return;
	registerCustomTheme("lobe-theme", () => Promise.resolve(lobe_theme_default));
	resolveTheme("lobe-theme");
	isLobeDiffThemeRegistered = true;
};
const customSeparatorCSS = `
  :host {
    --diffs-dark-bg: transparent !important;
    --diffs-light-bg: transparent !important;
    --diffs-gap-fallback: 8px;
    --diffs-added-light: ${cssVar.colorSuccessHover};
    --diffs-added-dark: ${cssVar.colorSuccessBorderHover};
    --diffs-modified-light: ${cssVar.colorInfoHover};
    --diffs-modified-dark: ${cssVar.colorInfoBorderHover};
    --diffs-deleted-light: ${cssVar.colorErrorHover};
    --diffs-deleted-dark: ${cssVar.colorErrorBorderHover};
  }

  [data-gutter-buffer] {
    opacity: 0.2 !important;
  }

  [data-code] {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  [data-gutter] {
    backdrop-filter: blur(16px) !important;
  }
`;
const getLobeDiffOptions = ({ diffOptions, isDarkMode, viewMode }) => ({
	theme: {
		dark: "lobe-theme",
		light: "lobe-theme"
	},
	themeType: isDarkMode ? "dark" : "light",
	diffStyle: viewMode,
	disableFileHeader: true,
	unsafeCSS: customSeparatorCSS,
	...diffOptions
});
//#endregion
export { getLobeDiffOptions, registerLobeDiffThemes };

//# sourceMappingURL=theme.mjs.map