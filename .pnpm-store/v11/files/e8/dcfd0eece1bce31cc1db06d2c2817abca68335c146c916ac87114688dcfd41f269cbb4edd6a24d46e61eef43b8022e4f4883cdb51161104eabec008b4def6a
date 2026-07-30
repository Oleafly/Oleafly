"use client";
import ParentSize from "./ParentSize.mjs";
import { memo, useEffect, useRef, useState } from "react";
import { jsx } from "react/jsx-runtime";
import { Application } from "@splinetool/runtime";
//#region src/awesome/Spline/Spine.tsx
const Spline = memo(({ ref, scene, style, onMouseDown, onMouseUp, onMouseHover, onKeyDown, onKeyUp, onStart, onLookAt, onFollow, onWheel, onLoad, renderOnDemand = true, ...props }) => {
	const canvasRef = useRef(null);
	const [isLoading, setIsLoading] = useState(true);
	const init = async (speApp, events) => {
		await speApp.load(scene);
		for (const event of events) if (event.cb) speApp.addEventListener(event.name, event.cb);
		setIsLoading(false);
		onLoad?.(speApp);
	};
	useEffect(() => {
		setIsLoading(true);
		let speApp;
		const events = [
			{
				cb: onMouseDown,
				name: "mouseDown"
			},
			{
				cb: onMouseUp,
				name: "mouseUp"
			},
			{
				cb: onMouseHover,
				name: "mouseHover"
			},
			{
				cb: onKeyDown,
				name: "keyDown"
			},
			{
				cb: onKeyUp,
				name: "keyUp"
			},
			{
				cb: onStart,
				name: "start"
			},
			{
				cb: onLookAt,
				name: "lookAt"
			},
			{
				cb: onFollow,
				name: "follow"
			},
			{
				cb: onWheel,
				name: "scroll"
			}
		];
		if (canvasRef.current) {
			speApp = new Application(canvasRef.current, { renderOnDemand });
			init(speApp, events);
		}
		return () => {
			for (const event of events) if (event.cb) speApp.removeEventListener(event.name, event.cb);
			speApp.dispose();
		};
	}, [scene]);
	return /* @__PURE__ */ jsx(ParentSize, {
		debounceTime: 50,
		parentSizeStyles: style,
		ref,
		...props,
		children: () => {
			return /* @__PURE__ */ jsx("canvas", {
				ref: canvasRef,
				style: { display: isLoading ? "none" : "block" }
			});
		}
	});
});
Spline.displayName = "Spline";
//#endregion
export { Spline as default };

//# sourceMappingURL=Spine.mjs.map