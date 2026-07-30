"use client";
import FlexBasic_default from "../Flex/FlexBasic.mjs";
import Center from "../Flex/Center.mjs";
import Icon from "../Icon/Icon.mjs";
import Text from "../Text/Text.mjs";
import Button$1 from "../Button/Button.mjs";
import Tag$1 from "../Tag/Tag.mjs";
import { useTranslation } from "../i18n/useTranslation.mjs";
import emojiPicker_default from "../i18n/resources/en/emojiPicker.mjs";
import { memo, useCallback, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Upload, message } from "antd";
import { cssVar } from "antd-style";
import { ChevronLeftIcon, ImageUpIcon } from "lucide-react";
import AvatarEditor from "react-avatar-editor";
//#region src/EmojiPicker/AvatarUploader.tsx
const { Dragger } = Upload;
const createUploadImageHandler = (onUploadImage) => (file) => {
	const reader = new FileReader();
	reader.readAsDataURL(file);
	reader.addEventListener("load", () => {
		onUploadImage(String(reader.result));
	});
};
const AvatarUploader = memo(({ shape, onChange, texts, compressSize = 256, onUpload }) => {
	const editor = useRef(null);
	const [previewImage, setPreviewImage] = useState("");
	const { t } = useTranslation(emojiPicker_default);
	const fileTypeErrorText = texts?.fileTypeError ?? t("emojiPicker.fileTypeError");
	const draggerDescText = texts?.draggerDesc ?? t("emojiPicker.draggerDesc");
	const uploadBtnText = texts?.uploadBtn ?? t("emojiPicker.uploadBtn");
	const beforeUpload = useCallback((file) => {
		if (!(file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/gif" || file.type === "image/webp")) {
			message.error(fileTypeErrorText);
			return;
		}
		return createUploadImageHandler((avatar) => {
			setPreviewImage(avatar);
		})(file);
	}, [fileTypeErrorText]);
	const handleUpload = () => {
		if (!editor.current) return;
		const canvasScaled = editor.current.getImageScaledToCanvas();
		onChange(canvasScaled.toDataURL());
		if (!onUpload) return;
		canvasScaled.toBlob((blob) => {
			if (blob) onUpload(new File([blob], "avatar.webp", { type: "image/webp" }));
		}, "image/webp", .95);
	};
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		padding: 10,
		style: { position: "relative" },
		width: "100%",
		children: [!previewImage && /* @__PURE__ */ jsx(Dragger, {
			accept: "image",
			beforeUpload,
			itemRender: () => void 0,
			maxCount: 1,
			multiple: false,
			children: /* @__PURE__ */ jsxs(Center, {
				gap: 16,
				height: compressSize,
				width: compressSize,
				children: [
					/* @__PURE__ */ jsx(Icon, {
						color: cssVar.colorTextDescription,
						icon: ImageUpIcon,
						size: 48
					}),
					/* @__PURE__ */ jsx(Text, {
						color: cssVar.colorTextSecondary,
						children: draggerDescText
					}),
					/* @__PURE__ */ jsxs(Center, {
						horizontal: true,
						gap: 4,
						children: [
							/* @__PURE__ */ jsx(Tag$1, { children: "JPG" }),
							/* @__PURE__ */ jsx(Tag$1, { children: "PNG" }),
							/* @__PURE__ */ jsx(Tag$1, { children: "GIF" }),
							/* @__PURE__ */ jsx(Tag$1, { children: "WEBP" })
						]
					})
				]
			})
		}), previewImage && /* @__PURE__ */ jsxs(Center, {
			gap: 8,
			style: { position: "relative" },
			width: "100%",
			children: [/* @__PURE__ */ jsx(AvatarEditor, {
				border: 0,
				borderRadius: shape === "square" ? void 0 : compressSize / 2,
				height: compressSize,
				image: previewImage,
				ref: editor,
				width: compressSize
			}), /* @__PURE__ */ jsxs(FlexBasic_default, {
				horizontal: true,
				gap: 8,
				style: { position: "relative" },
				width: "100%",
				children: [/* @__PURE__ */ jsx(Button$1, {
					icon: ChevronLeftIcon,
					style: { flex: "none" },
					onClick: () => setPreviewImage("")
				}), /* @__PURE__ */ jsx(Button$1, {
					style: {
						flex: 1,
						fontWeight: 500
					},
					type: "primary",
					onClick: handleUpload,
					children: uploadBtnText
				})]
			})]
		})]
	});
});
AvatarUploader.displayName = "AvatarUploader";
//#endregion
export { AvatarUploader as default };

//# sourceMappingURL=AvatarUploader.mjs.map