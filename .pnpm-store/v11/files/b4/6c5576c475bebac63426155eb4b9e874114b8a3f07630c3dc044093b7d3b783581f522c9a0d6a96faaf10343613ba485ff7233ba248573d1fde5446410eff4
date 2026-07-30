import Icon from "../../Icon/Icon.mjs";
import { styles } from "../style.mjs";
import Preview from "./Preview.mjs";
import Toolbar from "./Toolbar.mjs";
import { useMemo, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { X } from "lucide-react";
//#region src/Image/components/usePreview.tsx
const usePreview = (props) => {
	const [visible, setVisible] = useState(false);
	return useMemo(() => {
		if (props === false) return props;
		const { onVisibleChange, onOpenChange, minScale = .32, maxScale = 32, toolbarAddon, rootClassName, imageRender, toolbarRender, actionsRender, ...rest } = props === true ? {} : props || {};
		return {
			actionsRender: actionsRender || ((_, info) => {
				const originalNode = /* @__PURE__ */ jsx(Toolbar, {
					info,
					maxScale,
					minScale,
					children: toolbarAddon
				});
				if (toolbarRender) return toolbarRender(originalNode, info);
				return originalNode;
			}),
			closeIcon: /* @__PURE__ */ jsx(Icon, {
				color: "#fff",
				icon: X
			}),
			imageRender: (originalNode, info) => {
				const node = /* @__PURE__ */ jsx(Preview, {
					visible,
					children: originalNode
				});
				if (imageRender) return imageRender(node, info);
				return node;
			},
			maxScale,
			minScale,
			onOpenChange: (open) => {
				setVisible(open);
				onOpenChange?.(open);
				onVisibleChange?.(open, !open);
			},
			rootClassName: cx(styles.preview, rootClassName),
			styles: { mask: { backdropFilter: "blur(8px)" } },
			...rest
		};
	}, [
		props,
		visible,
		styles
	]);
};
//#endregion
export { usePreview as default, usePreview };

//# sourceMappingURL=usePreview.mjs.map