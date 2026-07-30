//#region src/EditorSlashMenu/utils.ts
const isGroup = (entry) => Boolean(entry.items && Array.isArray(entry.items));
const isEditableTarget = (target) => {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA") return !target.readOnly && !target.disabled;
	return target.getAttribute("role") === "textbox";
};
//#endregion
export { isEditableTarget, isGroup };

//# sourceMappingURL=utils.mjs.map