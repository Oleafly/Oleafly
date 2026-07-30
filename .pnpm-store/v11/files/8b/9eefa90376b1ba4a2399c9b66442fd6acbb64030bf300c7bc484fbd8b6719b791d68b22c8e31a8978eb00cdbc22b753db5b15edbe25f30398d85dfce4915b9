import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
//#region src/Markdown/plugins/remarkColor.ts
/**
* Remark plugin to handle color syntax in markdown code spans
* Supports GitHub-style color visualization for HEX, RGB, and HSL colors
*
* @example
* `#FF0000` -> renders with red color preview
* `rgb(255, 0, 0)` -> renders with red color preview
* `hsl(0, 100%, 50%)` -> renders with red color preview
*/
const remarkColor = (options = {}) => {
	const { colorValidator } = options;
	/**
	* 验证并标准化颜色值
	*/
	const validateAndNormalizeColor = (colorString) => {
		const trimmed = colorString.trim();
		if (colorValidator && !colorValidator(trimmed)) return null;
		if (/^#([\da-f]{6}|[\da-f]{3})$/i.test(trimmed)) {
			if (trimmed.length === 4) {
				const [, r, g, b] = trimmed;
				return `#${r}${r}${g}${g}${b}${b}`;
			}
			return trimmed.toUpperCase();
		}
		const rgbMatch = trimmed.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
		if (rgbMatch) {
			const [, r, g, b] = rgbMatch;
			const rNum = parseInt(r, 10);
			const gNum = parseInt(g, 10);
			const bNum = parseInt(b, 10);
			if (rNum >= 0 && rNum <= 255 && gNum >= 0 && gNum <= 255 && bNum >= 0 && bNum <= 255) return `rgb(${rNum}, ${gNum}, ${bNum})`;
		}
		const hslMatch = trimmed.match(/^hsl\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/i);
		if (hslMatch) {
			const [, h, s, l] = hslMatch;
			const hNum = parseInt(h, 10);
			const sNum = parseInt(s, 10);
			const lNum = parseInt(l, 10);
			if (hNum >= 0 && hNum <= 360 && sNum >= 0 && sNum <= 100 && lNum >= 0 && lNum <= 100) return `hsl(${hNum}, ${sNum}%, ${lNum}%)`;
		}
		return null;
	};
	return (tree) => {
		visit(tree, "inlineCode", (node, index = 0, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			const colorValue = validateAndNormalizeColor(node.value);
			if (colorValue) {
				const colorNode = {
					children: [{
						type: "text",
						value: node.value
					}],
					color: colorValue,
					data: {
						hName: "code",
						hProperties: {
							"className": "color-preview",
							"data-color": colorValue,
							"data-original": node.value,
							"style": `--color-preview-color: ${colorValue}`
						}
					},
					type: "colorPreview",
					value: node.value
				};
				parent.children.splice(index, 1, colorNode);
				return index;
			}
		});
		visit(tree, "text", (node, index = 0, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			const colorPattern = /`([^`]+)`/g;
			const text = node.value;
			let hasColorMatch = false;
			const newNodes = [];
			let lastIndex = 0;
			let match;
			while ((match = colorPattern.exec(text)) !== null) {
				const [fullMatch, colorCandidate] = match;
				const colorValue = validateAndNormalizeColor(colorCandidate);
				if (colorValue) {
					hasColorMatch = true;
					const startIndex = match.index;
					if (startIndex > lastIndex) newNodes.push({
						type: "text",
						value: text.slice(lastIndex, startIndex)
					});
					newNodes.push({
						children: [{
							type: "text",
							value: colorCandidate
						}],
						color: colorValue,
						data: {
							hName: "code",
							hProperties: {
								"className": "color-preview",
								"data-color": colorValue,
								"data-original": colorCandidate,
								"style": `--color-preview-color: ${colorValue}`
							}
						},
						type: "colorPreview",
						value: colorCandidate
					});
					lastIndex = startIndex + fullMatch.length;
				}
			}
			if (hasColorMatch) {
				if (lastIndex < text.length) newNodes.push({
					type: "text",
					value: text.slice(lastIndex)
				});
				if (newNodes.length > 0 && parent) {
					parent.children.splice(index, 1, ...newNodes);
					return index + newNodes.length - 1;
				}
			}
		});
	};
};
//#endregion
export { remarkColor };

//# sourceMappingURL=remarkColor.mjs.map