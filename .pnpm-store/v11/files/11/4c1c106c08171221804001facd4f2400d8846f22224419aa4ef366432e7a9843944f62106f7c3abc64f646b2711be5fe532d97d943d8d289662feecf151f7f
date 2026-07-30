import { findCodeElement } from "./hast_utils.js";
import { processLine } from "./processLine.js";
import { wrapTokenFragments } from "./wrapTokenFragments.js";
import { transformerStyleToClass } from "@shikijs/transformers";
//#region src/utils/createTransformerWithState.ts
function createTransformerWithState(useTokenTransformer = false, useCSSClasses = false) {
	const state = { lineInfo: [] };
	const transformers = [{
		line(node) {
			delete node.properties.class;
			return node;
		},
		pre(pre) {
			const code = findCodeElement(pre);
			const children = [];
			if (code != null) {
				let index = 1;
				for (const node of code.children) {
					if (node.type !== "element") continue;
					if (useTokenTransformer) wrapTokenFragments(node);
					children.push(processLine(node, index, state));
					index++;
				}
				code.children = children;
			}
			return pre;
		},
		...useTokenTransformer ? {
			tokens(lines) {
				for (const line of lines) {
					let col = 0;
					for (const token of line) {
						const tokenWithOriginalRange = token;
						tokenWithOriginalRange.__lineChar ??= col;
						col += token.content.length;
					}
				}
			},
			preprocess(_code, options) {
				options.mergeWhitespaces = "never";
			},
			span(hast, _line, _char, _lineElement, token) {
				if (token?.offset != null && token.content != null) {
					const tokenChar = token.__lineChar;
					if (tokenChar != null) hast.properties["data-char"] = tokenChar;
					return hast;
				}
				return hast;
			}
		} : null
	}];
	if (useCSSClasses) transformers.push(tokenStyleNormalizer, toClass);
	return {
		state,
		transformers,
		toClass
	};
}
const toClass = transformerStyleToClass({ classPrefix: "hl-" });
const tokenStyleNormalizer = {
	name: "token-style-normalizer",
	tokens(lines) {
		for (const line of lines) for (const token of line) {
			if (token.htmlStyle != null) continue;
			const style = {};
			if (token.color != null) style.color = token.color;
			if (token.bgColor != null) style["background-color"] = token.bgColor;
			if (token.fontStyle != null && token.fontStyle !== 0) {
				if ((token.fontStyle & 1) !== 0) style["font-style"] = "italic";
				if ((token.fontStyle & 2) !== 0) style["font-weight"] = "bold";
				if ((token.fontStyle & 4) !== 0) style["text-decoration"] = "underline";
			}
			if (Object.keys(style).length > 0) token.htmlStyle = style;
		}
	}
};
//#endregion
export { createTransformerWithState };

//# sourceMappingURL=createTransformerWithState.js.map