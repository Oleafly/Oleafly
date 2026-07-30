import { SKIP } from "../../node_modules/.bun/unist-util-visit-parents@6.0.2/node_modules/unist-util-visit-parents/lib/index.mjs";
import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
//#region src/Markdown/plugins/remarkCustomFootnotes.ts
const remarkCustomFootnotes = () => (tree, file) => {
	const footnoteLinks = /* @__PURE__ */ new Map();
	visit(tree, "footnoteDefinition", (node) => {
		let linkData = null;
		visit(node, "link", (linkNode) => {
			if (linkData) return SKIP;
			const textNode = linkNode.children.find((n) => n.type === "text");
			linkData = {
				alt: textNode?.value || "",
				title: textNode?.value || "",
				url: linkNode.url
			};
			return SKIP;
		});
		if (linkData) footnoteLinks.set(node.identifier, linkData);
	});
	file.data.footnoteLinks = Object.fromEntries(footnoteLinks);
};
//#endregion
export { remarkCustomFootnotes };

//# sourceMappingURL=remarkCustomFootnotes.mjs.map