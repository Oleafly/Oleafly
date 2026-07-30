//#region src/utils/blobToPng.ts
/**
* Convert image blob to PNG format.
* Clipboard API only supports image/png and image/svg+xml.
* WebP, JPEG and other formats need to be converted for clipboard copy.
*/
const blobToPng = (blob) => new Promise((resolve, reject) => {
	const img = new Image();
	const url = URL.createObjectURL(blob);
	img.onload = () => {
		URL.revokeObjectURL(url);
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			reject(/* @__PURE__ */ new Error("Canvas context not available"));
			return;
		}
		ctx.drawImage(img, 0, 0);
		canvas.toBlob((pngBlob) => {
			if (pngBlob) resolve(pngBlob);
			else reject(/* @__PURE__ */ new Error("Failed to convert to PNG"));
		}, "image/png", 1);
	};
	img.onerror = () => {
		URL.revokeObjectURL(url);
		reject(/* @__PURE__ */ new Error("Failed to load image"));
	};
	img.src = url;
});
const getClipboardBlob = async (blob) => {
	const type = (blob.type || "").toLowerCase();
	if (type === "image/png" || type === "image/svg+xml") return { [type]: blob };
	return { "image/png": await blobToPng(blob) };
};
//#endregion
export { blobToPng, getClipboardBlob };

//# sourceMappingURL=blobToPng.mjs.map