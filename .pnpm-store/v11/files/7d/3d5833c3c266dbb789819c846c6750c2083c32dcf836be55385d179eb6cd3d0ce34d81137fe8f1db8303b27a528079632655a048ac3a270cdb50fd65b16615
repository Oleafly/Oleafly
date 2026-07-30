import { visit } from "../../node_modules/.bun/unist-util-visit@5.1.0/node_modules/unist-util-visit/lib/index.mjs";
//#region src/Markdown/plugins/rehypeCustomFootnotes.ts
const rehypeCustomFootnotes = () => (tree, file) => {
	const linksData = file.data.footnoteLinks || {};
	visit(tree, "element", (node) => {
		if (node.tagName === "section" && node.properties.className?.includes("footnotes")) {
			const sortedLinks = Object.entries(linksData).sort(([a], [b]) => a.localeCompare(b)).map(([id, data]) => ({
				id,
				...data
			}));
			node.properties["data-footnote-links"] = JSON.stringify(sortedLinks);
		}
		if (node.tagName === "sup") {
			const link = node.children.find((n) => n.tagName === "a");
			if (link) {
				const linkRefIndex = link.properties?.id?.replace(/^user-content-fnref-/, "")[0];
				if (linkRefIndex !== void 0) link.properties["data-link"] = JSON.stringify(linksData[linkRefIndex]);
			}
		}
	});
};
//#endregion
export { rehypeCustomFootnotes };

//# sourceMappingURL=rehypeCustomFootnotes.mjs.map