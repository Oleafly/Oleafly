"use client";
import { styles } from "./markdown.style.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Markdown/Typography.tsx
const Typography = memo(({ ref, children, className, fontSize = 16, headerMultiple = 1, marginMultiple = 2, lineHeight = 1.8, borderRadius = 8, style, ...rest }) => {
	return /* @__PURE__ */ jsx("article", {
		className: cx(styles.root, className),
		ref,
		style: {
			"--lobe-markdown-border-radius": borderRadius,
			"--lobe-markdown-font-size": `${fontSize}px`,
			"--lobe-markdown-header-multiple": headerMultiple,
			"--lobe-markdown-line-height": lineHeight,
			"--lobe-markdown-margin-multiple": marginMultiple,
			...style
		},
		...rest,
		children
	});
});
Typography.displayName = "Typography";
//#endregion
export { Typography as default };

//# sourceMappingURL=Typography.mjs.map