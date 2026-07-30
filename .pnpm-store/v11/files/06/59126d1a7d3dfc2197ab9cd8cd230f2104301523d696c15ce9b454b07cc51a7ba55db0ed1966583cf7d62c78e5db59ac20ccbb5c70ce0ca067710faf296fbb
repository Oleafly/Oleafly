"use client";
import { memo, useEffect, useRef } from "react";
//#region src/FontLoader/index.tsx
const createElement$1 = (url) => {
	const element = document.createElement("link");
	element.rel = "stylesheet";
	element.href = url;
	return element;
};
const FontLoader = memo(({ url }) => {
	const elementRef = useRef(null);
	useEffect(() => {
		const element = createElement$1(url);
		document.head.append(element);
		elementRef.current = element;
		const handleError = () => console.error(`Failed to load font from ${url}`);
		element.addEventListener("error", handleError);
		return () => {
			element.removeEventListener("error", handleError);
			element.remove();
			elementRef.current = null;
		};
	}, [url]);
	return null;
});
FontLoader.displayName = "FontLoader";
//#endregion
export { FontLoader as default };

//# sourceMappingURL=index.mjs.map