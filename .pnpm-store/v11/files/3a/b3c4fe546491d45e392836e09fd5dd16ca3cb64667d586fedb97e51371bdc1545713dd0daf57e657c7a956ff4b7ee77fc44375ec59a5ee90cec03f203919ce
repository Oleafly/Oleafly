import { isGroup } from "./utils.mjs";
import { useMemo } from "react";
//#region src/EditorSlashMenu/useNormalizedItems.ts
const useNormalizedItems = (items) => {
	const resolvedItems = useMemo(() => {
		if (!items.some(isGroup)) return items;
		const groups = [];
		let buffer = [];
		const flush = () => {
			if (buffer.length) {
				groups.push({ items: buffer });
				buffer = [];
			}
		};
		for (const entry of items) if (isGroup(entry)) {
			flush();
			groups.push(entry);
		} else buffer.push(entry);
		flush();
		return groups;
	}, [items]);
	return {
		hasAnyIcon: useMemo(() => {
			const walk = (entry) => {
				if (isGroup(entry)) return entry.items.some(walk);
				return Boolean(entry.icon);
			};
			return items.some(walk);
		}, [items]),
		resolvedItems
	};
};
//#endregion
export { useNormalizedItems };

//# sourceMappingURL=useNormalizedItems.mjs.map