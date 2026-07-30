"use client";
import Button from "../../Button/Button.mjs";
import { styles } from "./style.mjs";
import { memo, useEffect, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { cx } from "antd-style";
import { ListEnd } from "lucide-react";
import { useScroll } from "ahooks";
//#region src/chat/BackBottom/BackBottom.tsx
const BackBottom = memo(({ visibilityHeight = 240, target, onClick, style, className, text }) => {
	const [visible, setVisible] = useState(false);
	const ref = useRef(null);
	const current = target?.current;
	const scrollHeight = current?.scrollHeight || 0;
	const clientHeight = current?.clientHeight || 0;
	const scroll = useScroll(target);
	useEffect(() => {
		if (scroll?.top) setVisible(scroll?.top + clientHeight + visibilityHeight < scrollHeight);
	}, [
		scrollHeight,
		scroll,
		visibilityHeight
	]);
	const scrollToBottom = (e) => {
		target?.current?.scrollTo({
			behavior: "smooth",
			left: 0,
			top: scrollHeight
		});
		onClick?.(e);
	};
	return /* @__PURE__ */ jsx(Button, {
		glass: true,
		className: cx(visible ? styles.visible : styles.hidden, className),
		icon: ListEnd,
		ref,
		shape: "round",
		size: "small",
		style,
		variant: "filled",
		onClick: scrollToBottom,
		children: text || "Back to bottom"
	});
});
BackBottom.displayName = "BackBottom";
//#endregion
export { BackBottom as default };

//# sourceMappingURL=BackBottom.mjs.map