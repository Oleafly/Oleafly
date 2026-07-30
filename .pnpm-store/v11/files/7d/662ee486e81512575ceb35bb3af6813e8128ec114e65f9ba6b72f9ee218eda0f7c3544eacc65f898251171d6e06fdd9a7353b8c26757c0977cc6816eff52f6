"use client";
import { ConfigContext } from "../ConfigProvider/index.mjs";
import { createElement, memo, use, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/Img/index.tsx
const createContainer = (as) => memo((props) => createElement(as, props));
const Img = ({ unoptimized, ...rest }) => {
	const config = use(ConfigContext);
	const render = config?.imgAs || "img";
	return /* @__PURE__ */ jsx(useMemo(() => createContainer(render), [render]), {
		unoptimized: unoptimized === void 0 ? config?.imgUnoptimized : unoptimized,
		...rest
	});
};
Img.displayName = "Img";
//#endregion
export { Img as default };

//# sourceMappingURL=index.mjs.map