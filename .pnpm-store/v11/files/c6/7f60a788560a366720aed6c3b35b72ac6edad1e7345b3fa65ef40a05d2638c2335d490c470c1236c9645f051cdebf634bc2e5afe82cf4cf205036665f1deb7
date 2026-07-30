import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
//#region src/Markdown/plugins/remarkBr.ts
/**
* Remark plugin to handle <br> and <br/> tags in markdown text
* This plugin converts <br> and <br/> tags to proper HTML elements
* without requiring allowHtml to be enabled
*/
const remarkBr = () => {
	return (tree) => {
		visit(tree, "html", (node, index, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			if (/^\s*<\s*br\s*\/?>\s*$/gi.test(node.value)) {
				parent.children.splice(index, 1, { type: "break" });
				return index;
			}
		});
		visit(tree, "text", (node, index = 0, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			const brRegex = /<\s*br\s*\/?>/gi;
			if (!brRegex.test(node.value)) return;
			brRegex.lastIndex = 0;
			const parts = [];
			const matches = [];
			let lastIndex = 0;
			let match;
			while ((match = brRegex.exec(node.value)) !== null) {
				if (match.index > lastIndex) parts.push(node.value.slice(lastIndex, match.index));
				matches.push(match[0]);
				lastIndex = match.index + match[0].length;
			}
			if (lastIndex < node.value.length) parts.push(node.value.slice(lastIndex));
			const newNodes = [];
			for (const [i, part] of parts.entries()) {
				if (part) newNodes.push({
					type: "text",
					value: part
				});
				if (i < matches.length) newNodes.push({ type: "break" });
			}
			if (newNodes.length > 0) {
				parent.children.splice(index, 1, ...newNodes);
				return index + newNodes.length - 1;
			}
		});
	};
};
//#endregion
export { remarkBr };

//# sourceMappingURL=remarkBr.mjs.map