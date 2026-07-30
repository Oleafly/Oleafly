//#region src/utils/copyToClipboard.ts
const copyToClipboard = async (text) => {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const textArea = document.createElement("textarea");
		textArea.value = text;
		document.body.append(textArea);
		textArea.focus();
		textArea.select();
		document.execCommand("copy");
		textArea.remove();
	}
};
//#endregion
export { copyToClipboard };

//# sourceMappingURL=copyToClipboard.mjs.map