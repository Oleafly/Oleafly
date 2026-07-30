"use client";
import ActionIcon from "../ActionIcon/ActionIcon.mjs";
import { downloadBlob } from "../utils/downloadBlob.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Download } from "lucide-react";
//#region src/DownloadButton/DownloadButton.tsx
const DownloadButton = memo(({ fileName = "download", fileType = "svg", disabled = false, blobUrl, ...rest }) => {
	const handleDownload = async () => {
		if (!blobUrl || disabled) return;
		try {
			await downloadBlob(blobUrl, `${fileName.replace(/\.[^./]+$/, "")}.${fileType}`);
		} catch (error) {
			console.error("Download failed:", error);
		}
	};
	return /* @__PURE__ */ jsx(ActionIcon, {
		title: `Download ${fileType.toUpperCase()}`,
		...rest,
		icon: Download,
		onClick: handleDownload
	});
});
DownloadButton.displayName = "DownloadButton";
//#endregion
export { DownloadButton as default };

//# sourceMappingURL=DownloadButton.mjs.map