"use client";
import usePreview from "./components/usePreviewGroup.mjs";
import { memo } from "react";
import { jsx } from "react/jsx-runtime";
import { Image } from "antd";
//#region src/Image/PreviewGroup.tsx
const { PreviewGroup: AntdPreviewGroup } = Image;
const PreviewGroup = memo(({ items, children, enable = true, preview }) => {
	const mergePreview = usePreview(preview);
	if (!enable) return children;
	return /* @__PURE__ */ jsx(AntdPreviewGroup, {
		items,
		preview: mergePreview,
		children
	});
});
PreviewGroup.displayName = "PreviewGroup";
//#endregion
export { PreviewGroup as default };

//# sourceMappingURL=PreviewGroup.mjs.map