"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import SyntaxHighlighter from "../Highlighter/SyntaxHighlighter/index.mjs";
import CopyButton from "../CopyButton/CopyButton.mjs";
import Spotlight from "../awesome/Spotlight/Spotlight.mjs";
import { styles, variants } from "./style.mjs";
import { jsx, jsxs } from "react/jsx-runtime";
import { cx } from "antd-style";
//#region src/Snippet/Snippet.tsx
const Snippet = ({ ref, prefix, language = "tsx", children, copyable = true, variant = "filled", spotlight, shadow, className, ...rest }) => {
	const tirmedChildren = children.trim();
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		horizontal: true,
		align: "center",
		className: cx(variants({
			shadow,
			variant
		}), className),
		"data-code-type": "highlighter",
		gap: 8,
		ref,
		...rest,
		children: [
			spotlight && /* @__PURE__ */ jsx(Spotlight, {}),
			/* @__PURE__ */ jsx(SyntaxHighlighter, {
				className: styles.hightlight,
				language,
				children: [prefix, tirmedChildren].filter(Boolean).join(" ")
			}),
			copyable && /* @__PURE__ */ jsx(CopyButton, {
				content: tirmedChildren,
				size: "small"
			})
		]
	});
};
Snippet.displayName = "Snippet";
//#endregion
export { Snippet as default };

//# sourceMappingURL=Snippet.mjs.map