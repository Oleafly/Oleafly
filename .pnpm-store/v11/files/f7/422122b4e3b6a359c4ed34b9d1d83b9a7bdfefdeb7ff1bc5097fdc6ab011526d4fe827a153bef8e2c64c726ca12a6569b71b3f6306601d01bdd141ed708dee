"use client";
import { styles } from "./style.mjs";
import { useMouseOffset } from "./useMouseOffset.mjs";
import { memo, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx, useThemeMode } from "antd-style";
//#region src/awesome/Spotlight/Spotlight.tsx
const Spotlight = memo(({ className, size = 64, ...properties }) => {
	const [offset, outside, reference] = useMouseOffset();
	const { isDarkMode } = useThemeMode();
	const cssVariables = useMemo(() => ({
		"--spotlight-opacity": outside ? "0" : "0.1",
		"--spotlight-size": `${size}px`,
		"--spotlight-x": `${offset?.x ?? 0}px`,
		"--spotlight-y": `${offset?.y ?? 0}px`
	}), [
		offset,
		size,
		outside
	]);
	return /* @__PURE__ */ jsx("div", {
		className: cx(isDarkMode ? outside ? styles.spotlightDarkOutside : styles.spotlightDark : outside ? styles.spotlightLightOutside : styles.spotlightLight, className),
		ref: reference,
		style: cssVariables,
		...properties
	});
});
Spotlight.displayName = "Spotlight";
//#endregion
export { Spotlight as default };

//# sourceMappingURL=Spotlight.mjs.map