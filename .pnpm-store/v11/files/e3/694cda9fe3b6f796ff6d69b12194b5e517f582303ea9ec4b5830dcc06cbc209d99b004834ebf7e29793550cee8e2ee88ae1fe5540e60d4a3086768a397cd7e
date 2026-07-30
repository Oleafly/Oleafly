"use client";
import { ConfigContext } from "../ConfigProvider/index.mjs";
import { createElement, memo, use, useMemo } from "react";
import { jsx } from "react/jsx-runtime";
//#region src/A/index.tsx
const createContainer = (as) => memo((props) => createElement(as, props));
const A = (props) => {
	const render = use(ConfigContext)?.aAs || "a";
	return /* @__PURE__ */ jsx(useMemo(() => createContainer(render), [render]), { ...props });
};
A.displayName = "A";
//#endregion
export { A as default };

//# sourceMappingURL=index.mjs.map