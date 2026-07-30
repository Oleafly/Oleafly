//#region src/utils/downloadBlob.ts
const downloadBlob = async (blobUrl, fileName) => {
	return new Promise((resolve, reject) => {
		try {
			const link = document.createElement("a");
			link.href = blobUrl;
			link.download = fileName;
			link.style.display = "none";
			document.body.append(link);
			link.click();
			link.remove();
			resolve();
		} catch (error) {
			reject(error);
		}
	});
};
//#endregion
export { downloadBlob };

//# sourceMappingURL=downloadBlob.mjs.map