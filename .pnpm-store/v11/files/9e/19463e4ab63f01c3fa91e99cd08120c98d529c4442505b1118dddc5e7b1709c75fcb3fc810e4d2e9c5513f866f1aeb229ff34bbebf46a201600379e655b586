//#region src/Markdown/components/MarkdownTable/hastTableToMarkdown.ts
const escapeCell = (text) => text.replaceAll("|", "\\|").replaceAll(/\r?\n/g, "<br>");
const matchAlign = (source) => {
	if (source.includes("center")) return "center";
	if (source.includes("right")) return "right";
	if (source.includes("left")) return "left";
	return null;
};
const readAlign = (node) => {
	const style = node?.properties?.style;
	const align = node?.properties?.align;
	const styleStr = typeof style === "string" ? style.toLowerCase() : "";
	const alignStr = typeof align === "string" ? align.toLowerCase() : "";
	return matchAlign(styleStr) ?? matchAlign(alignStr);
};
const encodeInlineCode = (text) => {
	let longestRun = 0;
	const runs = text.match(/`+/g);
	if (runs) for (const run of runs) longestRun = Math.max(longestRun, run.length);
	const fence = "`".repeat(longestRun + 1);
	return `${fence}${text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text}${fence}`;
};
const renderInline = (node) => {
	if (node.type === "text") return node.value ?? "";
	if (node.type !== "element") return "";
	const inner = (node.children ?? []).map((child) => renderInline(child)).join("");
	switch (node.tagName) {
		case "br": return "<br>";
		case "code": return encodeInlineCode(inner);
		case "strong":
		case "b": return `**${inner}**`;
		case "em":
		case "i": return `*${inner}*`;
		case "del":
		case "s": return `~~${inner}~~`;
		case "a": {
			const href = node.properties?.href;
			return href ? `[${inner}](${href})` : inner;
		}
		case "img": {
			const src = node.properties?.src ?? "";
			return `![${node.properties?.alt ?? ""}](${src})`;
		}
		default: return inner;
	}
};
const renderCell = (cell) => escapeCell(renderInline(cell)).trim();
const findChild = (node, tag) => node?.children?.find((child) => child.type === "element" && child.tagName === tag);
const findAllChildren = (node, tag) => (node?.children ?? []).filter((child) => child.type === "element" && child.tagName === tag);
const getRowCells = (row) => (row.children ?? []).filter((child) => child.type === "element" && (child.tagName === "th" || child.tagName === "td"));
const alignToDivider = (align) => {
	switch (align) {
		case "center": return ":---:";
		case "left": return ":---";
		case "right": return "---:";
		default: return "---";
	}
};
const hastTableToMarkdown = (node) => {
	if (!node) return "";
	const thead = findChild(node, "thead");
	const tbody = findChild(node, "tbody");
	const headerRow = findChild(thead, "tr");
	const headerCells = headerRow ? getRowCells(headerRow) : [];
	const bodyRows = findAllChildren(tbody, "tr");
	const columnCount = Math.max(headerCells.length, ...bodyRows.map((row) => getRowCells(row).length));
	if (columnCount === 0) return "";
	const headerTexts = Array.from({ length: columnCount }, (_, i) => headerCells[i] ? renderCell(headerCells[i]) : "");
	const aligns = Array.from({ length: columnCount }, (_, i) => readAlign(headerCells[i]));
	return [
		`| ${headerTexts.join(" | ")} |`,
		`| ${aligns.map((a) => alignToDivider(a)).join(" | ")} |`,
		...bodyRows.map((row) => {
			const cells = getRowCells(row);
			return `| ${Array.from({ length: columnCount }, (_, i) => cells[i] ? renderCell(cells[i]) : "").join(" | ")} |`;
		})
	].join("\n");
};
//#endregion
export { hastTableToMarkdown };

//# sourceMappingURL=hastTableToMarkdown.mjs.map