"use client";
import { formatLang, useStyles } from "./style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import GiscusComponent from "@giscus/react";
//#region src/awesome/Giscus/Giscus.tsx
const Giscus = memo(({ style, className, reactionsEnabled = "1", mapping = "title", lang = "en_US", inputPosition = "top", id = "giscus", loading = "lazy", emitMetadata = "0", ...rest }) => {
	const theme = useStyles();
	return /* @__PURE__ */ jsx("div", {
		className,
		style,
		children: /* @__PURE__ */ jsx(GiscusComponent, {
			emitMetadata,
			id,
			inputPosition,
			lang: formatLang(lang),
			loading,
			mapping,
			reactionsEnabled,
			theme,
			...rest
		})
	});
});
Giscus.displayName = "Giscus";
//#endregion
export { Giscus as default };

//# sourceMappingURL=Giscus.mjs.map