"use client";
import { memo, useEffect, useRef } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Image/components/Preview.tsx
const Preview = memo(({ children, visible }) => {
	const ref = useRef(null);
	useEffect(() => {
		if (!ref.current) return;
		const handleDisableZoom = (event) => {
			event.preventDefault();
		};
		if (visible) ref.current.addEventListener("wheel", handleDisableZoom, { passive: false });
		else ref.current.removeEventListener("wheel", handleDisableZoom);
	}, [visible]);
	return /* @__PURE__ */ jsx("div", {
		ref,
		children
	});
});
//#endregion
export { Preview as default };

//# sourceMappingURL=Preview.mjs.map