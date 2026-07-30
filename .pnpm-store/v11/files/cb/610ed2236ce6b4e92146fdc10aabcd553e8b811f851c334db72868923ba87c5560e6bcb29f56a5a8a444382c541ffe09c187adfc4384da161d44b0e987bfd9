"use client";
import { useCdnFn } from "../ConfigProvider/index.mjs";
import { useCallback } from "react";
import { Fragment as Fragment$1, jsx, jsxs } from "react/jsx-runtime";
//#region src/ThemeProvider/Meta.tsx
const Meta = ({ title = "LobeHub", description = "Empowering your AI dreams with LobeHub", withManifest }) => {
	const genCdnUrl = useCdnFn();
	const genAssets = useCallback((path) => genCdnUrl({
		path,
		pkg: "@lobehub/assets-favicons",
		version: "latest"
	}), []);
	return /* @__PURE__ */ jsxs(Fragment$1, { children: [
		/* @__PURE__ */ jsx("link", {
			href: genAssets("assets/favicon.ico"),
			rel: "shortcut icon"
		}),
		/* @__PURE__ */ jsx("link", {
			href: genAssets("assets/apple-touch-icon.png"),
			rel: "apple-touch-icon",
			sizes: "180x180"
		}),
		/* @__PURE__ */ jsx("link", {
			href: genAssets("assets/favicon-32x32.png"),
			rel: "icon",
			sizes: "32x32",
			type: "image/png"
		}),
		/* @__PURE__ */ jsx("link", {
			href: genAssets("assets/favicon-16x16.png"),
			rel: "icon",
			sizes: "16x16",
			type: "image/png"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no",
			name: "viewport"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: title,
			name: "apple-mobile-web-app-title"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: title,
			name: "application-name"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: description,
			name: "description"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: "#000000",
			name: "msapplication-TileColor"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: "#fff",
			media: "(prefers-color-scheme: light)",
			name: "theme-color"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: "#000",
			media: "(prefers-color-scheme: dark)",
			name: "theme-color"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: "yes",
			name: "apple-mobile-web-app-capable"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: title,
			name: "apple-mobile-web-app-title"
		}),
		/* @__PURE__ */ jsx("meta", {
			content: "black-translucent",
			name: "apple-mobile-web-app-status-bar-style"
		}),
		withManifest && /* @__PURE__ */ jsx("link", {
			href: genAssets("assets/site.webmanifest"),
			rel: "manifest"
		})
	] });
};
//#endregion
export { Meta as default };

//# sourceMappingURL=Meta.mjs.map