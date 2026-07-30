import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
//#region src/Markdown/plugins/remarkVideo.ts
/**
* Remark plugin to handle <video> tags in markdown text
* This plugin converts <video> tags to proper video elements
* without requiring allowHtml to be enabled
*
* @example
* <video src="https://example.com/video.mp4" />
* <video src="https://example.com/video.mp4" controls width="400" height="300" />
*/
const remarkVideo = (options = {}) => {
	const { videoTags = ["video"] } = options;
	return (tree) => {
		visit(tree, "html", (node, index = 0, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			for (const tagName of videoTags) {
				const selfClosingPattern = `^<${tagName}([^>]*?)\\s*\\/?\\s*>$`;
				const selfClosingMatch = node.value.trim().match(new RegExp(selfClosingPattern, "i"));
				if (selfClosingMatch) {
					const attributesStr = selfClosingMatch[1]?.trim() || "";
					const properties = {};
					const attrRegex = /(\w+)=["']([^"']*)["']/g;
					let attrMatch;
					while ((attrMatch = attrRegex.exec(attributesStr)) !== null) properties[attrMatch[1]] = attrMatch[2];
					const newNode = {
						children: [],
						data: {
							hName: tagName,
							hProperties: properties
						},
						type: tagName
					};
					parent.children.splice(index, 1, newNode);
					return index;
				}
				const pairedPattern = `^<${tagName}([^>]*?)>(.*?)<\\/${tagName}>$`;
				const pairedMatch = node.value.trim().match(new RegExp(pairedPattern, "is"));
				if (pairedMatch) {
					const attributesStr = pairedMatch[1]?.trim() || "";
					const content = pairedMatch[2] || "";
					const properties = {};
					const attrRegex = /(\w+)=["']([^"']*)["']/g;
					let attrMatch;
					while ((attrMatch = attrRegex.exec(attributesStr)) !== null) properties[attrMatch[1]] = attrMatch[2];
					const newNode = {
						children: content ? [{
							type: "text",
							value: content
						}] : [],
						data: {
							hName: tagName,
							hProperties: properties
						},
						type: tagName
					};
					parent.children.splice(index, 1, newNode);
					return index;
				}
			}
		});
		visit(tree, "text", (node, index = 0, parent) => {
			if (!node.value || typeof node.value !== "string") return;
			for (const tagName of videoTags) {
				const encodedSelfClosingPattern = `&lt;${tagName}([^&]*?)\\s*\\/?\\s*&gt;`;
				const encodedSelfClosingRegex = new RegExp(encodedSelfClosingPattern, "gi");
				if (!encodedSelfClosingRegex.test(node.value)) continue;
				encodedSelfClosingRegex.lastIndex = 0;
				const text = node.value;
				const newNodes = [];
				let lastIndex = 0;
				let match;
				while ((match = encodedSelfClosingRegex.exec(text)) !== null) {
					const [fullMatch, attributesStr] = match;
					const startIndex = match.index;
					if (startIndex > lastIndex) newNodes.push({
						type: "text",
						value: text.slice(lastIndex, startIndex)
					});
					const decodedAttrs = attributesStr.replaceAll("&quot;", "\"").replaceAll("&#39;", "'").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
					const properties = {};
					const attrRegex = /(\w+)=["']([^"']*)["']/g;
					let attrMatch;
					while ((attrMatch = attrRegex.exec(decodedAttrs)) !== null) properties[attrMatch[1]] = attrMatch[2];
					newNodes.push({
						children: [],
						data: {
							hName: tagName,
							hProperties: properties
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
			}
		});
	};
};
//#endregion
export { remarkVideo };

//# sourceMappingURL=remarkVideo.mjs.map