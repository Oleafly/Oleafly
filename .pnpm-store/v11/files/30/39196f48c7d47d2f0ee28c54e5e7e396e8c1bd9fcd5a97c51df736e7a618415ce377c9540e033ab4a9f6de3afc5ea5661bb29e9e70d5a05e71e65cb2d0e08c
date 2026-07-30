import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
//#region src/Markdown/plugins/remarkGfmPlus.ts
const DEFAULT_ALLOW_HTML_TAGS = [
	"sub",
	"sup",
	"ins",
	"kbd",
	"b",
	"strong",
	"i",
	"em",
	"mark",
	"del",
	"u"
];
const remarkGfmPlus = (options = {}) => {
	const { allowHtmlTags = DEFAULT_ALLOW_HTML_TAGS } = options;
	return (tree) => {
		visit(tree, (node) => {
			if (!node.children || !Array.isArray(node.children)) return;
			const children = node.children;
			let i = 0;
			while (i < children.length) {
				const currentNode = children[i];
				if (currentNode.type === "html" && currentNode.value) {
					const tagPattern = `^<(${allowHtmlTags.join("|")})>$`;
					const startTagMatch = currentNode.value.match(new RegExp(tagPattern));
					if (startTagMatch) {
						const tagName = startTagMatch[1];
						let endIndex = -1;
						const textNodes = [];
						for (let j = i + 1; j < children.length; j++) {
							const nextNode = children[j];
							if (nextNode.type === "html" && nextNode.value === `</${tagName}>`) {
								endIndex = j;
								break;
							} else if (nextNode.type === "text") textNodes.push(nextNode);
							else break;
						}
						if (endIndex !== -1) {
							const newNode = {
								children: [{
									type: "text",
									value: textNodes.map((node) => node.value).join("")
								}],
								data: {
									hName: tagName,
									hProperties: {}
								},
								type: tagName
							};
							const removeCount = endIndex - i + 1;
							children.splice(i, removeCount, newNode);
							i++;
							continue;
						}
					}
				}
				i++;
			}
		});
		visit(tree, "text", (node, index = 0, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			const encodedTagPattern = `&lt;(${allowHtmlTags.join("|")})&gt;(.*?)&lt;\\/\\1&gt;`;
			const encodedTagRegex = new RegExp(encodedTagPattern, "gi");
			const text = node.value;
			if (!encodedTagRegex.test(text)) return;
			encodedTagRegex.lastIndex = 0;
			const newNodes = [];
			let lastIndex = 0;
			let match;
			while ((match = encodedTagRegex.exec(text)) !== null) {
				const [fullMatch, tagName, content] = match;
				const startIndex = match.index;
				if (startIndex > lastIndex) newNodes.push({
					type: "text",
					value: text.slice(lastIndex, startIndex)
				});
				newNodes.push({
					children: [{
						type: "text",
						value: content
					}],
					data: {
						hName: tagName,
						hProperties: {}
					},
					type: tagName
				});
				lastIndex = startIndex + fullMatch.length;
			}
			if (lastIndex < text.length) newNodes.push({
				type: "text",
				value: text.slice(lastIndex)
			});
			if (newNodes.length > 0 && parent) {
				parent.children.splice(index, 1, ...newNodes);
				return index + newNodes.length - 1;
			}
		});
	};
};
//#endregion
export { remarkGfmPlus };

//# sourceMappingURL=remarkGfmPlus.mjs.map