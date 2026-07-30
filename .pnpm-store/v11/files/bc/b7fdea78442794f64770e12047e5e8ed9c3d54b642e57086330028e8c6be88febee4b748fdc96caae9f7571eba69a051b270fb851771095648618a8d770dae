"use client";
import FlexBasic_default from "../../Flex/FlexBasic.mjs";
import Icon from "../../Icon/Icon.mjs";
import { styles } from "./style.mjs";
import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { FolderIcon, FolderOpen } from "lucide-react";
//#region src/mdx/FileTree/Folder.tsx
const Folder = ({ name, defaultOpen, icon = FolderIcon, children, ...rest }) => {
	const [open, setOpen] = useState(defaultOpen);
	return /* @__PURE__ */ jsxs(FlexBasic_default, {
		...rest,
		children: [/* @__PURE__ */ jsxs(FlexBasic_default, {
			horizontal: true,
			align: "center",
			className: styles.folder,
			gap: 4,
			onClick: () => setOpen(!open),
			children: [/* @__PURE__ */ jsx(Icon, { icon: open ? FolderOpen : icon }), /* @__PURE__ */ jsx("span", { children: name })]
		}), open && /* @__PURE__ */ jsx(FlexBasic_default, {
			className: styles.folderChildren,
			children
		})]
	});
};
Folder.displayName = "MdxFolder";
//#endregion
export { Folder as default };

//# sourceMappingURL=Folder.mjs.map