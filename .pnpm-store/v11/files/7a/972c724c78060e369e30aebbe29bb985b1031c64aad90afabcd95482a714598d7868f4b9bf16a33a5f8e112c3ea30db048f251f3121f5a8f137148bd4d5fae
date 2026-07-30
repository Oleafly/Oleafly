import { isEditableTarget } from "./utils.mjs";
import { useCallback, useEffect, useRef } from "react";
//#region src/EditorSlashMenu/useKeyboardNavigation.ts
const useKeyboardNavigation = ({ isOpen }) => {
	const listRef = useRef(null);
	const dispatchListKey = useCallback((key) => {
		const list = listRef.current;
		if (!list) return;
		const event = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			key
		});
		list.dispatchEvent(event);
	}, []);
	useEffect(() => {
		if (!isOpen) return;
		const raf = requestAnimationFrame(() => {
			const list = listRef.current;
			if (!list) return;
			if (list.querySelector("[data-highlighted]")) return;
			if (!list.querySelector("[role=\"option\"]")) return;
			dispatchListKey("ArrowDown");
		});
		return () => cancelAnimationFrame(raf);
	}, [dispatchListKey, isOpen]);
	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (event) => {
			if (!event.isTrusted) return;
			const list = listRef.current;
			if (!list) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target;
			if (!isEditableTarget(target) || list.contains(target)) return;
			if (!list.querySelector("[role=\"option\"]")) return;
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
			if (event.key === "Enter" && !list.querySelector("[data-highlighted]")) return;
			event.preventDefault();
			dispatchListKey(event.key);
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [dispatchListKey, isOpen]);
	return { listRef };
};
//#endregion
export { useKeyboardNavigation };

//# sourceMappingURL=useKeyboardNavigation.mjs.map