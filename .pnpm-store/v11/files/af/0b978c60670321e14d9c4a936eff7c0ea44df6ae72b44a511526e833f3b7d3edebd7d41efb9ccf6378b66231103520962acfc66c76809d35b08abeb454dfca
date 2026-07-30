import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import TooltipGroup from "../../base-ui/Tooltip/TooltipGroup.mjs";
import ActionIcon from "../../ActionIcon/ActionIcon.mjs";
import { useTranslation } from "../../i18n/useTranslation.mjs";
import { downloadBlob } from "../../utils/downloadBlob.mjs";
import { styles } from "../style.mjs";
import image_default from "../../i18n/resources/en/image.mjs";
import { getClipboardBlob } from "../../utils/blobToPng.mjs";
import { memo, useCallback, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { message } from "antd";
import { Copy, Download, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
//#region src/Image/components/Toolbar.tsx
const getFileNameFromUrl = (url) => {
	try {
		const match = new URL(url).pathname.match(/\/([^/]+)$/);
		return match ? decodeURIComponent(match[1]) : "image";
	} catch {
		return "image";
	}
};
const getExtensionFromMimeType = (mimeType) => {
	return {
		"image/svg+xml": "svg",
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/jpg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif"
	}[mimeType?.toLowerCase()] || mimeType?.split("/")[1]?.split("+")[0] || "png";
};
const Toolbar = memo(({ children, info, minScale, maxScale }) => {
	const { t } = useTranslation(image_default);
	const [containerEl, setContainerEl] = useState(null);
	const [copyLoading, setCopyLoading] = useState(false);
	const [downloadLoading, setDownloadLoading] = useState(false);
	const { transform: { scale }, actions: { onFlipY, onFlipX, onRotateLeft, onRotateRight, onZoomOut, onZoomIn }, image: { url } } = info;
	const handleDownload = useCallback(async () => {
		setDownloadLoading(true);
		try {
			const blob = await (await fetch(url, { mode: "cors" })).blob();
			const blobUrl = URL.createObjectURL(blob);
			let fileName = getFileNameFromUrl(url);
			const ext = getExtensionFromMimeType(blob.type);
			if (!fileName.includes(".")) fileName = `${fileName}.${ext}`;
			else if (fileName.endsWith(".svg+xml")) fileName = fileName.replace(/\.svg\+xml$/i, ".svg");
			await downloadBlob(blobUrl, fileName);
			URL.revokeObjectURL(blobUrl);
			message.success(t("image.downloadSuccess"));
		} catch {
			message.error(t("image.downloadFailed"));
		} finally {
			setDownloadLoading(false);
		}
	}, [url, t]);
	const handleCopy = useCallback(async () => {
		setCopyLoading(true);
		try {
			const clipboardBlob = await getClipboardBlob(await (await fetch(url, { mode: "cors" })).blob());
			await navigator.clipboard.write([new ClipboardItem(clipboardBlob)]);
			message.success(t("image.copySuccess"));
		} catch {
			message.error(t("image.copyFailed"));
		} finally {
			setCopyLoading(false);
		}
	}, [url, t]);
	return /* @__PURE__ */ jsx(TooltipGroup, {
		popupContainer: containerEl ?? void 0,
		children: /* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			className: styles.toolbar,
			gap: 4,
			ref: setContainerEl,
			children: [
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: FlipHorizontal,
					title: t("image.flipHorizontal"),
					onClick: onFlipX
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: FlipVertical,
					title: t("image.flipVertical"),
					onClick: onFlipY
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: RotateCcw,
					title: t("image.rotateLeft"),
					onClick: onRotateLeft
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: RotateCw,
					title: t("image.rotateRight"),
					onClick: onRotateRight
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					disabled: scale === minScale,
					icon: ZoomOut,
					title: t("image.zoomOut"),
					onClick: onZoomOut
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					disabled: scale === maxScale,
					icon: ZoomIn,
					title: t("image.zoomIn"),
					onClick: onZoomIn
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: Copy,
					loading: copyLoading,
					title: t("image.copy"),
					onClick: handleCopy
				}),
				/* @__PURE__ */ jsx(ActionIcon, {
					icon: Download,
					loading: downloadLoading,
					title: t("image.download"),
					onClick: handleDownload
				}),
				children
			]
		})
	});
});
//#endregion
export { Toolbar as default };

//# sourceMappingURL=Toolbar.mjs.map